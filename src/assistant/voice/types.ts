/**
 * VoiceSession — provider-independent contract for a persistent,
 * bidirectional, real-time voice conversation.
 *
 * This is a SEPARATE abstraction from AIProvider (src/assistant/ai/types.ts)
 * on purpose. AIProvider is request/response: one message in, one reply
 * out, no connection state. A real-time voice conversation (Gemini Live and
 * equivalents) is a persistent streaming session with its own connection
 * lifecycle, partial results, and interruption semantics that a
 * request/response interface cannot honestly represent. Trying to force
 * voice through AIProvider would either lie about its nature or slowly
 * mutate AIProvider into something the existing Ollama/hosted/offline text
 * path was never designed for. So:
 *
 *   UI -> VoiceSession -> (future) Gemini Live adapter -> streaming audio/
 *   transcription/events
 *
 * The UI depends only on this file's types, never on a provider's wire
 * protocol (no Gemini-specific WebSocket message shapes leak in here).
 *
 * AI SAFETY BOUNDARY — a VoiceSession implementation must stay a transport/
 * conversation-turn layer only. It must never itself: compute eligibility,
 * compute LokScore, invent scheme facts or government information, make an
 * approval decision, or skip src/assistant/ai/responseGuard.ts's validation
 * on anything it plays back as a model reply. A finalized user transcript
 * is only ever raw material for the EXISTING deterministic pipeline
 * (profileExtraction -> missingFields -> retrieval -> ranking ->
 * promptBuilder -> a real AIProvider -> responseGuard) to consume — see the
 * VoiceTurnPipelineHandler seam at the bottom of this file, which is
 * intentionally a type only, not implemented yet.
 *
 * Full narrative documentation, the Gemini Live integration seam, and the
 * pipeline-wiring plan: docs/voice-session-architecture.md.
 */

import type { ApplicantProfile } from '../../shared/applicantProfile'
import type { UserProfile } from '../types'

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

/**
 * Deliberately a flat, small set of states — one status enum, not a web of
 * boolean flags or separate "isConnected"/"isListening"/"isSpeaking" props
 * that could disagree with each other.
 *
 *   idle -> connecting -> connected -> listening <-> user_speaking -> processing -> model_speaking -> listening
 *                                                                          ^                              |
 *                                                                          +---------- interrupted <-------+
 *   (any state) -> error -> (listening, via connect() retry, if recoverable) | -> closed
 *   (any state) -> closed  [terminal; a closed session is never reused — create a new one via the factory]
 */
export type VoiceSessionStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'listening'
  | 'user_speaking'
  | 'processing'
  | 'model_speaking'
  | 'interrupted'
  | 'error'
  | 'closed'

export type VoiceTurnRole = 'user' | 'model'

export type VoiceTurnEndReason = 'completed' | 'interrupted' | 'error'

// ---------------------------------------------------------------------------
// Language
// ---------------------------------------------------------------------------

/**
 * 'auto' explicitly allows mixed Kannada-English (or Hindi-English)
 * conversation (the product's required "mixed Kannada-English" case) rather
 * than forcing a single language classification per session. Nothing in
 * this contract assumes English.
 */
export type VoiceLanguage = 'en' | 'kn' | 'hi' | 'auto'

export interface VoiceSessionLanguageConfig {
  /** Primary language hint for STT/TTS, or 'auto' to allow free code-switching. */
  primary: VoiceLanguage
  /** True if the citizen may switch languages mid-sentence/mid-turn. Providers that don't support this hint may ignore it. */
  allowCodeSwitching?: boolean
}

// ---------------------------------------------------------------------------
// Audio
// ---------------------------------------------------------------------------

/**
 * 'mock' is a real, first-class value here — not an afterthought — so a
 * consumer can tell at compile time and at runtime that a chunk did not
 * come from a real audio codec. See offlineVoiceSession.ts.
 */
export type VoiceAudioFormat = 'pcm16' | 'opus' | 'mock'

