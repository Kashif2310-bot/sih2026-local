/**
 * OfflineVoiceSession — a deterministic, fully in-memory VoiceSession
 * implementation that requires no API key, no microphone, and no network.
 *
 * This is a development/testing aid, mirroring the role
 * src/assistant/ai/offlineProvider.ts already plays for the text path: a
 * always-available implementation so the rest of the app (and other
 * developers) can build and test against a real, working VoiceSession
 * without Gemini Live ever being configured.
 *
 * It is NOT a language model and NOT a government integration. Every
 * simulated reply is prefixed "[OFFLINE VOICE SESSION — simulation]" and
 * every simulated audio chunk carries format 'mock' — see
 * docs/voice-session-architecture.md "Offline session honesty rules" for
 * why this labeling is load-bearing, not cosmetic: nothing here may ever be
 * mistaken for a real model reply or a real government fact.
 *
 * Event sequencing is genuinely asynchronous (small real delays between
 * steps, not synchronous callbacks) because that is what makes it a
 * faithful rehearsal of a real streaming session's timing — a caller that
 * only works against synchronous mock events would break the first time it
 * meets a real network round-trip.
 */

import type {
  VoiceAudioChunk,
  VoiceEvent,
  VoiceEventInput,
  VoiceReplySource,
  VoiceSession,
  VoiceSessionConfig,
  VoiceSessionContext,
  VoiceSessionError,
  VoiceSessionFactory,
  VoiceSessionStatus,
} from './types'

const OFFLINE_LABEL = '[OFFLINE VOICE SESSION — simulation]'

function defaultReplyFor(userText: string, turnNumber: number): string {
  return `${OFFLINE_LABEL} (turn ${turnNumber}) I heard: "${userText}". This is a scripted offline reply for development — no real AI model and no real government data were used.`
}

function mockAudioChunk(index: number): VoiceAudioChunk {
  return {
    format: 'mock',
    data: new TextEncoder().encode(`${OFFLINE_LABEL} audio frame ${index}`).buffer,
  }
}

