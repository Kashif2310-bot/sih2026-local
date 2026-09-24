/**
 * MicrophoneCapture — real browser microphone input, streamed as frames.
 *
 * Knows nothing about Gemini, WebSockets, or the assistant. It emits audio
 * frames already in the format the caller asked for and lets the caller
 * decide where they go:
 *
 *   MicrophoneCapture --(PCM16 @ targetRateHz)--> VoiceSession --> provider
 *
 * That boundary is deliberate: it is what lets the same capture layer feed
 * the offline session in development, a Gemini session in production, and a
 * test double in unit tests, without any of them leaking into each other.
 *
 * Echo cancellation / noise suppression / auto gain are requested explicitly
 * rather than left to the browser's defaults, because without echo
 * cancellation the assistant's own voice coming out of the speaker is picked
 * up by the microphone and the server's voice-activity detection treats it
 * as the citizen interrupting — the assistant talks over itself in a loop.
 */

import { encodeMicrophoneFrame } from './pcm'
import { CAPTURE_FRAME_SAMPLES, CAPTURE_WORKLET_NAME, createCaptureWorkletUrl } from './captureWorklet'

export type MicrophoneCaptureState = 'idle' | 'requesting_permission' | 'capturing' | 'stopped' | 'error'

export type MicrophoneErrorCode =
  | 'permission_denied'
  | 'no_microphone'
  | 'unsupported'
  | 'device_lost'
  | 'unknown'

export interface MicrophoneError {
  code: MicrophoneErrorCode
  message: string
  cause?: unknown
}

export interface MicrophoneCaptureOptions {
  /** Sample rate the emitted frames must be in — Gemini Live's input rate for the live path. */
  targetSampleRateHz: number
  /** Receives each encoded frame as little-endian PCM16 bytes. */
  onFrame: (frame: ArrayBuffer) => void
  onError?: (error: MicrophoneError) => void
  onStateChange?: (state: MicrophoneCaptureState) => void
  /** Injectable for tests. Defaults to the real browser APIs. */
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>
  createContext?: () => AudioContext
}

/** Cheap feature check so the UI can show an honest "voice unavailable" state instead of failing at click time. */
export function isMicrophoneCaptureSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function' &&
    (typeof AudioContext !== 'undefined' ||
      typeof (globalThis as { webkitAudioContext?: unknown }).webkitAudioContext !== 'undefined')
  )
}

function defaultCreateContext(): AudioContext {
  const Ctor: typeof AudioContext | undefined =
    typeof AudioContext !== 'undefined'
      ? AudioContext
      : (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) throw new Error('This browser does not support the Web Audio API.')
  return new Ctor()
}

/**
 * Maps the browser's DOMException names onto the application's own error
 * vocabulary. The raw names are neither stable enough nor meaningful enough
 * to show a citizen, and some browsers use the legacy spellings.
 */
export function classifyMicrophoneError(cause: unknown): MicrophoneError {
  const name = typeof cause === 'object' && cause !== null && 'name' in cause ? String((cause as { name: unknown }).name) : ''
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return { code: 'permission_denied', message: 'Microphone access was blocked. Allow it in your browser to speak to the assistant.', cause }
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return { code: 'no_microphone', message: 'No microphone was found on this device.', cause }
    case 'NotReadableError':
    case 'TrackStartError':
      return { code: 'device_lost', message: 'The microphone is already in use by another application.', cause }
    case 'OverconstrainedError':
      return { code: 'unsupported', message: 'This microphone does not support the required audio settings.', cause }
    default:
      return {
        code: 'unknown',
        message: cause instanceof Error ? cause.message : 'The microphone could not be started.',
        cause,
      }
  }
}

export class MicrophoneCapture {
  private readonly options: MicrophoneCaptureOptions
  private _state: MicrophoneCaptureState = 'idle'
  private stream: MediaStream | null = null
  private context: AudioContext | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private worklet: AudioWorkletNode | null = null
  private workletUrl: string | null = null
  /** Guards against a second start() while the first is still awaiting permission — two concurrent getUserMedia calls leak a stream. */
  private starting: Promise<void> | null = null
  private disposed = false

  constructor(options: MicrophoneCaptureOptions) {
    this.options = options
  }

  get state(): MicrophoneCaptureState {
    return this._state
  }

  /** True while microphone audio is actually flowing. */
  get isCapturing(): boolean {
    return this._state === 'capturing'
  }

  /**
   * Requests permission and begins streaming. Idempotent: calling it while
   * already capturing resolves immediately, and calling it while a previous
   * call is still in flight awaits that same call rather than opening a
   * second stream. That matters under React StrictMode, which deliberately
   * invokes effects twice.
   */
  async start(): Promise<void> {
    if (this.disposed) throw new Error('MicrophoneCapture: capture has been disposed.')
    if (this._state === 'capturing') return
    if (this.starting) return this.starting

    this.starting = this.doStart().finally(() => {
      this.starting = null
    })
    return this.starting
  }

