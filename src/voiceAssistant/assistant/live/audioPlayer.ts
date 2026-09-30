import { levelFromRms, OUTPUT_SAMPLE_RATE, pcm16BytesToFloat } from './pcm'

/** Small lead so the first chunk is never scheduled in the past. */
const START_LEAD_SECONDS = 0.04

interface SourceLike {
  buffer: unknown
  onended: (() => void) | null
  connect(node: unknown): void
  start(when: number): void
  stop(): void
}

interface AnalyserLike {
  fftSize: number
  connect(node: unknown): void
  getFloatTimeDomainData(array: Float32Array<ArrayBuffer>): void
}

interface BufferLike {
  readonly duration: number
  copyToChannel(source: Float32Array<ArrayBuffer>, channel: number): void
}

interface PlaybackContextLike {
  readonly currentTime: number
  readonly state: string
  readonly destination: unknown
  createBuffer(channels: number, length: number, sampleRate: number): BufferLike
  createBufferSource(): SourceLike
  createAnalyser(): AnalyserLike
  resume(): Promise<void>
  close(): Promise<void>
}

export interface PlayerHandlers {
  /** Assistant audio of the current generation has become audible. */
  onStart: () => void
  /** Every scheduled source of the current generation has finished. */
  onDrained: () => void
  onError: (error: Error) => void
}

export class PlaybackError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PlaybackError'
  }
}

/**
 * Gapless 24 kHz PCM playback. Each interrupt bumps a generation counter, so
 * callbacks from sources that belonged to an earlier reply are ignored and
 * can never resurrect a "speaking" state.
 */
export class AudioOutputPlayer {
  private context: PlaybackContextLike | null = null
  private analyser: AnalyserLike | null = null
  private readonly sources = new Set<SourceLike>()
  private generation = 0
  private cursor = 0
  private audible = false
  private startTimer: ReturnType<typeof setTimeout> | null = null
  private readonly scratch = new Float32Array(1024)
  private handlers: PlayerHandlers | null = null
  private readonly createContext: () => PlaybackContextLike

  constructor(
    createContext: () => PlaybackContextLike = () =>
      new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE }) as unknown as PlaybackContextLike,
  ) {
    this.createContext = createContext
  }

  setHandlers(handlers: PlayerHandlers) {
    this.handlers = handlers
  }

  get isPlaying() {
    return this.sources.size > 0
  }

  get currentGeneration() {
    return this.generation
  }

  /** Call inside the user gesture so the browser allows audio output. */
  prime(): Promise<void> {
    const context = this.ensureContext()
    if (context.state === 'running') return Promise.resolve()
    return context.resume().catch(() => {
      throw new PlaybackError('The browser blocked audio playback.')
    })
  }

  enqueue(bytes: Uint8Array) {
    let context: PlaybackContextLike
    try {
      context = this.ensureContext()
      const samples = pcm16BytesToFloat(bytes)
      if (samples.length === 0) return
      const buffer = context.createBuffer(1, samples.length, OUTPUT_SAMPLE_RATE)
      buffer.copyToChannel(samples, 0)

      const source = context.createBufferSource()
      source.buffer = buffer
      source.connect(this.analyser)
      const startAt = Math.max(this.cursor, context.currentTime + START_LEAD_SECONDS)
      source.start(startAt)
      this.cursor = startAt + buffer.duration

      const generation = this.generation
      const wasIdle = this.sources.size === 0
      this.sources.add(source)
      source.onended = () => {
        this.sources.delete(source)
        if (generation !== this.generation || this.sources.size > 0) return
        this.audible = false
        this.handlers?.onDrained()
      }

      if (wasIdle && !this.audible) {
        const delayMs = Math.max(0, (startAt - context.currentTime) * 1000)
        this.clearStartTimer()
        this.startTimer = setTimeout(() => this.markAudible(generation), delayMs)
      }
    } catch (error) {
      this.handlers?.onError(
        error instanceof PlaybackError ? error : new PlaybackError('The assistant audio could not be played.'),
      )
    }
  }

  /** Stops everything immediately and invalidates any in-flight audio. */
  interrupt() {
    this.generation++
    this.clearStartTimer()
    for (const source of this.sources) {
      source.onended = null
      try {
        source.stop()
      } catch {
        // Already stopped.
      }
    }
    this.sources.clear()
    this.cursor = 0
    this.audible = false
  }

  level(): number {
    if (!this.analyser || !this.audible) return 0
    this.analyser.getFloatTimeDomainData(this.scratch)
    let sum = 0
    for (let i = 0; i < this.scratch.length; i++) sum += this.scratch[i] * this.scratch[i]
    return levelFromRms(Math.sqrt(sum / this.scratch.length))
  }

  close() {
    this.interrupt()
    void this.context?.close().catch(() => undefined)
    this.context = null
    this.analyser = null
  }

  private markAudible(generation: number) {
    this.startTimer = null
    if (generation !== this.generation || this.sources.size === 0) return
    if (this.context?.state !== 'running') {
      this.interrupt()
      this.handlers?.onError(new PlaybackError('The browser blocked audio playback.'))
      return
    }
    this.audible = true
    this.handlers?.onStart()
  }

  private clearStartTimer() {
    if (this.startTimer !== null) clearTimeout(this.startTimer)
    this.startTimer = null
  }

  private ensureContext(): PlaybackContextLike {
    if (!this.context) {
      const context = this.createContext()
      const analyser = context.createAnalyser()
      analyser.fftSize = 2048
      analyser.connect(context.destination)
      this.context = context
      this.analyser = analyser
    }
    return this.context
  }
}