export interface VoiceAudioChunk {
  data: ArrayBuffer
  format: VoiceAudioFormat
  sampleRateHz?: number
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

interface VoiceEventBase {
  /** Monotonic per-session sequence number — lets a consumer or a test detect drops/reordering and gives every event a stable sort key for logging/observability. */
  seq: number
  /** Wall-clock time the event was emitted (ISO 8601). */
  at: string
  sessionId: string
}

export interface VoiceStatusEvent extends VoiceEventBase {
  type: 'status'
  status: VoiceSessionStatus
  previousStatus: VoiceSessionStatus
}

export interface VoiceUserTranscriptPartialEvent extends VoiceEventBase {
  type: 'user_transcript_partial'
  turnId: string
  text: string
}

export interface VoiceUserTranscriptFinalEvent extends VoiceEventBase {
  type: 'user_transcript_final'
  turnId: string
  text: string
  languageHint?: VoiceLanguage
}

export interface VoiceModelTextPartialEvent extends VoiceEventBase {
  type: 'model_text_partial'
  turnId: string
  text: string
}

export interface VoiceModelTextFinalEvent extends VoiceEventBase {
  type: 'model_text_final'
  turnId: string
  text: string
}

export interface VoiceModelAudioChunkEvent extends VoiceEventBase {
  type: 'model_audio_chunk'
  turnId: string
  chunk: VoiceAudioChunk
}

export interface VoiceModelAudioEndEvent extends VoiceEventBase {
  type: 'model_audio_end'
  turnId: string
}

export interface VoiceTurnStartedEvent extends VoiceEventBase {
  type: 'turn_started'
  turnId: string
  role: VoiceTurnRole
}

export interface VoiceTurnEndedEvent extends VoiceEventBase {
  type: 'turn_ended'
  turnId: string
  role: VoiceTurnRole
  reason: VoiceTurnEndReason
}

export interface VoiceInterruptedEvent extends VoiceEventBase {
  type: 'interrupted'
  /** The model turn that got cut off. */
  interruptedTurnId: string
  /** 'user_barge_in' — new input arrived while the model was speaking. 'client_cancelled' — the host called interrupt() with no new input yet. */
  reason: 'user_barge_in' | 'client_cancelled'
}

// ---------------------------------------------------------------------------
// Tool calling
// ---------------------------------------------------------------------------

/**
 * One function the provider is allowed to ask the host to run. Deliberately
 * provider-independent: the schema dialect here is a small, explicit subset
 * (see VoiceToolSchema) that each adapter translates into its own provider's
 * shape — Gemini's UPPERCASE-typed function declarations never leak up here.
 */
export type VoiceToolSchemaType = 'object' | 'string' | 'number' | 'integer' | 'boolean' | 'array'

export interface VoiceToolSchema {
  type: VoiceToolSchemaType
  description?: string
  enum?: string[]
  properties?: Record<string, VoiceToolSchema>
  required?: string[]
  items?: VoiceToolSchema
}

export interface VoiceToolDeclaration {
  name: string
  description: string
  parameters?: VoiceToolSchema
  /** True to let the conversation continue while this tool runs, instead of the model waiting silently. */
  nonBlocking?: boolean
}

/** The provider asking for a tool to be run. `args` is UNVALIDATED model output — the host must validate before acting on it. */
export interface VoiceToolCall {
  id: string
  name: string
  args: Record<string, unknown>
}

/** How a non-blocking tool's result should land relative to whatever the model is currently saying. */
export type VoiceToolScheduling = 'interrupt' | 'when_idle' | 'silent'

export interface VoiceToolResult {
  /** Must echo the id of the VoiceToolCall this answers. */
  id: string
  name: string
  response: Record<string, unknown>
  scheduling?: VoiceToolScheduling
}

export interface VoiceToolCallEvent extends VoiceEventBase {
  type: 'tool_call'
  calls: VoiceToolCall[]
}

/** The provider withdrew tool calls it had already requested — e.g. the citizen interrupted before they finished. */
export interface VoiceToolCallCancelledEvent extends VoiceEventBase {
  type: 'tool_call_cancelled'
  ids: string[]
}

export interface VoiceErrorEvent extends VoiceEventBase {
  type: 'error'
  error: VoiceSessionError
  /** True if the session stays open and connect() may be called again to retry. False if the session has (or is about to) transition to 'closed'. */
  recoverable: boolean
}

/** Free-form observability event — logging/metrics hooks, never used for control flow by a consumer. */
export interface VoiceDiagnosticEvent extends VoiceEventBase {
  type: 'diagnostic'
  message: string
  data?: Record<string, unknown>
}

export type VoiceEvent =
  | VoiceStatusEvent
  | VoiceUserTranscriptPartialEvent
  | VoiceUserTranscriptFinalEvent
  | VoiceModelTextPartialEvent
  | VoiceModelTextFinalEvent
  | VoiceModelAudioChunkEvent
  | VoiceModelAudioEndEvent
  | VoiceTurnStartedEvent
  | VoiceTurnEndedEvent
  | VoiceInterruptedEvent
  | VoiceToolCallEvent
  | VoiceToolCallCancelledEvent
  | VoiceErrorEvent
  | VoiceDiagnosticEvent

/**
 * Plain `Omit<VoiceEvent, 'seq' | 'at' | 'sessionId'>` collapses a
 * discriminated union down to only the properties common to every member
 * (TypeScript's `Omit`/`Pick` don't distribute over a union on their own),
 * which would throw away every event variant's own payload fields.
 * `DistributiveOmit` routes through a genuine generic type parameter (`T`)
 * so the conditional actually distributes over each member of the union
 * during instantiation — inlining the union directly into the conditional
 * (`VoiceEvent extends unknown ? ... : never`) does NOT distribute, since
 * distribution only triggers for a naked type parameter, not a concrete
 * named type.
 */
type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never

/** VoiceEvent's full discriminated union, minus the three envelope fields every VoiceSession implementation fills in itself at emit time. */
export type VoiceEventInput = DistributiveOmit<VoiceEvent, 'seq' | 'at' | 'sessionId'>

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type VoiceSessionErrorCode =
  | 'connection_failed'
  | 'permission_denied'
  | 'unsupported'
  | 'network_lost'
  | 'provider_error'
  | 'unknown'

export interface VoiceSessionError {
  code: VoiceSessionErrorCode
  message: string
  cause?: unknown
}

// ---------------------------------------------------------------------------
// Config / context
// ---------------------------------------------------------------------------

/**
 * The parts of a session's configuration that can change mid-session via
 * updateContext() without tearing down the connection — e.g. a real Gemini
 * Live session can be told about newly-learned applicant facts so its next
 * reply is better grounded, without reconnecting.
 */
export interface VoiceSessionContext {
  language: VoiceSessionLanguageConfig
  /**
   * The applicant profile known so far, for a provider adapter to use as
   * conversational grounding (e.g. building a personalized greeting/system
   * prompt). A VoiceSession never mutates this itself — see the AI safety
   * boundary at the top of this file and the pipeline seam below: updating
   * the profile from what the citizen says is the caller's job, done via
   * the existing profileExtraction + shared ApplicantProfile adapters, not
   * something any VoiceSession implementation does internally.
   */
  applicantProfile?: ApplicantProfile
}

/**
 * Who is authoritative for what the model turn says.
 *   'provider'  (default, unchanged from every prior phase) — the provider
 *               generates its own reply autonomously (the offline session's
 *               scripted replyFor(), or Gemini's own live generation).
 *   'external'  — the provider does NOT generate/emit its own reply for a
 *               user turn. Instead it waits (status stays 'processing')
 *               until the host calls deliverAssistantReply() with
 *               externally-computed text. Required for LokPulse's AI safety
 *               boundary once a deterministic controller becomes the source
 *               of truth for what gets said — see
 *               VoiceConversationRuntime in conversation/voiceConversationRuntime.ts
 *               and docs/voice-session-architecture.md "Controller-authored replies".
 * Fixed at construction (not part of the mutable VoiceSessionContext) because
 * it changes turn-taking STRUCTURE, not conversational grounding.
 */
export type VoiceReplySource = 'provider' | 'external'

export interface VoiceSessionConfig extends VoiceSessionContext {
  /** Caller-supplied id for correlating with a future backend session record (Vamshi's persistence contract) — passed through unopened, never interpreted by a VoiceSession implementation. */
  externalSessionId?: string
  /** See VoiceReplySource. Omit (or 'provider') to preserve every prior phase's existing autonomous-reply behavior exactly. */
  replySource?: VoiceReplySource
  /**
   * Functions the provider may call. This is how a provider-authored reply
   * stays grounded in real application data without the provider ever
   * becoming an independent source of government facts: it must ask the
   * host, and the host answers from the existing deterministic pipeline.
   * See conversation/voiceTools.ts.
   */
  tools?: VoiceToolDeclaration[]
  /** Conversation-level behavioral instruction for the provider. Never contains scheme facts — see voiceSystemInstruction.ts. */
  systemInstruction?: string
  /** A provider-issued handle from a previous session, to resume that conversation rather than starting cold. */
  resumptionHandle?: string
  /** See VoiceAudioInputMode. Omit to preserve the original push-to-talk semantics exactly. */
  audioInputMode?: VoiceAudioInputMode
}

/**
 * How microphone audio reaches the provider — this changes turn-taking
 * structure, so it is fixed at construction rather than living in the
 * mutable VoiceSessionContext.
 *
 *   'push_to_talk' (default, unchanged from every prior phase) — the host
 *       explicitly frames each user turn: the first audio chunk opens a user
 *       turn, endUserTurn() closes it, and a chunk arriving while the model
 *       is speaking is treated as a local barge-in.
 *   'continuous'  — the microphone streams without pause and the PROVIDER's
 *       own voice-activity detection decides where turns begin and end. A
 *       chunk arriving during 'model_speaking' is therefore NOT a local
 *       barge-in (with an open mic that would fire on the model's own first
 *       syllable); the provider's interruption signal is authoritative
 *       instead. User turns open lazily when the provider first reports a
 *       transcription, so a turn only exists once the citizen genuinely
 *       said something. Required for real full-duplex conversation.
 */
export type VoiceAudioInputMode = 'push_to_talk' | 'continuous'

// ---------------------------------------------------------------------------
// The VoiceSession contract
// ---------------------------------------------------------------------------

export interface VoiceSession {
  readonly id: string
  readonly status: VoiceSessionStatus

