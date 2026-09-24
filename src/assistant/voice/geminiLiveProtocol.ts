/**
 * Gemini Live "BidiGenerateContent" WebSocket protocol — message shapes and
 * PURE translation functions only. No networking, no VoiceSession state, no
 * side effects — every export here is a plain data transform, which is what
 * makes it testable without a real Gemini connection (see
 * geminiLiveProtocol.test.ts).
 *
 * Modeled directly on Google's published Live API reference, re-verified
 * 2026-09-23 against:
 *   - https://ai.google.dev/api/live
 *   - https://ai.google.dev/gemini-api/docs/live-api
 *   - https://ai.google.dev/gemini-api/docs/live-api/tools
 *   - https://ai.google.dev/gemini-api/docs/live-api/capabilities
 *   - https://ai.google.dev/gemini-api/docs/live-api/get-started-sdk
 * Confirmed on that pass: the `setup`/`clientContent`/`realtimeInput`/
 * `toolResponse` client messages, the `serverContent`/`setupComplete`/
 * `toolCall`/`toolCallCancellation`/`goAway`/`sessionResumptionUpdate`/
 * `error` server messages, `realtimeInputConfig.automaticActivityDetection`
 * (with `disabled`/`prefixPaddingMs`/`silenceDurationMs`/
 * `startOfSpeechSensitivity`/`endOfSpeechSensitivity`), the 16kHz-in /
 * 24kHz-out PCM16 audio formats, and the current default Live model id.
 * Video input remains out of scope.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Confirmed from Google's get-started guide: raw 16-bit PCM, mono, little-endian, 16kHz. */
export const GEMINI_LIVE_INPUT_AUDIO_MIME_TYPE = 'audio/pcm;rate=16000'
export const GEMINI_LIVE_INPUT_SAMPLE_RATE_HZ = 16000

/** Confirmed from Google's Live API capabilities guide: raw 16-bit PCM, mono, little-endian, 24kHz, delivered base64-encoded inside modelTurn.parts[].inlineData. */
export const GEMINI_LIVE_OUTPUT_AUDIO_MIME_TYPE = 'audio/pcm;rate=24000'
export const GEMINI_LIVE_OUTPUT_SAMPLE_RATE_HZ = 24000

/**
 * The native/raw WebSocket endpoint for an ephemeral/constrained-token
 * connection. This MUST be the `BidiGenerateContentConstrained` method, not
 * the plain `BidiGenerateContent` method used for full-API-key connections
 * — they are two separately-named RPCs, per Google's own reference
 * (https://ai.google.dev/api/live: "can be obtained by calling
 * AuthTokenService.CreateToken and then used with
 * GenerativeService.BidiGenerateContentConstrained").
 *
 * This was an actual bug here once: the endpoint pointed at plain
 * `BidiGenerateContent`, and every connection attempt with a real minted
 * token failed with close code 1008 "Method doesn't allow unregistered
 * callers" — a full-identity method correctly refusing a mere constrained
 * token. Fixed and empirically verified 2026-09-25: the exact same token,
 * from the exact same unmodified gemini-live-token function (still
 * v1alpha), reached `setupComplete` only after switching to
 * `BidiGenerateContentConstrained`. If this constant is ever "corrected"
 * back to `BidiGenerateContent`, voice will silently fail again with 1008.
 *
 * v1beta is correct for this endpoint (also per the reference above). Not a
 * secret — this is a public, documented Google endpoint.
 */
export const GEMINI_LIVE_WEBSOCKET_ENDPOINT =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained'

/**
 * Current default Live model (verified 2026-09-23 against Google's
 * get-started-sdk guide, which uses `gemini-3.8-live` — documented as "the
 * default option for most low-latency voice agent experiences"; empirically
 * confirmed 2026-09-25 — a real BidiGenerateContentConstrained connection
 * reached setupComplete with this exact model string). The Live API's
 * `setup.model` field takes a fully-qualified resource name, so the
 * `models/` prefix is required here even though the SDK examples pass the
 * bare id. Overridable — see geminiLiveConfig.ts.
 */
