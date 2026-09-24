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
  VoiceToolCall,
} from '../voice/types'
import type { VoiceAssistantController, VoiceAssistantTurnResult } from './voiceAssistantController'
import { runVoiceToolCall, type VoiceToolDeps } from './voiceTools'

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
  /** A transcript from the NATIVE-AUDIO path, where the provider spoke its own words — carries text for the shared conversation view, not a controller-authored reply. */
  | { type: 'transcript'; role: 'user' | 'assistant'; text: string; turnId: string }
  /** Conversation state changed because a provider tool call wrote to it — the UI should re-read the controller. */
  | { type: 'state_changed' }
  | { type: 'tool_call'; names: string[] }
  | { type: 'error'; error: RuntimeError }
  | { type: 'closed' }

/**
 * Who authors the assistant's words.
 *
 *   'controller' — the deterministic pipeline writes the reply and the
 *       session speaks it via deliverAssistantReply(). Every prior phase's
 *       behavior; requires the session be created with replySource:'external'.
 *   'provider'   — the provider generates and speaks its own native audio.
 *       The controller is still the ONLY source of government facts: the
 *       provider has to call a tool to learn anything (see voiceTools.ts),
 *       and finalized transcripts are still ingested so profile, evidence
 *       and report stay in step. This is what makes real-time native-audio
 *       conversation possible — a controller-authored reply cannot be
 *       spoken by Gemini, only displayed.
 */
export type ReplyAuthority = 'controller' | 'provider'

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

/**
 * The audio side of the conversation. Both are optional so every existing
 * caller (and every existing test) keeps working untouched — without them
 * the runtime behaves exactly as it did before, coordinating transcripts
 * only. Supplied together, they make the session full-duplex.
 *
 * Deliberately injected as narrow capability objects rather than concrete
 * classes: the runtime must stay free of Web Audio, and a test must be able
 * to drive the full microphone -> session -> playback loop without a browser.
 */
export interface VoiceAudioBridge {
  /**
   * The rate the frames from startCapture are encoded at. Supplied by the
   * bridge rather than imported from a provider's constants, so this file
   * keeps its provider independence — the runtime tags outgoing chunks with
   * whatever the capture layer actually produced.
   */
  readonly inputSampleRateHz: number
  /** Begins streaming microphone frames. Each frame must already be PCM16 at inputSampleRateHz. */
  startCapture(onFrame: (frame: ArrayBuffer) => void): Promise<void>
  stopCapture(): Promise<void>
  /** Queues one chunk of the provider's speech for playback. */
  playChunk(chunk: ArrayBuffer): void
  /** Silences the assistant immediately and invalidates audio still in flight. */
  interruptPlayback(): void
  /** Releases microphone and audio resources. */
  dispose(): Promise<void>
}

export interface VoiceConversationRuntimeDeps<TController extends ConversationTurnHandler = VoiceAssistantController> {
  session: VoiceSession
  controller: TController
  /** Defaults to 'controller' — every pre-existing caller keeps its exact behavior. */
  replyAuthority?: ReplyAuthority
  /** Omit for a transcript-only session (no microphone, no speaker). */
  audio?: VoiceAudioBridge
  /** Required to answer provider tool calls; omit to decline every tool call with a structured error. */
  toolDeps?: VoiceToolDeps
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

  private readonly replyAuthority: ReplyAuthority
  private readonly audio: VoiceAudioBridge | null
  private readonly toolDeps: VoiceToolDeps | null
  constructor(deps: VoiceConversationRuntimeDeps<TController>) {
    this.session = deps.session
    this.controller = deps.controller
    this.replyAuthority = deps.replyAuthority ?? 'controller'
    this.audio = deps.audio ?? null
    this.toolDeps = deps.toolDeps ?? null
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

  /**
   * create -> attach (constructor) -> start/connect.
   *
   * The session is connected BEFORE the microphone starts, so the first
   * frames the citizen speaks have somewhere to go — starting capture first
   * would drop whatever was said during the connection handshake. If capture
   * fails, the session is left connected: text input still works, which is a
   * better outcome than tearing down a working conversation because a
   * microphone was busy.
   */
  async start(): Promise<void> {
    await this.session.connect()
    if (this.audio) {
      await this.audio.startCapture((frame) => this.handleMicrophoneFrame(frame))
    }
  }

  /**
   * Microphone frames go straight to the session. Wrapped because this runs
   * on the audio callback path: a throw here (a session that closed a
   * moment ago) would surface as an unhandled error inside an AudioWorklet
   * message handler, where nothing can catch it.
   */
  private handleMicrophoneFrame(frame: ArrayBuffer): void {
    if (this.disposed) return
    try {
      this.session.sendAudioChunk({ data: frame, format: 'pcm16', sampleRateHz: this.audio?.inputSampleRateHz })
    } catch {
      // The session is not in a state that accepts audio right now (still
      // connecting, erroring, or closing). Dropping a 85ms frame is the
      // correct response — buffering it would play the citizen's words back
      // into a conversation that has already moved on.
    }
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

  /**
   * Client-initiated barge-in (a "stop" button). Silences local playback
   * immediately rather than waiting for the session's own interrupted
   * event to come back — the citizen pressed stop, so the assistant should
   * go quiet now, not one network round trip from now.
   */
  interrupt(): void {
    this.audio?.interruptPlayback()
    this.session.interrupt()
  }

  /** close/dispose. Safe to call more than once. Detaches listeners and closes the underlying session. */
  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.turnToken += 1 // invalidate anything still in flight
    this.unsubscribeSession?.()
    this.unsubscribeSession = null
    // Release the microphone FIRST. It is the resource the citizen can see
    // (the browser's recording indicator), so it must not stay lit while a
    // slow socket close finishes.
    if (this.audio) {
      try {
        await this.audio.dispose()
      } catch {
        // Audio teardown is best-effort; the session must still be closed.
      }
    }
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
      case 'model_audio_chunk':
        // The provider's native speech. Playback owns its own staleness
        // check (a generation counter), so a chunk from an interrupted turn
        // that arrives late is dropped there rather than reaching a speaker.
        this.audio?.playChunk(event.chunk.data)
        return
      case 'interrupted':
        // Barge-in. Silence the assistant FIRST — before any bookkeeping —
        // because every millisecond of delay here is audible as the
        // assistant talking over the citizen.
        this.audio?.interruptPlayback()
        this.turnToken += 1
        return
      case 'model_text_final':
        // In provider mode this is the transcript of what the provider
        // actually SAID, which is the only record of the assistant's half
        // of the conversation — the controller did not author it.
        if (this.replyAuthority === 'provider') this.handleProviderSpokenReply(event.turnId, event.text)
        return
      case 'tool_call':
        void this.handleToolCalls(event.calls)
        return
      case 'tool_call_cancelled':
        // The session already forgot these ids, so any result still being
        // computed will be dropped on delivery. Nothing to undo here.
        return
      case 'error':
        this.handleSessionError(event.error, event.recoverable)
        return
      default:
        // Partial transcripts, turn_started/ended and diagnostics are
        // intentionally NOT acted on: the runtime reacts only to what
        // changes conversation state or requires handling, never to
        // interim provider chatter.
        return
    }
  }