function defaultIdGenerator(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `offline-${crypto.randomUUID()}`
  }
  return `offline-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

const ACTIVE_STATUSES: ReadonlySet<VoiceSessionStatus> = new Set([
  'connected',
  'listening',
  'user_speaking',
  'processing',
  'model_speaking',
  'interrupted',
])

const AUDIO_ACCEPTING_STATUSES: ReadonlySet<VoiceSessionStatus> = new Set(['listening', 'interrupted', 'user_speaking'])

export interface OfflineVoiceSessionOptions {
  /** Real (small) delay in ms between each simulated step — keeps ordering genuinely asynchronous without slowing tests down. Default: 4. */
  stepDelayMs?: number
  /** Produces the model's scripted reply text for a finalized user transcript. Defaults to an unmistakably-labeled canned reply — see the module doc comment for why the default must never resemble a real answer. */
  replyFor?: (userText: string, turnNumber: number) => string
  /** Injectable id generator, for deterministic ids in tests. */
  idGenerator?: () => string
}

/**
 * Deterministic scripted turn sequence per user input:
 *   user_speaking (partial transcripts word-by-word) -> user_transcript_final -> turn_ended(user)
 *   -> processing
 *   -> model_speaking (turn_started -> text partials word-by-word -> text final -> 2 audio chunks -> audio_end -> turn_ended(model))
 *   -> listening
 *
 * Barge-in (a barged-in model turn) is handled by aborting the model-turn
 * loop as soon as it notices its own turn id has been superseded — see
 * `currentModelTurnId` checks throughout runModelTurn().
 */
export class OfflineVoiceSession implements VoiceSession {
  readonly id: string

  private _status: VoiceSessionStatus = 'idle'
  private closed = false
  private seq = 0
  private turnCounter = 0
  private pendingAudioBytes = 0
  private currentUserTurnId: string | null = null
  private currentModelTurnId: string | null = null
  private readonly listeners = new Set<(event: VoiceEvent) => void>()
  private readonly pendingTimers: Array<ReturnType<typeof setTimeout>> = []
  private context: VoiceSessionContext
  private readonly options: Required<Pick<OfflineVoiceSessionOptions, 'stepDelayMs' | 'replyFor'>>
  private readonly replySource: VoiceReplySource
  private pendingExternalReplyResolve: ((text: string) => void) | null = null

  constructor(config: VoiceSessionConfig, options: OfflineVoiceSessionOptions = {}) {
    this.id = (options.idGenerator ?? defaultIdGenerator)()
    this.context = { language: config.language, applicantProfile: config.applicantProfile }
    this.options = {
      stepDelayMs: options.stepDelayMs ?? 4,
      replyFor: options.replyFor ?? defaultReplyFor,
    }
    this.replySource = config.replySource ?? 'provider'
  }

  get status(): VoiceSessionStatus {
    return this._status
  }

  // -- lifecycle -------------------------------------------------------

  async connect(): Promise<void> {
    if (this.closed) {
      throw new Error('OfflineVoiceSession: cannot connect() a closed session — create a new one via the factory.')
    }
    if (this._status === 'connecting') return
    if (ACTIVE_STATUSES.has(this._status)) return // already connected in some active state — idempotent

    this.setStatus('connecting')
    await this.sleep()
    if (this.closed) return
    this.setStatus('connected')
    await this.sleep()
    if (this.closed) return
    this.setStatus('listening')
  }

  async close(reason = 'client_requested'): Promise<void> {
    if (this.closed) return
    this.closed = true
    for (const t of this.pendingTimers) clearTimeout(t)
    this.pendingTimers.length = 0
    this.currentUserTurnId = null
    this.currentModelTurnId = null
    if (this.pendingExternalReplyResolve) {
      // Unblock a suspended runModelTurn() awaiting an external reply that
      // will now never arrive — it checks `this.closed` immediately after
      // and returns without emitting anything further.
      const resolve = this.pendingExternalReplyResolve
      this.pendingExternalReplyResolve = null
      resolve('')
    }
    this.emit({ type: 'diagnostic', message: `session closed: ${reason}` })
    this.setStatus('closed')
    this.listeners.clear()
  }

  // -- input -------------------------------------------------------------

  sendAudioChunk(chunk: VoiceAudioChunk): void {
    this.requireOpen()
    if (this._status === 'model_speaking') this.doInterrupt('user_barge_in')
    if (!AUDIO_ACCEPTING_STATUSES.has(this._status)) {
      throw new Error(`OfflineVoiceSession: cannot accept audio while status is "${this._status}".`)
    }
    if (this._status !== 'user_speaking') {
      this.currentUserTurnId = this.beginTurn('user')
    }
    this.pendingAudioBytes += chunk.data.byteLength
    this.emit({
      type: 'user_transcript_partial',
      turnId: this.currentUserTurnId!,
      text: `${OFFLINE_LABEL} capturing voice input — ${this.pendingAudioBytes} bytes so far.`,
    })
  }

  endUserTurn(): void {
    this.requireOpen()
    if (this._status !== 'user_speaking' || !this.currentUserTurnId) return
    const turnId = this.currentUserTurnId
    const bytes = this.pendingAudioBytes
    this.pendingAudioBytes = 0
    const transcript = `${OFFLINE_LABEL} simulated transcript for ${bytes} bytes of captured audio — the offline session never runs real speech-to-text.`
    void this.finalizeUserTurn(turnId, transcript)
  }

  sendTextInput(text: string): void {
    this.requireOpen()
    const trimmed = text.trim()
    if (!trimmed) return
    if (this._status === 'model_speaking') this.doInterrupt('user_barge_in')
    else if (this._status !== 'listening' && this._status !== 'interrupted') {
      throw new Error(`OfflineVoiceSession: cannot accept text input while status is "${this._status}".`)
    }
    void this.runTextUserTurn(trimmed)
  }

  interrupt(): void {
    this.requireOpen()
    if (this._status !== 'model_speaking') return
    this.doInterrupt('client_cancelled')
    this.schedule(() => {
      if (!this.closed && this._status === 'interrupted') this.setStatus('listening')
    })
  }

  updateContext(context: Partial<VoiceSessionContext>): void {
    this.requireOpen()
    this.context = { ...this.context, ...context }
    this.emit({ type: 'diagnostic', message: 'context updated', data: { fields: Object.keys(context) } })
  }

  deliverAssistantReply(text: string): void {
    this.requireOpen()
    if (this.replySource !== 'external') {
      throw new Error("OfflineVoiceSession: deliverAssistantReply() requires the session to be created with replySource: 'external'.")
    }
    if (!this.pendingExternalReplyResolve) {
      throw new Error('OfflineVoiceSession: no turn is currently awaiting an external reply.')
    }
    const resolve = this.pendingExternalReplyResolve
    this.pendingExternalReplyResolve = null
    resolve(text)
  }

  subscribe(listener: (event: VoiceEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  // -- test-only affordance ----------------------------------------------

  /**
   * Not part of the VoiceSession interface — an offline-only affordance so
   * tests/dev tooling can exercise the error/reconnect path without a real
   * network to fail. A real Gemini Live adapter emits 'error' from actual
   * socket/auth failures instead of this method.
   */
  simulateError(error: VoiceSessionError, recoverable = true): void {
    if (this.closed) return
    this.currentUserTurnId = null
    this.currentModelTurnId = null
    this.emit({ type: 'error', error, recoverable })
    if (recoverable) {
      this.setStatus('error')
    } else {
      this.setStatus('error')
      void this.close(`fatal error: ${error.code}`)
    }
  }

  // -- internals -----------------------------------------------------------

  private requireOpen(): void {
    if (this.closed) throw new Error('OfflineVoiceSession: session is closed.')
    if (this._status === 'idle' || this._status === 'connecting' || this._status === 'error') {
      throw new Error(`OfflineVoiceSession: cannot use the session while status is "${this._status}" — call connect() first.`)
    }
  }

  private sleep(delayMs = this.options.stepDelayMs): Promise<void> {
    return new Promise((resolve) => this.schedule(resolve, delayMs))
  }

  private schedule(fn: () => void, delayMs = this.options.stepDelayMs): void {
    const timer = setTimeout(() => {
      const idx = this.pendingTimers.indexOf(timer)
      if (idx !== -1) this.pendingTimers.splice(idx, 1)
      if (this.closed) return
      fn()
    }, delayMs)
    this.pendingTimers.push(timer)
  }

  private emit(event: VoiceEventInput): void {
    this.seq += 1
    const full = { ...event, seq: this.seq, at: new Date().toISOString(), sessionId: this.id } as VoiceEvent
    for (const listener of this.listeners) listener(full)
  }

  private setStatus(next: VoiceSessionStatus): void {
    const previous = this._status
    if (previous === next) return
    this._status = next
    this.emit({ type: 'status', status: next, previousStatus: previous })
  }

  private beginTurn(role: 'user' | 'model'): string {
    this.turnCounter += 1
    const turnId = `turn-${this.turnCounter}`
    if (role === 'user') this.setStatus('user_speaking')
    this.emit({ type: 'turn_started', turnId, role })
    return turnId
  }

  private doInterrupt(reason: 'user_barge_in' | 'client_cancelled'): void {
    const turnId = this.currentModelTurnId
    if (!turnId) return
    this.currentModelTurnId = null
    this.emit({ type: 'interrupted', interruptedTurnId: turnId, reason })
    this.emit({ type: 'turn_ended', turnId, role: 'model', reason: 'interrupted' })
    this.setStatus('interrupted')
  }

  private async runTextUserTurn(fullText: string): Promise<void> {
    const turnId = this.beginTurn('user')
    this.currentUserTurnId = turnId
    const words = fullText.split(/\s+/).filter(Boolean)
    let partial = ''
    for (const word of words) {
      if (this.closed || this.currentUserTurnId !== turnId) return
      partial = partial ? `${partial} ${word}` : word
      this.emit({ type: 'user_transcript_partial', turnId, text: partial })
      await this.sleep()
    }
    if (this.closed || this.currentUserTurnId !== turnId) return
    await this.finalizeUserTurn(turnId, fullText)
  }

  private async finalizeUserTurn(turnId: string, fullText: string): Promise<void> {
    if (this.closed) return
    this.emit({ type: 'user_transcript_final', turnId, text: fullText, languageHint: this.context.language.primary })
    this.emit({ type: 'turn_ended', turnId, role: 'user', reason: 'completed' })
    this.currentUserTurnId = null
    this.setStatus('processing')
    await this.runModelTurn(fullText)
  }

  private async runModelTurn(userText: string): Promise<void> {
    if (this.replySource === 'external') {
      // No artificial pre-delay here (unlike the provider path below) — we
      // are already waiting on an external promise, and adding one would
      // only open a race where a fast controller/runtime could call
      // deliverAssistantReply() before pendingExternalReplyResolve is even
      // registered. Register it synchronously, immediately, so that can
      // never happen: by the time ANY subscriber's async reaction to the
      // user_transcript_final event (emitted moments ago, in the same
      // synchronous turn) gets far enough to call deliverAssistantReply(),
      // this registration has already happened.
      const modelTurnId = `turn-${(this.turnCounter += 1)}`
      this.currentModelTurnId = modelTurnId
      // Status deliberately stays 'processing' — there is no content yet to
      // justify 'model_speaking' until the host actually delivers one.
      const delivered = await new Promise<string>((resolve) => {
        this.pendingExternalReplyResolve = resolve
      })
      this.pendingExternalReplyResolve = null
      if (this.closed || this.currentModelTurnId !== modelTurnId) return // closed while waiting, or superseded
      this.setStatus('model_speaking')
      this.emit({ type: 'turn_started', turnId: modelTurnId, role: 'model' })
      await this.streamReply(modelTurnId, delivered)
      return
    }

    await this.sleep()
    if (this.closed) return

    const modelTurnId = `turn-${(this.turnCounter += 1)}`
    this.currentModelTurnId = modelTurnId
    this.setStatus('model_speaking')
    this.emit({ type: 'turn_started', turnId: modelTurnId, role: 'model' })

    const replyText = this.options.replyFor(userText, this.turnCounter)
    await this.streamReply(modelTurnId, replyText)
  }

  private async streamReply(modelTurnId: string, replyText: string): Promise<void> {
    const words = replyText.split(/\s+/).filter(Boolean)
    let partial = ''
    for (const word of words) {
      if (this.closed || this.currentModelTurnId !== modelTurnId) return
      partial = partial ? `${partial} ${word}` : word
      this.emit({ type: 'model_text_partial', turnId: modelTurnId, text: partial })
      await this.sleep()
    }
    if (this.closed || this.currentModelTurnId !== modelTurnId) return
    this.emit({ type: 'model_text_final', turnId: modelTurnId, text: replyText })

    for (let i = 0; i < 2; i++) {
      if (this.closed || this.currentModelTurnId !== modelTurnId) return
      this.emit({ type: 'model_audio_chunk', turnId: modelTurnId, chunk: mockAudioChunk(i) })
      await this.sleep()
    }
    if (this.closed || this.currentModelTurnId !== modelTurnId) return
    this.emit({ type: 'model_audio_end', turnId: modelTurnId })
    this.emit({ type: 'turn_ended', turnId: modelTurnId, role: 'model', reason: 'completed' })
    this.currentModelTurnId = null
    this.setStatus('listening')
  }
}

export function createOfflineVoiceSession(config: VoiceSessionConfig, options?: OfflineVoiceSessionOptions): OfflineVoiceSession {
  return new OfflineVoiceSession(config, options)
}

export const offlineVoiceSessionFactory: VoiceSessionFactory = {
  providerId: 'offline',
  isSupported: () => Promise.resolve(true),
  create: (config) => new OfflineVoiceSession(config),
}