export const GEMINI_LIVE_DEFAULT_MODEL = 'models/gemini-3.8-live'

/**
 * Normalizes a caller-supplied model id to the fully-qualified form the raw
 * WebSocket protocol requires, so a config value copied straight out of an
 * SDK example (`gemini-3.8-live`) works without silently connecting to
 * nothing.
 */
export function qualifyModelName(model: string): string {
  const trimmed = model.trim()
  return trimmed.startsWith('models/') ? trimmed : `models/${trimmed}`
}

// ---------------------------------------------------------------------------
// Client -> server messages
// ---------------------------------------------------------------------------

/**
 * Gemini's function-declaration schema subset — a JSON-Schema-like shape
 * with UPPERCASE type names, as the Live API tools guide documents. Kept
 * deliberately narrow (only what this app's tools actually need) rather
 * than modeling all of OpenAPI: an unused field we can't test is a
 * liability, not forward compatibility.
 */
export type GeminiLiveSchemaType = 'OBJECT' | 'STRING' | 'NUMBER' | 'INTEGER' | 'BOOLEAN' | 'ARRAY'

export interface GeminiLiveSchema {
  type: GeminiLiveSchemaType
  description?: string
  /** Allowed values for a STRING — how an enum is expressed in this schema dialect. */
  enum?: string[]
  properties?: Record<string, GeminiLiveSchema>
  required?: string[]
  items?: GeminiLiveSchema
}

/**
 * 'NON_BLOCKING' lets the conversation continue while the tool runs (the
 * model can keep speaking); the response then carries a `scheduling` hint.
 * Omitted means the documented default, BLOCKING.
 */
export type GeminiLiveFunctionBehavior = 'BLOCKING' | 'NON_BLOCKING'

export interface GeminiLiveFunctionDeclaration {
  name: string
  description: string
  parameters?: GeminiLiveSchema
  behavior?: GeminiLiveFunctionBehavior
}

export interface GeminiLiveToolDeclaration {
  functionDeclarations: GeminiLiveFunctionDeclaration[]
}

/** Sensitivity knobs for server-side VAD — Google's documented enum names. */
export type GeminiLiveSpeechSensitivity =
  | 'START_SENSITIVITY_LOW'
  | 'START_SENSITIVITY_HIGH'
  | 'END_SENSITIVITY_LOW'
  | 'END_SENSITIVITY_HIGH'

export interface GeminiLiveRealtimeInputConfig {
  automaticActivityDetection?: {
    /** true disables server VAD entirely, requiring explicit activityStart/activityEnd framing. */
    disabled?: boolean
    startOfSpeechSensitivity?: GeminiLiveSpeechSensitivity
    endOfSpeechSensitivity?: GeminiLiveSpeechSensitivity
    prefixPaddingMs?: number
    silenceDurationMs?: number
  }
}

export interface GeminiLiveSetupMessage {
  setup: {
    model: string
    generationConfig?: {
      responseModalities?: Array<'TEXT' | 'AUDIO'>
      speechConfig?: { languageCode?: string }
    }
    systemInstruction?: { parts: Array<{ text: string }> }
    /** Function declarations the model may call. Omitted entirely when the app exposes no tools. */
    tools?: GeminiLiveToolDeclaration[]
    /** Server-side voice-activity detection tuning — see GeminiLiveRealtimeInputConfig. */
    realtimeInputConfig?: GeminiLiveRealtimeInputConfig
    /** Presence requests resumption handles; a `handle` resumes a prior session. */
    sessionResumption?: { handle?: string }
    /** Presence (even as {}) requests server-side transcription of the citizen's speech. */
    inputAudioTranscription?: Record<string, never>
    /** Presence (even as {}) requests a text transcript alongside the model's audio reply. */
    outputAudioTranscription?: Record<string, never>
  }
}

export interface GeminiLiveRealtimeAudioMessage {
  realtimeInput: { audio: { data: string; mimeType: string } }
}

export interface GeminiLiveRealtimeTextMessage {
  realtimeInput: { text: string }
}

