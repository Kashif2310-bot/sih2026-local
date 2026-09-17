/**
 * Gemini Live "BidiGenerateContent" WebSocket protocol — message shapes and
 * PURE translation functions only. No networking, no VoiceSession state, no
 * side effects — every export here is a plain data transform, which is what
 * makes it testable without a real Gemini connection (see
 * geminiLiveProtocol.test.ts).
 *
 * Modeled directly on Google's published Live API reference, fetched
 * 2026-09-15:
 *   - https://ai.google.dev/api/live
 *   - https://ai.google.dev/gemini-api/docs/live-api/get-started-websocket
 * Field names, the audio format, and the WebSocket endpoint below are taken
 * from those pages. VERIFY against the current API reference before this is
 * ever pointed at a real Gemini connection — Google's own docs describe the
 * Live API as evolving, this module was written without a live connection
 * to test against, and only the message shapes actually used by this phase
 * were confirmed (setup/clientContent/realtimeInput/serverContent/error and
 * the audio format). Anything not covered here (tool calls, video input,
 * etc.) is out of scope for this phase.
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
 * The native/raw WebSocket endpoint (v1beta, required when connecting with
 * an ephemeral token — see docs/voice-session-architecture.md for why this
 * repo does not connect here directly with a long-lived API key). Not a
 * secret — this is a public, documented Google endpoint.
 */
export const GEMINI_LIVE_WEBSOCKET_ENDPOINT =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent'

/** Confirmed example model id from Google's current get-started guide. Overridable — see geminiLiveConfig.ts. */
export const GEMINI_LIVE_DEFAULT_MODEL = 'models/gemini-3.1-flash-live-preview'

// ---------------------------------------------------------------------------
// Client -> server messages
// ---------------------------------------------------------------------------

export interface GeminiLiveSetupMessage {
  setup: {
    model: string
    generationConfig?: {
      responseModalities?: Array<'TEXT' | 'AUDIO'>
      speechConfig?: { languageCode?: string }
    }
    systemInstruction?: { parts: Array<{ text: string }> }
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

export type GeminiLiveClientMessage =
  | GeminiLiveSetupMessage
  | GeminiLiveRealtimeAudioMessage
  | GeminiLiveRealtimeTextMessage
  | GeminiLiveAudioStreamEndMessage
  | GeminiLiveActivityStartMessage
  | GeminiLiveActivityEndMessage
  | GeminiLiveClientContentMessage

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

export type GeminiLiveServerMessage =
  | GeminiLiveSetupCompleteMessage
  | GeminiLiveServerContentMessage
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

export function buildSetupMessage(input: { model: string; languageCode?: string; systemInstructionText?: string }): GeminiLiveSetupMessage {
  return {
    setup: {
      model: input.model,
      generationConfig: {
        responseModalities: ['AUDIO'],
        ...(input.languageCode ? { speechConfig: { languageCode: input.languageCode } } : {}),
      },
      ...(input.systemInstructionText
        ? { systemInstruction: { parts: [{ text: input.systemInstructionText }] } }
        : {}),
      inputAudioTranscription: {},
      outputAudioTranscription: {},
    },
  }
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
