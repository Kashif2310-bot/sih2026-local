/**
 * GeminiLiveVoiceSession — the real Gemini Live adapter. Implements the
 * provider-independent VoiceSession contract (src/assistant/voice/types.ts)
 * on top of GeminiLiveTransport, translating Gemini's actual wire protocol
 * (geminiLiveProtocol.ts) into VoiceEvents and back. The UI depends only on
 * VoiceSession — nothing about Gemini's message shapes, WebSocket details,
 * or authentication leaks past this file and its two supporting modules
 * (geminiLiveProtocol.ts, geminiLiveTransport.ts).
 *
 * AI SAFETY BOUNDARY: this class is a transport/translation layer only. It
 * never computes eligibility, LokScore, or scheme facts, and never decides
 * what the model is allowed to say — see docs/voice-session-architecture.md
 * and the VoiceTurnPipelineHandler seam in types.ts for where that
 * deterministic pipeline plugs in later. Nothing here duplicates it.
 */

import {
  buildAudioChunkMessage,
  buildAudioStreamEndMessage,
  buildSetupMessage,
  buildTextTurnMessage,
  base64ToArrayBuffer,
  arrayBufferToBase64,
  languageCodeFor,
  GEMINI_LIVE_INPUT_SAMPLE_RATE_HZ,
  GEMINI_LIVE_OUTPUT_SAMPLE_RATE_HZ,
} from './geminiLiveProtocol'
import {
  WebSocketGeminiLiveTransport,
  type GeminiLiveConnectionResolver,
  type GeminiLiveTransport,
  type GeminiLiveTransportCloseInfo,
} from './geminiLiveTransport'
import type { GeminiLiveServerMessage } from './geminiLiveProtocol'
import {
  GEMINI_LIVE_INTERRUPT_SETTLE_TIMEOUT_MS,
  GEMINI_LIVE_MODEL,
  GEMINI_LIVE_SETUP_TIMEOUT_MS,
  defaultGeminiLiveConnectionResolver,
  isGeminiLiveConfigured,
} from './geminiLiveConfig'
import type {
  VoiceAudioChunk,
  VoiceEvent,
  VoiceEventInput,
  VoiceReplySource,
  VoiceSession,
  VoiceSessionConfig,
  VoiceSessionContext,
  VoiceSessionError,
  VoiceSessionErrorCode,
  VoiceSessionFactory,
  VoiceSessionStatus,
} from './types'

const ACTIVE_STATUSES: ReadonlySet<VoiceSessionStatus> = new Set([
  'connected',
  'listening',
  'user_speaking',
  'processing',
  'model_speaking',
  'interrupted',
])

const AUDIO_ACCEPTING_STATUSES: ReadonlySet<VoiceSessionStatus> = new Set(['listening', 'interrupted', 'user_speaking'])