export interface GeminiLiveAudioStreamEndMessage {
  realtimeInput: { audioStreamEnd: true }
}

/** Only used when automatic voice-activity detection is disabled server-side (not configured by this phase's setup message) — defined for completeness/future use, not wired into the default turn flow. See geminiLiveVoiceSession.ts's interruption docs. */
export interface GeminiLiveActivityStartMessage {
  realtimeInput: { activityStart: Record<string, never> }
}
export interface GeminiLiveActivityEndMessage {
  realtimeInput: { activityEnd: Record<string, never> }
}

export interface GeminiLiveClientContentMessage {
  clientContent: {
    turns: Array<{ role: 'user'; parts: Array<{ text: string }> }>
    turnComplete: boolean
  }
}

/**
 * How a NON_BLOCKING tool's result should interrupt (or not) whatever the
 * model is currently saying. 'INTERRUPT' cuts in immediately, 'WHEN_IDLE'
 * waits for a natural pause, 'SILENT' feeds the result to the model without
 * prompting speech.
 */
export type GeminiLiveToolScheduling = 'INTERRUPT' | 'WHEN_IDLE' | 'SILENT'

export interface GeminiLiveFunctionResponse {
  /** Echoes the id from the server's toolCall — how the model correlates the answer to its request. */
  id: string
  name: string
  response: Record<string, unknown>
}

export interface GeminiLiveToolResponseMessage {
  toolResponse: { functionResponses: GeminiLiveFunctionResponse[] }
}

export type GeminiLiveClientMessage =
  | GeminiLiveSetupMessage
  | GeminiLiveRealtimeAudioMessage
  | GeminiLiveRealtimeTextMessage
  | GeminiLiveAudioStreamEndMessage
  | GeminiLiveActivityStartMessage
  | GeminiLiveActivityEndMessage
  | GeminiLiveClientContentMessage
  | GeminiLiveToolResponseMessage

// ---------------------------------------------------------------------------
// Server -> client messages
// ---------------------------------------------------------------------------

export interface GeminiLiveSetupCompleteMessage {
  setupComplete: Record<string, never>
}

export interface GeminiLiveTranscription {
  text: string
  finished?: boolean
}

export interface GeminiLiveServerContentPart {
  text?: string
  inlineData?: { mimeType: string; data: string }
}

export interface GeminiLiveServerContentMessage {
  serverContent: {
    modelTurn?: { parts: GeminiLiveServerContentPart[] }
    generationComplete?: boolean
    turnComplete?: boolean
    interrupted?: boolean
    inputTranscription?: GeminiLiveTranscription
    interimInputTranscription?: GeminiLiveTranscription
    outputTranscription?: GeminiLiveTranscription
    waitingForInput?: boolean
  }
}

export interface GeminiLiveErrorMessage {
  error: { code?: number; message: string; status?: string }
}

export interface GeminiLiveFunctionCall {
  id: string
  name: string
  args: Record<string, unknown>
}

export interface GeminiLiveToolCallMessage {
  toolCall: { functionCalls: GeminiLiveFunctionCall[] }
}

/** The model withdrew tool calls it had already requested (e.g. the user interrupted). Ids match a prior toolCall. */
export interface GeminiLiveToolCallCancellationMessage {
  toolCallCancellation: { ids: string[] }
}

/** The server is about to terminate this connection — advance warning, with time remaining. */
export interface GeminiLiveGoAwayMessage {
  goAway: { timeLeft?: string }
}

/** A handle that can be passed back in `setup.sessionResumption.handle` to resume this conversation after a drop. */
export interface GeminiLiveSessionResumptionUpdateMessage {
  sessionResumptionUpdate: { newHandle?: string; resumable?: boolean }
}

export type GeminiLiveServerMessage =
  | GeminiLiveSetupCompleteMessage
  | GeminiLiveServerContentMessage
  | GeminiLiveToolCallMessage
  | GeminiLiveToolCallCancellationMessage
  | GeminiLiveGoAwayMessage
  | GeminiLiveSessionResumptionUpdateMessage
  | GeminiLiveErrorMessage