  /**
   * Establishes the session. Idempotent while already connecting or in any
   * active state (returns without doing anything). Callable again after a
   * recoverable 'error' status to retry. Throws if the session is 'closed'
   * — a closed session is never reused; create a new one via the factory.
   */
  connect(): Promise<void>

  /**
   * Tears down the connection and releases all resources (timers, listener
   * registrations, provider sockets). Always safe to call more than once.
   * Terminal — the session cannot be reconnected afterward.
   */
  close(reason?: string): Promise<void>

  /**
   * Streams one chunk of citizen microphone audio into the session. Valid
   * while 'listening', 'user_speaking', or 'interrupted'; also valid during
   * 'model_speaking', where it is treated as a user barge-in (the model's
   * current turn is interrupted automatically before this chunk is
   * processed as the start of a new user turn). Throws otherwise.
   */
  sendAudioChunk(chunk: VoiceAudioChunk): void

  /**
   * Explicit "the citizen has stopped speaking" signal for push-to-talk
   * style input. Optional for a provider that runs its own voice-activity
   * detection and can finalize a turn on server-detected silence without
   * this ever being called (Gemini Live can do this) — but required for a
   * provider with no such detection, which is why the offline mock relies
   * on it. A no-op if there is no in-progress user turn to finalize.
   */
  endUserTurn(): void