  /**
   * Records what the provider said into the shared conversation, and emits
   * it for the UI. No pipeline step runs — the assistant speaking teaches
   * us nothing new about the citizen, and re-running extraction on the
   * assistant's own words would pollute the profile with facts it merely
   * repeated back.
   */
  private handleProviderSpokenReply(turnId: string, text: string): void {
    const trimmed = text.trim()
    if (!trimmed) return
    const controller = this.controller as ConversationTurnHandler & {
      recordAssistantUtterance?: (text: string, turnId: string) => unknown
    }
    controller.recordAssistantUtterance?.(trimmed, turnId)
    this.emit({ type: 'transcript', role: 'assistant', text: trimmed, turnId })
  }

  /**
   * Runs provider tool calls and returns their results. Calls are run in
   * parallel but delivered in ONE toolResponse: the provider correlates by
   * id, and batching avoids it starting to speak after the first result
   * while the rest are still running.
   *
   * Never throws — runVoiceToolCall converts a failure into a structured
   * error result, so a broken tool produces an assistant that says it
   * could not look something up, not a dead session.
   */
  private async handleToolCalls(calls: VoiceToolCall[]): Promise<void> {
    if (calls.length === 0) return
    this.emit({ type: 'tool_call', names: calls.map((c) => c.name) })

    if (!this.toolDeps) {
      // Declining explicitly is important: leaving a call unanswered makes
      // the provider wait silently until the session times out.
      this.session.sendToolResponse(
        calls.map((c) => ({
          id: c.id,
          name: c.name,
          response: { ok: false, error: 'tools_unavailable', message: 'That information is not available in this session.' },
        })),
      )
      return
    }

    const results = await Promise.all(calls.map((call) => runVoiceToolCall(call, this.toolDeps!)))
    // dispose() may have run while the tools were working; delivering into a
    // closed session is pointless and sendToolResponse would drop it anyway.
    if (this.disposed) return
    this.session.sendToolResponse(results)
    // A tool may have written to conversation state (recordCitizenDetail),
    // so tell the UI to re-read it.
    this.emit({ type: 'state_changed' })
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

    if (this.replyAuthority === 'provider') {
      // The provider is already answering this out loud. The controller
      // still ingests the utterance so profile/evidence/ranking/report stay
      // in step with the conversation — but it must NOT author a competing
      // reply, which would be a second voice nobody asked for.
      this.emit({ type: 'transcript', role: 'user', text, turnId })
      void this.ingestProviderTurn(text, turnId, myToken)
      return
    }

    void this.processTurn(text, turnId, myToken)
  }

  /**
   * Provider-mode ingest: the deterministic pipeline runs, nothing is
   * spoken. A failure here degrades the analysis panels for that turn but
   * must never interrupt the live conversation, so it is reported and
   * swallowed rather than surfaced as a spoken apology.
   */
  private async ingestProviderTurn(text: string, turnId: string, myToken: number): Promise<void> {
    const controller = this.controller as ConversationTurnHandler & {
      ingestUserUtterance?: (transcript: string, turnId?: string) => Promise<unknown>
    }
    if (!controller.ingestUserUtterance) return
    try {
      await controller.ingestUserUtterance(text, turnId)
    } catch (cause) {
      this.emit({
        type: 'error',
        error: {
          source: 'controller',
          code: 'ingest_error',
          message: cause instanceof Error ? cause.message : String(cause),
          cause,
          // The conversation itself is unharmed — the provider is still
          // speaking and the citizen notices nothing.
          recovered: true,
        },
      })
      return
    }
    if (this.isStale(myToken) || this.disposed) return
    this.emit({ type: 'state_changed' })
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
