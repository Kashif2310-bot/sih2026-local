/**
 * GeminiAudioPlayer — streaming playback of the model's native audio.
 *
 * Gemini delivers a spoken reply as a stream of small raw-PCM chunks. Each
 * one is decoded into an AudioBuffer and scheduled on the AudioContext clock
 * back-to-back, which is what makes the reply sound like continuous speech
 * rather than a sequence of clips. Deliberately NOT built on <audio>
 * elements: one element per chunk gives audible seams between chunks, no
 * sample-accurate scheduling, and no way to cut playback mid-word.
 *
 * All scheduling/invalidations logic lives in PlaybackScheduler (a pure,
 * separately-tested module); this class is the thin Web Audio wrapper around
 * it, so the part that can be tested is tested and the part that can't is
 * kept small enough to read.
 */

import { decodePlaybackFrame } from './pcm'
import { PlaybackScheduler, type PlaybackState } from './playbackScheduler'

export interface AudioOutputPlayerOptions {
  /** Gemini's documented output rate. The AudioContext is created at this rate so no resampling is needed on playback. */
  sampleRateHz: number
  /** Injectable for tests; defaults to the browser's AudioContext. */
  createContext?: (sampleRateHz: number) => AudioContext
  onStateChange?: (state: PlaybackState) => void
  onError?: (error: Error) => void
}

function defaultCreateContext(sampleRateHz: number): AudioContext {
  const Ctor: typeof AudioContext | undefined =
    typeof AudioContext !== 'undefined'
      ? AudioContext
      : (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) throw new Error('This browser does not support the Web Audio API, so assistant audio cannot be played.')
  return new Ctor({ sampleRate: sampleRateHz })
}

export function isAudioPlaybackSupported(): boolean {
  return (
    typeof AudioContext !== 'undefined' ||
    typeof (globalThis as { webkitAudioContext?: unknown }).webkitAudioContext !== 'undefined'
  )
}

export class AudioOutputPlayer {
  private context: AudioContext | null = null
  private readonly scheduler = new PlaybackScheduler()
  /** Live sources, so an interruption can stop sound that is already playing — not just cancel what hasn't started. */
  private readonly activeSources = new Set<AudioBufferSourceNode>()
  private readonly options: Required<Pick<AudioOutputPlayerOptions, 'sampleRateHz'>> & AudioOutputPlayerOptions
  private disposed = false

  constructor(options: AudioOutputPlayerOptions) {
    this.options = options
  }

  get state(): PlaybackState {
    return this.scheduler.state
  }

  /**
   * Creates (or resumes) the AudioContext. Must be called from a user
   * gesture — browsers start a context 'suspended' otherwise and no audio
   * is ever heard, with no error raised. The voice UI's start button is
   * that gesture.
   */
  async prepare(): Promise<void> {
    if (this.disposed) throw new Error('AudioOutputPlayer: player has been disposed.')
    if (!this.context) {
      const create = this.options.createContext ?? defaultCreateContext
      this.context = create(this.options.sampleRateHz)
    }
    if (this.context.state === 'suspended') await this.context.resume()
  }

  /**
   * Queues one chunk of the model's speech. Silently ignores empty chunks
   * and anything arriving after disposal, so a late-resolving network
   * callback can never throw into an event handler.
   */
  playChunk(pcm16LittleEndian: ArrayBuffer): void {
    if (this.disposed || !this.context || pcm16LittleEndian.byteLength === 0) return

    try {
      const samples = decodePlaybackFrame(pcm16LittleEndian)
      if (samples.length === 0) return

      const buffer = this.context.createBuffer(1, samples.length, this.options.sampleRateHz)
      buffer.copyToChannel(samples, 0)

      const durationSeconds = samples.length / this.options.sampleRateHz
      const { startAt, generation } = this.scheduler.schedule(this.context.currentTime, durationSeconds)

      const source = this.context.createBufferSource()
      source.buffer = buffer
      source.connect(this.context.destination)
      source.onended = () => {
        this.activeSources.delete(source)
        // Only report "done" when this was the last of the CURRENT turn's
        // audio; a stale source ending says nothing about the live turn.
        if (this.activeSources.size === 0 && this.scheduler.isCurrent(generation)) {
          this.scheduler.finish()
          this.options.onStateChange?.(this.scheduler.state)
        }
      }

      this.activeSources.add(source)
      source.start(startAt)
      this.options.onStateChange?.(this.scheduler.state)
    } catch (cause) {
      this.scheduler.markError()
      this.options.onError?.(cause instanceof Error ? cause : new Error(String(cause)))
      this.options.onStateChange?.(this.scheduler.state)
    }
  }

  /**
   * Barge-in: silences the assistant immediately. Stops every source that
   * is already sounding AND bumps the generation, so chunks still in flight
   * for the interrupted turn are dropped rather than played after the next
   * reply has begun.
   */
  interrupt(): void {
    this.scheduler.interrupt()
    this.stopAllSources()
    this.options.onStateChange?.(this.scheduler.state)
  }

  /** Stop playback without framing it as a citizen interruption (session end, error teardown). */
  stop(): void {
    this.scheduler.stop()
    this.stopAllSources()
    this.options.onStateChange?.(this.scheduler.state)
  }

  /** Clean slate for a new session, keeping the (expensive to create) AudioContext alive. */
  reset(): void {
    this.scheduler.reset()
    this.stopAllSources()
    this.options.onStateChange?.(this.scheduler.state)
  }

  /** Terminal. Releases the AudioContext — without this, every start/stop cycle leaks one. */
  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.scheduler.stop()
    this.stopAllSources()
    const context = this.context
    this.context = null
    if (context && context.state !== 'closed') {
      try {
        await context.close()
      } catch {
        // A context can already be closing during teardown; disposal must complete regardless.
      }
    }
  }

  private stopAllSources(): void {
    for (const source of this.activeSources) {
      // Detach the handler first: stop() fires 'ended', and letting that run
      // the normal path would report a finished turn during a teardown.
      source.onended = null
      try {
        source.stop()
      } catch {
        // Throws if the source never started or already stopped — both fine here.
      }
      source.disconnect()
    }
    this.activeSources.clear()
  }
}