  /**
   * Text-input escape hatch — e.g. a "type instead of speak" fallback
   * control, or how a session is driven in tests without real audio. Goes
   * through the exact same turn/event pipeline as spoken input and
   * finalizes immediately (a typed message is already a complete
   * utterance). Same validity/barge-in rules as sendAudioChunk.
   */
  sendTextInput(text: string): void

  /**
   * Client-initiated barge-in: stop the model's current speech immediately.
   * A no-op if the model isn't currently speaking. This is the same
   * interruption path that an automatic user-barge-in takes internally —
   * exposed too so a UI "stop" button can trigger it without faking
   * microphone input.
   */
  interrupt(): void

  /** Best-effort update to session context (e.g. a freshly-enriched ApplicantProfile) without tearing down the connection. */
  updateContext(context: Partial<VoiceSessionContext>): void

  /**
   * Delivers an externally-computed reply (e.g. VoiceAssistantController's
   * already-guarded replyText) as the CURRENT model turn's content — never
   * a new user turn (unlike sendTextInput, which is unambiguously the
   * citizen's own input and would corrupt the turn model if misused for
   * this). Valid only when this session was created with
   * `replySource: 'external'` AND a user turn has just finalized (status
   * 'processing', with no model turn yet started for it) — throws
   * otherwise. Produces the exact same turn_started(model) ->
   * model_text_final -> [model_audio_chunk/end, provider-dependent] ->
   * turn_ended -> listening sequence an autonomous reply would, so a
   * subscriber never needs to know which path produced it — including
   * being subject to the exact same interruption/barge-in handling as an
   * autonomous model turn.
   */
  deliverAssistantReply(text: string): void