function defaultIdGenerator(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `gemini-live-${crypto.randomUUID()}`
  }
  return `gemini-live-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

interface SetupWaiter {
  resolve: () => void
  reject: (error: Error) => void
}

export interface GeminiLiveVoiceSessionDeps {
  /** Produces a fresh transport for each connection attempt — a transport is single-connection/single-use, so reconnecting always builds a new one. */
  createTransport: () => GeminiLiveTransport
  /** Resolves the connection target at connect() time. See geminiLiveConfig.ts for the two supported backend patterns. */
  resolveConnection: GeminiLiveConnectionResolver
  /** Cheap, synchronous "is Gemini Live even configured" check, used for VoiceSessionFactory.isSupported() — must never make a network call. */
  isConfigured: () => boolean
  model?: string
  /** Overrides GEMINI_LIVE_SETUP_TIMEOUT_MS — injectable so tests can exercise the timeout path quickly rather than waiting out the real production value. */
  setupTimeoutMs?: number
  /** Overrides GEMINI_LIVE_INTERRUPT_SETTLE_TIMEOUT_MS — same reasoning. */
  interruptSettleTimeoutMs?: number
}

export class GeminiLiveVoiceSession implements VoiceSession {
  readonly id: string

  private _status: VoiceSessionStatus = 'idle'
  private closed = false
  private seq = 0
  private turnCounter = 0
  private readonly listeners = new Set<(event: VoiceEvent) => void>()
  private readonly pendingTimers: Array<ReturnType<typeof setTimeout>> = []
  private context: VoiceSessionContext
  private readonly deps: GeminiLiveVoiceSessionDeps
  private readonly model: string
  private readonly replySource: VoiceReplySource

  private transport: GeminiLiveTransport | null = null
  private unsubscribers: Array<() => void> = []
  private setupWaiter: SetupWaiter | null = null
  private readonly setupTimeoutMs: number
  private readonly interruptSettleTimeoutMs: number

  private currentUserTurnId: string | null = null
  /** Persists past currentUserTurnId being cleared, so a late-arriving server transcription can still be correlated to the turn it belongs to. */
  private lastUserTurnId: string | null = null
  private currentModelTurnId: string | null = null
  private modelTextBuffer = ''
  /** True from the moment we locally interrupt a model turn until we see that turn's server-side boundary confirmation (or a fallback timeout) — see the "Interruption flow" docs. */
  private suppressServerContentUntilBoundary = false

  constructor(config: VoiceSessionConfig, deps: GeminiLiveVoiceSessionDeps, idGenerator: () => string = defaultIdGenerator) {
    this.id = idGenerator()
    this.context = { language: config.language, applicantProfile: config.applicantProfile }
    this.deps = deps
    this.model = deps.model ?? GEMINI_LIVE_MODEL
    this.setupTimeoutMs = deps.setupTimeoutMs ?? GEMINI_LIVE_SETUP_TIMEOUT_MS
    this.interruptSettleTimeoutMs = deps.interruptSettleTimeoutMs ?? GEMINI_LIVE_INTERRUPT_SETTLE_TIMEOUT_MS
    this.replySource = config.replySource ?? 'provider'
  }

  get status(): VoiceSessionStatus {
    return this._status
  }

  // -- lifecycle -----------------------------------------------------------

  async connect(): Promise<void> {
    if (this.closed) {
      throw new Error('GeminiLiveVoiceSession: cannot connect() a closed session — create a new one via the factory.')
    }
    if (this._status === 'connecting') return
    if (ACTIVE_STATUSES.has(this._status)) return

    this.setStatus('connecting')
    this.teardownTransport()

    const transport = this.deps.createTransport()
    this.transport = transport
    this.unsubscribers.push(transport.onMessage((message) => this.handleServerMessage(message)))
    this.unsubscribers.push(transport.onError((error) => this.handleTransportError(error)))
    this.unsubscribers.push(transport.onClose((info) => this.handleTransportClose(info)))

    try {
      const target = await this.deps.resolveConnection()
      await transport.connect(target)
      this.setStatus('connected')
      transport.send(
        buildSetupMessage({
          model: this.model,
          languageCode: languageCodeFor(this.context.language.primary),
        }),
      )
      await this.waitForSetupComplete()
    } catch (cause) {
      this.failConnect('connection_failed', cause)
      throw cause instanceof Error ? cause : new Error(String(cause))
    }

    this.setStatus('listening')
  }

  async close(reason = 'client_requested'): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.clearAllTimers()
    this.setupWaiter = null
    this.currentUserTurnId = null
    this.currentModelTurnId = null
    this.teardownTransport()
    this.emit({ type: 'diagnostic', message: `session closed: ${reason}` })
    this.setStatus('closed')
    this.listeners.clear()
  }

  // -- input -----------------------------------------------------------------

  sendAudioChunk(chunk: VoiceAudioChunk): void {
    this.requireOpen()
    this.requireExpectedAudioFormat(chunk)

    if (this._status === 'model_speaking') this.beginInterruption('user_barge_in')
    if (!AUDIO_ACCEPTING_STATUSES.has(this._status)) {
      throw new Error(`GeminiLiveVoiceSession: cannot accept audio while status is "${this._status}".`)
    }
    if (this._status !== 'user_speaking') {
      this.currentUserTurnId = this.beginTurn('user')
    }

    this.transport!.send(buildAudioChunkMessage(arrayBufferToBase64(chunk.data)))
  }

  endUserTurn(): void {
    this.requireOpen()
    if (this._status !== 'user_speaking' || !this.currentUserTurnId) return
    const turnId = this.currentUserTurnId
    this.transport!.send(buildAudioStreamEndMessage())
    this.emit({ type: 'turn_ended', turnId, role: 'user', reason: 'completed' })
    this.currentUserTurnId = null
    this.setStatus('processing')
  }

  sendTextInput(text: string): void {
    this.requireOpen()
    const trimmed = text.trim()
    if (!trimmed) return

    if (this._status === 'model_speaking') this.beginInterruption('user_barge_in')
    else if (this._status !== 'listening' && this._status !== 'interrupted') {
      throw new Error(`GeminiLiveVoiceSession: cannot accept text input while status is "${this._status}".`)
    }

    const turnId = this.beginTurn('user')
    this.currentUserTurnId = turnId
    // A typed message needs no server-side transcription — what the citizen
    // typed IS the final transcript, verbatim. (Contrast with the audio
    // path, where the transcript only exists once Gemini reports it back —
    // see handleServerMessage's inputTranscription handling.)
    this.emit({ type: 'user_transcript_final', turnId, text: trimmed, languageHint: this.context.language.primary })
    this.emit({ type: 'turn_ended', turnId, role: 'user', reason: 'completed' })
    this.currentUserTurnId = null

    this.transport!.send(buildTextTurnMessage(trimmed))
    this.setStatus('processing')
  }

  interrupt(): void {
    this.requireOpen()
    if (this._status !== 'model_speaking') return
    this.beginInterruption('client_cancelled')
  }

  updateContext(context: Partial<VoiceSessionContext>): void {
    this.requireOpen()
    this.context = { ...this.context, ...context }
    this.emit({ type: 'diagnostic', message: 'context updated', data: { fields: Object.keys(context) } })
    // Gemini's `setup` message is documented as the message sent once, at
    // the start of the session — there is no documented mid-session
    // reconfiguration call. An updated ApplicantProfile therefore doesn't
    // reach the model until the pipeline seam (types.ts) folds it into a
    // future turn's outgoing content; this method still satisfies "no
    // reconnect required" in the sense that mattered for this phase — the
    // WebSocket itself stays open and updateContext() never tears it down.
  }

  /**
   * Text delivery is complete and reliable — see the module doc comment's
   * AI safety boundary. HONEST LIMITATION: this adapter has no verified
   * mechanism (per the Live API reference this was built against — see
   * geminiLiveProtocol.ts) to make Gemini Live speak arbitrary
   * externally-supplied text as audio, so no model_audio_chunk is emitted
   * here. Audio playback of controller-authored replies is out of scope
   * for this phase regardless (see docs/voice-session-architecture.md
   * "Remaining work" — audio playback is future voice-UI work) and would
   * need either a verified clientContent role:'model' mechanism or a
   * separate TTS integration.
   */
  deliverAssistantReply(text: string): void {
    this.requireOpen()
    if (this.replySource !== 'external') {
      throw new Error("GeminiLiveVoiceSession: deliverAssistantReply() requires the session to be created with replySource: 'external'.")
    }
    if (this._status !== 'processing') {
      throw new Error(`GeminiLiveVoiceSession: cannot deliver an assistant reply while status is "${this._status}" — expected 'processing'.`)
    }
    const modelTurnId = this.beginTurn('model')
    this.currentModelTurnId = modelTurnId
    this.emit({ type: 'model_text_final', turnId: modelTurnId, text })
    this.emit({ type: 'model_audio_end', turnId: modelTurnId })
    this.emit({ type: 'turn_ended', turnId: modelTurnId, role: 'model', reason: 'completed' })
    this.currentModelTurnId = null
    this.setStatus('listening')
  }

  subscribe(listener: (event: VoiceEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  // -- transport event handling ----------------------------------------------

  private handleServerMessage(message: GeminiLiveServerMessage): void {
    if (this.closed) return

    if ('setupComplete' in message) {
      const waiter = this.setupWaiter
      this.setupWaiter = null
      waiter?.resolve()
      return
    }

    if ('error' in message) {
      this.emit({ type: 'error', error: { code: 'provider_error', message: message.error.message }, recoverable: true })
      return
    }

    const sc = message.serverContent

    if (this.suppressServerContentUntilBoundary) {
      if (sc.interrupted || sc.turnComplete) {
        this.suppressServerContentUntilBoundary = false
        // The interrupted old turn has now genuinely wound down server-side.
        // If no new turn has started locally in the meantime (status is
        // still 'interrupted'), we're clear to go back to listening right
        // now rather than waiting for the fallback timer.
        if (this._status === 'interrupted') this.setStatus('listening')
      }
      return
    }

    // The citizen's own speech, transcribed server-side — never fabricated locally.
    if (sc.interimInputTranscription && this.lastUserTurnId) {
      this.emit({ type: 'user_transcript_partial', turnId: this.lastUserTurnId, text: sc.interimInputTranscription.text })
    }
    if (sc.inputTranscription && this.lastUserTurnId) {
      this.emit({
        type: 'user_transcript_final',
        turnId: this.lastUserTurnId,
        text: sc.inputTranscription.text,
        languageHint: this.context.language.primary,
      })
    }

    if (this.replySource === 'external') {
      // Controller-authored mode: Gemini's own autonomous reply content is
      // never translated into model_text/model_audio events — the model
      // turn exists only via deliverAssistantReply(). The citizen's own
      // transcription above still flows through normally.
      return
    }

    const hasModelOutput = Boolean(sc.modelTurn) || Boolean(sc.outputTranscription)
    if (hasModelOutput && !this.currentModelTurnId) {
      this.currentModelTurnId = this.beginTurn('model')
      this.modelTextBuffer = ''
    }

    if (this.currentModelTurnId) {
      const turnId = this.currentModelTurnId
      let textAppended = false
      for (const part of sc.modelTurn?.parts ?? []) {
        if (part.text) {
          this.modelTextBuffer += part.text
          textAppended = true
        }
        if (part.inlineData) {
          this.emit({
            type: 'model_audio_chunk',
            turnId,
            chunk: {
              format: 'pcm16',
              sampleRateHz: GEMINI_LIVE_OUTPUT_SAMPLE_RATE_HZ,
              data: base64ToArrayBuffer(part.inlineData.data),
            },
          })
        }
      }
      if (sc.outputTranscription) {
        this.modelTextBuffer += sc.outputTranscription.text
        textAppended = true
      }
      if (textAppended) {
        this.emit({ type: 'model_text_partial', turnId, text: this.modelTextBuffer })
      }
    }

    if (sc.interrupted && this.currentModelTurnId) {
      const turnId = this.currentModelTurnId
      this.currentModelTurnId = null
      this.modelTextBuffer = ''
      this.emit({ type: 'interrupted', interruptedTurnId: turnId, reason: 'user_barge_in' })
      this.emit({ type: 'turn_ended', turnId, role: 'model', reason: 'interrupted' })
      this.setStatus('listening')
      return
    }

    if (sc.turnComplete && this.currentModelTurnId) {
      const turnId = this.currentModelTurnId
      this.emit({ type: 'model_text_final', turnId, text: this.modelTextBuffer })
      this.emit({ type: 'model_audio_end', turnId })
      this.emit({ type: 'turn_ended', turnId, role: 'model', reason: 'completed' })
      this.currentModelTurnId = null
      this.modelTextBuffer = ''
      this.setStatus('listening')
    }
  }

  private handleTransportError(error: VoiceSessionError): void {
    if (this.closed) return
    // A WebSocket 'error' event is reliably followed by 'close' — actual
    // state transitions happen in handleTransportClose so a transient
    // error notification can't fork the state machine down two paths.
    this.emit({ type: 'error', error, recoverable: true })
  }

  private handleTransportClose(info: GeminiLiveTransportCloseInfo): void {
    if (this.closed) return

    const waiter = this.setupWaiter
    this.setupWaiter = null
    if (waiter) {
      // connect() is still awaiting setupComplete — reject through that
      // path (its catch block calls failConnect) so this failure is
      // reported exactly once, not twice.
      waiter.reject(new Error(`Gemini Live connection closed before setup completed${info.reason ? `: ${info.reason}` : '.'}`))
      return
    }

    this.currentUserTurnId = null
    this.currentModelTurnId = null
    this.emit({
      type: 'error',
      error: { code: 'network_lost', message: `Gemini Live connection closed unexpectedly${info.reason ? `: ${info.reason}` : '.'}` },
      recoverable: true,
    })
    this.setStatus('error')
  }

  // -- internals ---------------------------------------------------------------

  private requireOpen(): void {
    if (this.closed) throw new Error('GeminiLiveVoiceSession: session is closed.')
    if (this._status === 'idle' || this._status === 'connecting' || this._status === 'error') {
      throw new Error(`GeminiLiveVoiceSession: cannot use the session while status is "${this._status}" — call connect() first.`)
    }
  }

  private requireExpectedAudioFormat(chunk: VoiceAudioChunk): void {
    if (chunk.format !== 'pcm16') {
      throw new Error(
        `GeminiLiveVoiceSession: expected a 'pcm16' audio chunk (raw 16-bit PCM, mono, little-endian, ${GEMINI_LIVE_INPUT_SAMPLE_RATE_HZ}Hz) but received format "${chunk.format}". Resampling/encoding raw microphone audio to this format is the browser capture layer's job, not this adapter's — see docs/voice-session-architecture.md "Audio format boundary".`,
      )
    }
    if (chunk.sampleRateHz !== undefined && chunk.sampleRateHz !== GEMINI_LIVE_INPUT_SAMPLE_RATE_HZ) {
      throw new Error(
        `GeminiLiveVoiceSession: expected ${GEMINI_LIVE_INPUT_SAMPLE_RATE_HZ}Hz audio but received a chunk declaring ${chunk.sampleRateHz}Hz. Resample before calling sendAudioChunk().`,
      )
    }
  }

  private failConnect(code: VoiceSessionErrorCode, cause: unknown): void {
    if (this.closed) return
    this.teardownTransport()
    this.emit({ type: 'error', error: { code, message: cause instanceof Error ? cause.message : String(cause) }, recoverable: true })
    this.setStatus('error')
  }

  private teardownTransport(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe()
    this.unsubscribers = []
    this.transport?.close()
    this.transport = null
  }

  private waitForSetupComplete(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = this.schedule(() => {
        this.setupWaiter = null
        reject(new Error(`GeminiLiveVoiceSession: timed out after ${this.setupTimeoutMs}ms waiting for setupComplete.`))
      }, this.setupTimeoutMs)
      this.setupWaiter = {
        resolve: () => {
          this.clearTimer(timer)
          resolve()
        },
        reject: (error) => {
          this.clearTimer(timer)
          reject(error)
        },
      }
    })
  }

  private schedule(fn: () => void, delayMs: number): ReturnType<typeof setTimeout> {
    const timer = setTimeout(() => {
      const idx = this.pendingTimers.indexOf(timer)
      if (idx !== -1) this.pendingTimers.splice(idx, 1)
      if (this.closed) return
      fn()
    }, delayMs)
    this.pendingTimers.push(timer)
    return timer
  }

  private clearTimer(timer: ReturnType<typeof setTimeout>): void {
    clearTimeout(timer)
    const idx = this.pendingTimers.indexOf(timer)
    if (idx !== -1) this.pendingTimers.splice(idx, 1)
  }

  private clearAllTimers(): void {
    for (const t of this.pendingTimers) clearTimeout(t)
    this.pendingTimers.length = 0
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
    if (role === 'user') {
      this.setStatus('user_speaking')
      this.lastUserTurnId = turnId
    } else {
      this.setStatus('model_speaking')
    }
    this.emit({ type: 'turn_started', turnId, role })
    return turnId
  }

  /**
   * The one place a model turn gets cut off — see docs/voice-session-architecture.md
   * "Interruption flow". Locally-optimistic: stops this adapter from
   * translating any further output for the interrupted turn IMMEDIATELY,
   * rather than waiting for the server's own confirmation, because the
   * requirement ("buffered model audio must not continue playing") is
   * about what THIS layer hands upward, not about what Gemini's servers do
   * internally. suppressServerContentUntilBoundary then swallows trailing
   * stale messages for the old turn until we see its boundary signal (or a
   * bounded fallback fires) — see GEMINI_LIVE_INTERRUPT_SETTLE_TIMEOUT_MS.
   */
  private beginInterruption(reason: 'user_barge_in' | 'client_cancelled'): void {
    const turnId = this.currentModelTurnId
    if (!turnId) return
    this.currentModelTurnId = null
    this.modelTextBuffer = ''
    this.suppressServerContentUntilBoundary = true
    this.emit({ type: 'interrupted', interruptedTurnId: turnId, reason })
    this.emit({ type: 'turn_ended', turnId, role: 'model', reason: 'interrupted' })
    this.setStatus('interrupted')

    this.schedule(() => {
      this.suppressServerContentUntilBoundary = false
      if (this._status === 'interrupted') this.setStatus('listening')
    }, this.interruptSettleTimeoutMs)
  }
}

export function createGeminiLiveVoiceSessionFactory(deps: Partial<GeminiLiveVoiceSessionDeps> = {}): VoiceSessionFactory {
  const resolvedDeps: GeminiLiveVoiceSessionDeps = {
    createTransport: deps.createTransport ?? (() => new WebSocketGeminiLiveTransport()),
    resolveConnection: deps.resolveConnection ?? defaultGeminiLiveConnectionResolver,
    isConfigured: deps.isConfigured ?? isGeminiLiveConfigured,
    model: deps.model ?? GEMINI_LIVE_MODEL,
    setupTimeoutMs: deps.setupTimeoutMs ?? GEMINI_LIVE_SETUP_TIMEOUT_MS,
    interruptSettleTimeoutMs: deps.interruptSettleTimeoutMs ?? GEMINI_LIVE_INTERRUPT_SETTLE_TIMEOUT_MS,
  }
  return {
    providerId: 'gemini-live',
    isSupported: () => Promise.resolve(resolvedDeps.isConfigured()),
    create: (config) => new GeminiLiveVoiceSession(config, resolvedDeps),
  }
}

/**
 * Ready-to-use default factory, wired to the real WebSocket transport and
 * this repo's config. Safe to import even with no Gemini backend configured
 * — isSupported() correctly resolves false and no connection is ever
 * attempted; see geminiLiveConfig.ts.
 */
export const geminiLiveVoiceSessionFactory: VoiceSessionFactory = createGeminiLiveVoiceSessionFactory()
