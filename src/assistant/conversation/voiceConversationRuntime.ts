/**
 * VoiceConversationRuntime — the thin coordinator that wires a VoiceSession
 * (src/assistant/voice/) to a VoiceAssistantController (./voiceAssistantController.ts).
 *
 *   VoiceSession --events--> VoiceConversationRuntime --transcript--> VoiceAssistantController
 *   VoiceConversationRuntime <--replyText-- VoiceAssistantController
 *   VoiceConversationRuntime --deliverAssistantReply()--> VoiceSession
 *
 * This file is ORCHESTRATION ONLY. It contains no eligibility, ranking,
 * profile-extraction, or response-generation logic of its own — all of
 * that stays in VoiceAssistantController, which stays in charge of:
 *   - extracting profile facts / merging ApplicantProfile
 *   - missing-field detection, question selection
 *   - retrieval/ranking, evidence invalidation
 *   - readiness, report generation
 *   - response generation (via the existing guarded ai/responseGuard.ts
 *     pipeline — never bypassed, never duplicated here)
 * The runtime's only job is turn correlation, concurrency safety, and
 * translating between VoiceSession's event/status vocabulary and a
 * consumer-friendly, provider-independent state.
 *
 * PROVIDER INDEPENDENCE: nothing in this file imports from
 * geminiLive*.ts or offlineVoiceSession.ts, or references a Gemini
 * message shape, a WebSocket, or a browser audio API. It depends only on
 * the VoiceSession/VoiceEvent contract (../voice/types.ts). The same
 * runtime works identically with OfflineVoiceSession, GeminiLiveVoiceSession,
 * or any future VoiceSession implementation — see
 * voiceConversationRuntime.test.ts's "provider independence" tests.
 *
 * CONTROLLER-AUTHORED REPLIES: this runtime requires the VoiceSession it is
 * given to have been created with `replySource: 'external'` (see
 * ../voice/types.ts and docs/voice-session-architecture.md "Controller-
 * authored replies"). That flag makes the session wait for
 * deliverAssistantReply() instead of generating its own reply autonomously
 * — required so the deterministic, guarded VoiceAssistantController stays
 * the sole source of truth for what gets said, per LokPulse's AI safety
 * boundary (a voice provider must never become an independent source of
 * government facts).
 */

import type {
  VoiceEvent,
  VoiceSession,
  VoiceSessionError,
  VoiceSessionStatus,
} from '../voice/types'
import type { VoiceAssistantController, VoiceAssistantTurnResult } from './voiceAssistantController'

/**
 * The one capability this runtime actually depends on from
 * VoiceAssistantController, narrowed to an interface (dependency
 * inversion, not "a second controller") so voiceConversationRuntime.test.ts
 * can exercise concurrency/error-handling races with a lightweight test
 * double — the real controller is deliberately resilient (every internal
 * step already fails gracefully), which makes genuinely forcing it to
 * throw for a test awkward without one. VoiceAssistantController satisfies
 * this structurally, unchanged; real callers always pass a real one.
 */
export interface ConversationTurnHandler {
  handleUserTranscript(transcript: string, turnId?: string): Promise<VoiceAssistantTurnResult>
}

/**
 * A consumer-friendly, deliberately coarser view of VoiceSessionStatus —
 * not a second state machine. Every value here is a pure, total mapping
 * from VoiceSessionStatus (see mapVoiceStatusToAudioState below); the
 * runtime never tracks its own independent notion of "is the assistant
 * speaking" that could drift from what the session itself reports.
 */
export type AssistantAudioState = 'idle' | 'listening' | 'processing' | 'speaking' | 'interrupted' | 'error' | 'closed'

export type RuntimeErrorSource = 'session' | 'controller'

export interface RuntimeError {
  source: RuntimeErrorSource
  code: string
  message: string
  cause?: unknown
  /** True if the runtime was able to recover the session back to a usable state (e.g. by delivering a fallback reply so it returns to 'listening'). */
  recovered: boolean
}

export type RuntimeEvent =
  | { type: 'audio_state_changed'; audioState: AssistantAudioState; previous: AssistantAudioState }
  | { type: 'turn_completed'; result: VoiceAssistantTurnResult }
  | { type: 'error'; error: RuntimeError }
  | { type: 'closed' }

const CONTROLLER_ERROR_FALLBACK_TEXT =
  "Sorry, something went wrong while I was thinking about that — could you say it again?"

function mapVoiceStatusToAudioState(status: VoiceSessionStatus): AssistantAudioState {
  switch (status) {
    case 'idle':
    case 'connecting':
    case 'connected':
      return 'idle'
    case 'listening':
    case 'user_speaking':
      return 'listening'
    case 'processing':
      return 'processing'
    case 'model_speaking':
      return 'speaking'
    case 'interrupted':
      return 'interrupted'
    case 'error':
      return 'error'
    case 'closed':
      return 'closed'
  }
}

export interface VoiceConversationRuntimeDeps<TController extends ConversationTurnHandler = VoiceAssistantController> {
  session: VoiceSession
  controller: TController
}

export class VoiceConversationRuntime<TController extends ConversationTurnHandler = VoiceAssistantController> {
  private readonly session: VoiceSession
  private readonly controller: TController
  private unsubscribeSession: (() => void) | null = null
  private _audioState: AssistantAudioState = 'idle'
  private readonly listeners = new Set<(event: RuntimeEvent) => void>()
  private disposed = false