// ---------------------------------------------------------------------------
// Pure builders (client -> server)
// ---------------------------------------------------------------------------

/** Maps the provider-independent VoiceLanguage onto a Gemini speechConfig.languageCode. 'auto' deliberately omits languageCode so Gemini applies its own detection/code-switching handling, rather than this adapter guessing one language. */
export function languageCodeFor(language: 'en' | 'kn' | 'auto'): string | undefined {
  if (language === 'en') return 'en-US'
  if (language === 'kn') return 'kn-IN'
  return undefined
}

export interface BuildSetupMessageInput {
  model: string
  languageCode?: string
  systemInstructionText?: string
  /** Omitted entirely (not sent as `[]`) when empty — an empty tools array is not the same thing as no tools. */
  tools?: GeminiLiveToolDeclaration[]
  realtimeInputConfig?: GeminiLiveRealtimeInputConfig
  /** Pass a prior handle to resume; pass `true` with no handle to request handles for a fresh session. */
  sessionResumptionHandle?: string
  requestSessionResumption?: boolean
  /**
   * 'AUDIO' (the default) asks Gemini for native speech — the product's
   * actual goal. 'TEXT' exists for tests and for a text-only fallback and
   * is never the live voice path.
   */
  responseModality?: 'AUDIO' | 'TEXT'
}

export function buildSetupMessage(input: BuildSetupMessageInput): GeminiLiveSetupMessage {
  const hasTools = Boolean(input.tools && input.tools.length > 0)
  const wantsResumption = Boolean(input.requestSessionResumption || input.sessionResumptionHandle)
  return {
    setup: {
      model: qualifyModelName(input.model),
      generationConfig: {
        responseModalities: [input.responseModality ?? 'AUDIO'],
        ...(input.languageCode ? { speechConfig: { languageCode: input.languageCode } } : {}),
      },
      ...(input.systemInstructionText
        ? { systemInstruction: { parts: [{ text: input.systemInstructionText }] } }
        : {}),
      ...(hasTools ? { tools: input.tools } : {}),
      ...(input.realtimeInputConfig ? { realtimeInputConfig: input.realtimeInputConfig } : {}),
      ...(wantsResumption
        ? { sessionResumption: input.sessionResumptionHandle ? { handle: input.sessionResumptionHandle } : {} }
        : {}),
      inputAudioTranscription: {},
      outputAudioTranscription: {},
    },
  }
}

export function buildToolResponseMessage(functionResponses: GeminiLiveFunctionResponse[]): GeminiLiveToolResponseMessage {
  return { toolResponse: { functionResponses } }
}

export function buildAudioChunkMessage(base64Data: string, mimeType: string = GEMINI_LIVE_INPUT_AUDIO_MIME_TYPE): GeminiLiveRealtimeAudioMessage {
  return { realtimeInput: { audio: { data: base64Data, mimeType } } }
}

export function buildAudioStreamEndMessage(): GeminiLiveAudioStreamEndMessage {
  return { realtimeInput: { audioStreamEnd: true } }
}

export function buildActivityStartMessage(): GeminiLiveActivityStartMessage {
  return { realtimeInput: { activityStart: {} } }
}

export function buildActivityEndMessage(): GeminiLiveActivityEndMessage {
  return { realtimeInput: { activityEnd: {} } }
}

export function buildTextTurnMessage(text: string): GeminiLiveClientContentMessage {
  return { clientContent: { turns: [{ role: 'user', parts: [{ text }] }], turnComplete: true } }
}

// ---------------------------------------------------------------------------
// Pure parser (server -> client) — untrusted network input, validated the
// same way liveRetrieval.ts validates the Edge Function's response: check
// shape explicitly, return null for anything unrecognized rather than
// guessing or throwing. An unrecognized-but-validly-JSON message (e.g. a
// server message type Google adds later) is silently ignored by the
// transport, never treated as fatal — see geminiLiveTransport.ts.
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