  /**
   * Answers a 'tool_call' event. Results must echo the ids from that event;
   * a result for an unknown/already-cancelled id is dropped rather than
   * sent, since answering a call the provider has withdrawn corrupts its
   * turn state. A no-op on a provider that never emits tool calls.
   */
  sendToolResponse(results: VoiceToolResult[]): void

  /**
   * The most recent provider-issued session-resumption handle, or null if
   * the provider hasn't issued one (or doesn't support resumption). Read at
   * reconnect time — see VoiceSessionConfig.resumptionHandle.
   */
  getResumptionHandle(): string | null

  /** Registers a listener for every event this session emits, in order. Returns an unsubscribe function. A listener registered after connect() does not receive events emitted before it subscribed — subscribe before calling connect(). */
  subscribe(listener: (event: VoiceEvent) => void): () => void
}

// ---------------------------------------------------------------------------
// Provider-selection factory — mirrors AIProvider's id/isAvailable pattern
// (src/assistant/ai/types.ts) for consistency, even though a VoiceSession
// itself is stateful/per-conversation rather than a stateless strategy.
// ---------------------------------------------------------------------------

export type VoiceProviderId = 'gemini-live' | 'offline'

export interface VoiceSessionFactory {
  readonly providerId: VoiceProviderId
  /** Cheap support/config check — must never hang. E.g. a Gemini factory checks a proxy URL is configured; the offline factory always resolves true. */
  isSupported(): Promise<boolean>
  create(config: VoiceSessionConfig): VoiceSession
}

// ---------------------------------------------------------------------------
// PIPELINE SEAM — not implemented in this phase.
// ---------------------------------------------------------------------------
/**
 * Fixes the shape of the function a future change will write to bridge one
 * finalized voice turn (a VoiceUserTranscriptFinalEvent) into the EXISTING
 * deterministic text pipeline, so callers can be built against a stable
 * signature today even though nothing implements it yet. Intended
 * internals — reusing existing modules verbatim, never duplicating them:
 *
 *   1. src/assistant/profileExtraction.ts  extractAndMerge(transcript, userProfile)
 *   2. src/shared/applicantProfile.ts      withApplicantFields(...) to fold the
 *                                          same facts into the caller's ApplicantProfile
 *   3. src/assistant/missingFields.ts      identifyMissingFields(userProfile)
 *   4. src/assistant/ranking.ts            rankSchemes(...) (retrieval.ts + eligibility.ts underneath)
 *   5. src/assistant/liveRetrieval.ts      the same live-evidence attempt orchestrator.ts already does
 *   6. src/assistant/ai/promptBuilder.ts   buildUserTurn(...) + a real AIProvider.generateReply(...)
 *   7. src/assistant/ai/responseGuard.ts   validateProviderReply(...) — REQUIRED before a reply may
 *                                          ever reach session.updateContext() or be spoken back via a
 *                                          model_text_final/model_audio_chunk event
 *
 * This function's eventual home is the assistant module (e.g. a sibling to
 * orchestrator.ts), never inside a VoiceSession implementation itself — see
 * the AI safety boundary at the top of this file.
 */
export type VoiceTurnPipelineHandler = (input: {
  transcript: string
  turnId: string
  userProfile: UserProfile
}) => Promise<{
  userProfile: UserProfile
  updatedFields: Array<keyof UserProfile>
  replyText: string
}>