  /**
   * Monotonic turn-sequence token — the "simple runtime turn token"
   * mentioned in the design brief. Every finalized transcript, and every
   * session-level interruption, claims a fresh token; a controller call
   * only gets to deliver its reply if the token it captured is still the
   * CURRENT one when it resolves. This is what makes CASE 1 (rapid
   * back-to-back finals), CASE 2/3 (interruption mid-flight or stale
   * server content), and CASE 6 (duplicate final events) all safe without
   * needing provider-specific turn ids — see voiceConversationRuntime.test.ts.
   */
  private turnToken = 0
  private readonly seenFinalTurnIds = new Set<string>()

  constructor(deps: VoiceConversationRuntimeDeps<TController>) {
    this.session = deps.session
    this.controller = deps.controller
    this.unsubscribeSession = this.session.subscribe((event) => this.handleVoiceEvent(event))
  }

  get audioState(): AssistantAudioState {
    return this._audioState
  }

  getSession(): VoiceSession {
    return this.session
  }

  getController(): TController {
    return this.controller
  }

  subscribe(listener: (event: RuntimeEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** create -> attach (constructor) -> start/connect. */
  async start(): Promise<void> {
    await this.session.connect()
  }

  /**
   * Text fallback — development, accessibility, testing, or a future text
   * UI. Routes through the SAME session -> event -> controller pipeline as
   * spoken input (session.sendTextInput -> a real user_transcript_final
   * event -> handleVoiceEvent, identical to the voice path), so there is
   * exactly one turn-handling code path, never a second one.
   */
  sendText(text: string): void {
    this.session.sendTextInput(text)
  }

  /** Client-initiated barge-in — delegates directly to the session; see VoiceSession.interrupt(). */
  interrupt(): void {
    this.session.interrupt()
  }

  /** close/dispose. Safe to call more than once. Detaches listeners and closes the underlying session. */
  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.turnToken += 1 // invalidate anything still in flight
    this.unsubscribeSession?.()
    this.unsubscribeSession = null
    try {
      await this.session.close('runtime disposed')
    } catch {
      // The session may already be closed or mid-error — dispose() must still complete cleanly regardless.
    }
    this.setAudioState('closed')
    this.emit({ type: 'closed' })
    this.listeners.clear()
  }

  // -- internals -------------------------------------------------------------

  private handleVoiceEvent(event: VoiceEvent): void {
    if (this.disposed) return

    switch (event.type) {
      case 'status':
        this.setAudioState(mapVoiceStatusToAudioState(event.status))
        if (event.status === 'interrupted') {
          // Whatever was in flight for the turn that just got cut off (an
          // explicit interrupt(), or a barge-in the session detected on its
          // own) is no longer relevant — see CASE 2/3 in the module doc.
          this.turnToken += 1
        }
        return
      case 'user_transcript_final':
        this.handleFinalTranscript(event.turnId, event.text)
        return
      case 'error':
        this.handleSessionError(event.error, event.recoverable)
        return
      default:
        // Partial transcripts, model_text/audio events, turn_started/ended,
        // and diagnostics are intentionally NOT acted on here — the runtime
        // reacts only to what changes conversation state (a FINAL
        // transcript) or requires error handling, never to partial/interim
        // provider chatter. Audio playback of model_audio_chunk belongs to
        // a future audio-transport layer, explicitly out of scope here.
        return
    }
  }

  private handleSessionError(error: VoiceSessionError, recoverable: boolean): void {
    this.emit({
      type: 'error',
      error: { source: 'session', code: error.code, message: error.message, cause: error.cause, recovered: recoverable },
    })
  }

  private handleFinalTranscript(turnId: string, rawText: string): void {
    const text = rawText.trim()
    if (!text) return // malformed/empty — ignore safely, never reaches the controller
    if (this.seenFinalTurnIds.has(turnId)) return // CASE 6 — duplicate final event for a turn already processed/in-flight
    this.seenFinalTurnIds.add(turnId)

    const myToken = (this.turnToken += 1)
    void this.processTurn(text, turnId, myToken)
  }

  private isStale(myToken: number): boolean {
    return this.disposed || myToken !== this.turnToken
  }

  private async processTurn(text: string, voiceTurnId: string, myToken: number): Promise<void> {
    let result: VoiceAssistantTurnResult
    try {
      result = await this.controller.handleUserTranscript(text, voiceTurnId)
    } catch (cause) {
      // CASE 5 — controller threw. ConversationState is untouched (the
      // controller only reassigns its internal state at the very end of a
      // successful handleUserTranscript call), so nothing here is lost.
      if (this.isStale(myToken)) return
      const message = cause instanceof Error ? cause.message : String(cause)
      const recovered = this.tryDeliverFallback(CONTROLLER_ERROR_FALLBACK_TEXT)
      this.emit({ type: 'error', error: { source: 'controller', code: 'controller_error', message, cause, recovered } })
      return
    }

    // CASE 1/2/3 — a newer turn superseded this one (another final
    // transcript arrived, or an interruption happened) while the controller
    // was thinking. Never deliver a now-stale reply.
    if (this.isStale(myToken)) return
    // CASE 4 — the session closed while we were processing.
    if (this.session.status === 'closed') return

    this.tryDeliverFallback(result.replyText)
    this.emit({ type: 'turn_completed', result })
  }

  /** Attempts delivery; swallows a delivery failure (e.g. the session is no longer in 'processing' because it errored/closed concurrently) rather than throwing out of an event handler. Returns whether delivery succeeded. */
  private tryDeliverFallback(text: string): boolean {
    try {
      this.session.deliverAssistantReply(text)
      return true
    } catch {
      return false
    }
  }

  private setAudioState(next: AssistantAudioState): void {
    if (this._audioState === next) return
    const previous = this._audioState
    this._audioState = next
    this.emit({ type: 'audio_state_changed', audioState: next, previous })
  }

  private emit(event: RuntimeEvent): void {
    for (const listener of this.listeners) listener(event)
  }
}