  private async doStart(): Promise<void> {
    // Environment detection applies to the DEFAULT browser path only. When a
    // caller injects both dependencies it has supplied its own transport, and
    // gating that on the presence of browser globals would make the class
    // untestable and unusable in any non-browser host.
    const usesBrowserApis = !this.options.getUserMedia || !this.options.createContext
    if (usesBrowserApis && !isMicrophoneCaptureSupported()) {
      const error: MicrophoneError = {
        code: 'unsupported',
        message: 'This browser does not support microphone capture, so voice is unavailable.',
      }
      this.fail(error)
      throw new Error(error.message)
    }

    this.setState('requesting_permission')
    const getUserMedia = this.options.getUserMedia ?? ((c: MediaStreamConstraints) => navigator.mediaDevices.getUserMedia(c))

    let stream: MediaStream
    try {
      stream = await getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      })
    } catch (cause) {
      const error = classifyMicrophoneError(cause)
      this.fail(error)
      throw new Error(error.message)
    }

    // A stop() that landed while permission was pending must win, or we leak
    // a live microphone the citizen believes they turned off.
    if (this.disposed || this._state === 'stopped') {
      for (const track of stream.getTracks()) track.stop()
      return
    }

    this.stream = stream

    try {
      const context = (this.options.createContext ?? defaultCreateContext)()
      this.context = context
      if (context.state === 'suspended') await context.resume()

      this.workletUrl = createCaptureWorkletUrl()
      await context.audioWorklet.addModule(this.workletUrl)

      const worklet = new AudioWorkletNode(context, CAPTURE_WORKLET_NAME, {
        numberOfInputs: 1,
        numberOfOutputs: 0,
        processorOptions: { frameSize: CAPTURE_FRAME_SAMPLES },
      })
      this.worklet = worklet

      const captureRate = context.sampleRate
      worklet.port.onmessage = (event: MessageEvent<Float32Array>) => {
        if (this._state !== 'capturing') return
        const samples = event.data
        if (!samples || samples.length === 0) return
        this.options.onFrame(encodeMicrophoneFrame(samples, captureRate, this.options.targetSampleRateHz))
      }

      const source = context.createMediaStreamSource(stream)
      this.source = source
      source.connect(worklet)

      // The worklet has no outputs, so it is not connected to destination —
      // routing microphone audio to the speakers would create feedback.

      for (const track of stream.getAudioTracks()) {
        track.addEventListener('ended', () => {
          if (this._state !== 'capturing') return
          this.fail({ code: 'device_lost', message: 'The microphone was disconnected.' })
        })
      }

      this.setState('capturing')
    } catch (cause) {
      // Partial graph construction must not leave a live stream behind.
      await this.releaseResources()
      const error = classifyMicrophoneError(cause)
      this.fail(error)
      throw new Error(error.message)
    }
  }

  /** Stops capture and releases the device. Safe to call repeatedly and at any point in the lifecycle. */
  async stop(): Promise<void> {
    if (this._state === 'stopped' || this._state === 'idle') {
      // Still release anything a failed start left behind.
      await this.releaseResources()
      this.setState('stopped')
      return
    }
    await this.releaseResources()
    this.setState('stopped')
  }

  /** Terminal teardown. After this the instance is unusable — build a new one for a new session. */
  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    await this.releaseResources()
    this.setState('stopped')
  }

  private async releaseResources(): Promise<void> {
    if (this.worklet) {
      this.worklet.port.onmessage = null
      this.worklet.disconnect()
      this.worklet = null
    }
    if (this.source) {
      this.source.disconnect()
      this.source = null
    }
    if (this.stream) {
      // Stopping every track is what actually turns the recording indicator
      // off; dropping the reference alone keeps the device open.
      for (const track of this.stream.getTracks()) track.stop()
      this.stream = null
    }
    if (this.context) {
      const context = this.context
      this.context = null
      if (context.state !== 'closed') {
        try {
          await context.close()
        } catch {
          // Already closing during teardown — nothing to recover.
        }
      }
    }
    if (this.workletUrl) {
      URL.revokeObjectURL(this.workletUrl)
      this.workletUrl = null
    }
  }

  private fail(error: MicrophoneError): void {
    this.setState('error')
    this.options.onError?.(error)
  }

  private setState(next: MicrophoneCaptureState): void {
    if (this._state === next) return
    this._state = next
    this.options.onStateChange?.(next)
  }
}