export function parseServerMessage(raw: unknown): GeminiLiveServerMessage | null {
  if (!isRecord(raw)) return null

  if (isRecord(raw.setupComplete)) {
    return { setupComplete: {} }
  }

  if (isRecord(raw.error) && typeof raw.error.message === 'string') {
    return {
      error: {
        message: raw.error.message,
        code: typeof raw.error.code === 'number' ? raw.error.code : undefined,
        status: typeof raw.error.status === 'string' ? raw.error.status : undefined,
      },
    }
  }

  if (isRecord(raw.toolCall) && Array.isArray(raw.toolCall.functionCalls)) {
    // A call with no usable id or name can never be answered correctly, so
    // it is dropped rather than forwarded with invented values — same
    // "validate explicitly, never guess" discipline as the rest of this
    // parser. A toolCall whose every entry is dropped yields an empty
    // functionCalls list, which the adapter treats as nothing to do.
    const functionCalls = raw.toolCall.functionCalls.filter(isRecord).flatMap((c) => {
      if (typeof c.id !== 'string' || typeof c.name !== 'string') return []
      return [{ id: c.id, name: c.name, args: isRecord(c.args) ? c.args : {} }]
    })
    return { toolCall: { functionCalls } }
  }

  if (isRecord(raw.toolCallCancellation) && Array.isArray(raw.toolCallCancellation.ids)) {
    return { toolCallCancellation: { ids: raw.toolCallCancellation.ids.filter((id): id is string => typeof id === 'string') } }
  }

  if (isRecord(raw.goAway)) {
    return { goAway: { timeLeft: typeof raw.goAway.timeLeft === 'string' ? raw.goAway.timeLeft : undefined } }
  }

  if (isRecord(raw.sessionResumptionUpdate)) {
    const u = raw.sessionResumptionUpdate
    return {
      sessionResumptionUpdate: {
        newHandle: typeof u.newHandle === 'string' ? u.newHandle : undefined,
        resumable: typeof u.resumable === 'boolean' ? u.resumable : undefined,
      },
    }
  }

  if (isRecord(raw.serverContent)) {
    const sc = raw.serverContent
    const parts = isRecord(sc.modelTurn) && Array.isArray(sc.modelTurn.parts) ? sc.modelTurn.parts : undefined
    return {
      serverContent: {
        modelTurn: parts
          ? {
              parts: parts.filter(isRecord).map((p) => ({
                text: typeof p.text === 'string' ? p.text : undefined,
                inlineData:
                  isRecord(p.inlineData) && typeof p.inlineData.data === 'string' && typeof p.inlineData.mimeType === 'string'
                    ? { data: p.inlineData.data, mimeType: p.inlineData.mimeType }
                    : undefined,
              })),
            }
          : undefined,
        generationComplete: typeof sc.generationComplete === 'boolean' ? sc.generationComplete : undefined,
        turnComplete: typeof sc.turnComplete === 'boolean' ? sc.turnComplete : undefined,
        interrupted: typeof sc.interrupted === 'boolean' ? sc.interrupted : undefined,
        inputTranscription: parseTranscription(sc.inputTranscription),
        interimInputTranscription: parseTranscription(sc.interimInputTranscription),
        outputTranscription: parseTranscription(sc.outputTranscription),
        waitingForInput: typeof sc.waitingForInput === 'boolean' ? sc.waitingForInput : undefined,
      },
    }
  }

  return null
}

function parseTranscription(v: unknown): GeminiLiveTranscription | undefined {
  if (!isRecord(v) || typeof v.text !== 'string') return undefined
  return { text: v.text, finished: typeof v.finished === 'boolean' ? v.finished : undefined }
}

// ---------------------------------------------------------------------------
// Audio encoding — base64 <-> ArrayBuffer. Deliberately implemented with
// only `atob`/`btoa` (present in every browser and, as real runtime
// globals, in Node 18+ — the Vitest environment this project's tests run
// under) rather than a Buffer-based fallback, so this stays dependency-free
// and doesn't require Node's ambient types (tsconfig.app.json's `types` is
// intentionally scoped to `vite/client` only, matching a browser app).
// ---------------------------------------------------------------------------

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}
