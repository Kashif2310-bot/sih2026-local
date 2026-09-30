import { floatToPcm16Bytes, INPUT_SAMPLE_RATE, levelFromRms, resampleLinear, rms } from './pcm'

export type MicrophoneErrorKind =
  | 'permission_denied'
  | 'no_microphone'
  | 'device_busy'
  | 'device_lost'
  | 'unsupported'
  | 'aborted'
  | 'unknown'

export class MicrophoneError extends Error {
  readonly kind: MicrophoneErrorKind

  constructor(kind: MicrophoneErrorKind, message: string) {
    super(message)
    this.name = 'MicrophoneError'
    this.kind = kind
  }
}

export function classifyMicrophoneError(error: unknown): MicrophoneError {
  if (error instanceof MicrophoneError) return error
  const name = typeof error === 'object' && error !== null && 'name' in error ? String(error.name) : ''
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return new MicrophoneError('permission_denied', 'Microphone permission was denied.')
    case 'NotFoundError':
    case 'OverconstrainedError':
      return new MicrophoneError('no_microphone', 'No microphone was found.')
    case 'NotReadableError':
    case 'AbortError':
      return new MicrophoneError('device_busy', 'The microphone could not be started.')
    default:
      return new MicrophoneError('unknown', error instanceof Error ? error.message : 'Microphone failed.')
  }
}

export interface MicrophoneFrame {
  /** 16 kHz PCM16 little-endian, ready for Gemini. */
  pcm16: Uint8Array
  /** 0..1 display level from the real signal. */
  level: number
}

interface WorkletNodeLike {
  port: { onmessage: ((event: { data: unknown }) => void) | null }
  disconnect(): void
}

interface CaptureContextLike {
  readonly sampleRate: number
  readonly state: string
  audioWorklet: { addModule(url: string): Promise<void> }
  createMediaStreamSource(stream: MediaStream): { connect(node: unknown): void; disconnect(): void }
  resume(): Promise<void>
  close(): Promise<void>
}

export interface MicrophoneDeps {
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>
  createContext?: () => CaptureContextLike
  createWorkletNode?: (context: CaptureContextLike) => WorkletNodeLike
  workletUrl?: () => string
}

const PROCESSOR = 'ishaara-capture'
const FRAME_SAMPLES = 2048

const WORKLET_SOURCE = `
class IshaaraCapture extends AudioWorkletProcessor {
  constructor() { super(); this.buffer = new Float32Array(${FRAME_SAMPLES}); this.filled = 0 }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0]
    if (channel) {
      for (let i = 0; i < channel.length; i++) {
        this.buffer[this.filled++] = channel[i]
        if (this.filled === this.buffer.length) { this.port.postMessage(this.buffer.slice(0)); this.filled = 0 }
      }
    }
    return true
  }
}
registerProcessor('${PROCESSOR}', IshaaraCapture)
`

const defaultDeps: Required<MicrophoneDeps> = {
  getUserMedia: (constraints) => {
    if (!navigator.mediaDevices?.getUserMedia) {
      return Promise.reject(new MicrophoneError('unsupported', 'This browser cannot capture audio on this page.'))
    }
    return navigator.mediaDevices.getUserMedia(constraints)
  },
  createContext: () => new AudioContext() as unknown as CaptureContextLike,
  createWorkletNode: (context) =>
    new AudioWorkletNode(context as unknown as AudioContext, PROCESSOR, {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount: 1,
    }) as unknown as WorkletNodeLike,
  workletUrl: () => URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'application/javascript' })),
}

export type MicrophoneStatus = 'inactive' | 'requesting' | 'active'

/**
 * Real microphone capture. `start` resolves only after the browser granted
 * access and audio frames are flowing; `stop` releases the tracks and the
 * audio graph, including when it races a pending permission prompt.
 */
export class MicrophoneCapture {
  private readonly deps: Required<MicrophoneDeps>
  private attempt = 0
  private stream: MediaStream | null = null
  private context: CaptureContextLike | null = null
  private source: { disconnect(): void } | null = null
  private node: WorkletNodeLike | null = null
  private _status: MicrophoneStatus = 'inactive'

  constructor(deps: MicrophoneDeps = {}) {
    this.deps = { ...defaultDeps, ...deps }
  }

  get status() {
    return this._status
  }

  async start(onFrame: (frame: MicrophoneFrame) => void, onEnded: () => void): Promise<void> {
    if (this._status !== 'inactive') throw new MicrophoneError('device_busy', 'Microphone is already starting.')
    const attempt = ++this.attempt
    this._status = 'requesting'

    let stream: MediaStream
    try {
      stream = await this.deps.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      })
    } catch (error) {
      if (attempt === this.attempt) this._status = 'inactive'
      throw classifyMicrophoneError(error)
    }

    if (attempt !== this.attempt) {
      stream.getTracks().forEach((track) => track.stop())
      throw new MicrophoneError('aborted', 'Microphone start was cancelled.')
    }
    this.stream = stream

    try {
      const context = this.deps.createContext()
      this.context = context
      const url = this.deps.workletUrl()
      await context.audioWorklet.addModule(url)
      if (url.startsWith('blob:')) URL.revokeObjectURL(url)
      if (attempt !== this.attempt) throw new MicrophoneError('aborted', 'Microphone start was cancelled.')
      if (context.state === 'suspended') await context.resume()

      const source = context.createMediaStreamSource(stream)
      const node = this.deps.createWorkletNode(context)
      const rate = context.sampleRate
      node.port.onmessage = (event) => {
        if (attempt !== this.attempt || !(event.data instanceof Float32Array)) return
        onFrame({
          pcm16: floatToPcm16Bytes(resampleLinear(event.data, rate, INPUT_SAMPLE_RATE)),
          level: levelFromRms(rms(event.data)),
        })
      }
      source.connect(node)
      this.source = source
      this.node = node
    } catch (error) {
      if (attempt === this.attempt) this.release()
      throw error instanceof MicrophoneError ? error : classifyMicrophoneError(error)
    }

    for (const track of stream.getAudioTracks()) {
      track.addEventListener('ended', () => {
        if (attempt === this.attempt) onEnded()
      })
    }
    this._status = 'active'
  }

  stop() {
    this.attempt++
    this.release()
  }

  private release() {
    if (this.node) {
      this.node.port.onmessage = null
      this.node.disconnect()
    }
    this.source?.disconnect()
    this.stream?.getTracks().forEach((track) => track.stop())
    void this.context?.close().catch(() => undefined)
    this.node = null
    this.source = null
    this.stream = null
    this.context = null
    this._status = 'inactive'
  }
}
