import { base64ToBytes } from './pcm'

/**
 * Ephemeral tokens are only accepted by the Constrained method; the plain
 * BidiGenerateContent endpoint rejects them with close code 1008.
 */
export const GEMINI_LIVE_ENDPOINT =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained'

/**
 * Pinned on the client on purpose: the token function also reports a model,
 * but the deployed value is not a Live-capable model and closes with 1011.
 */
export const GEMINI_LIVE_MODEL = 'models/gemini-3.1-flash-live-preview'

export function buildLiveUrl(token: string): string {
  return `${GEMINI_LIVE_ENDPOINT}?access_token=${encodeURIComponent(token)}`
}

export interface FunctionDeclaration {
  name: string
  description: string
  parameters?: {
    type: 'OBJECT'
    properties: Record<string, { type: 'STRING'; description: string }>
    required?: string[]
  }
}

/**
 * Prebuilt Gemini voice for Ishaara. Chosen by measuring the fundamental
 * frequency of real Live output (scripts/voice-pitch.mjs), not by its name:
 * median ~205 Hz in English and Kannada with the narrowest pitch spread of
 * the female candidates, against ~142 Hz for the male control voice.
 */
export const ISHAARA_VOICE_NAME = 'Sulafat'

/** kn-IN is accepted by this model with tools (verified in the main prototype); English leaves the code unset so Gemini keeps auto language detection. */
export const LANGUAGE_CODES = { en: undefined, kn: 'kn-IN' } as const

export interface SetupOptions {
  systemInstruction: string
  tools: FunctionDeclaration[]
  model?: string
  voiceName?: string
  languageCode?: string
}

export function buildSetupMessage({
  systemInstruction,
  tools,
  model = GEMINI_LIVE_MODEL,
  voiceName = ISHAARA_VOICE_NAME,
  languageCode,
}: SetupOptions) {
  return {
    setup: {
      model,
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName } },
          ...(languageCode ? { languageCode } : {}),
        },
      },
      systemInstruction: { parts: [{ text: systemInstruction }] },
      ...(tools.length > 0 ? { tools: [{ functionDeclarations: tools }] } : {}),
      realtimeInputConfig: {
        automaticActivityDetection: { prefixPaddingMs: 300, silenceDurationMs: 900 },
      },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
    },
  }
}

export const buildAudioMessage = (base64Pcm16: string) => ({
  realtimeInput: { audio: { data: base64Pcm16, mimeType: 'audio/pcm;rate=16000' } },
})

/**
 * Tells automatic activity detection the microphone paused, so it closes the user's turn now.
 * Any later audio message reopens the stream, so audio must be held back until the user speaks.
 */
export const buildAudioStreamEndMessage = () => ({ realtimeInput: { audioStreamEnd: true } })

export const buildTextMessage = (text: string) => ({
  clientContent: { turns: [{ role: 'user', parts: [{ text }] }], turnComplete: true },
})

export interface ToolResponse {
  id: string
  name: string
  response: Record<string, unknown>
}

export const buildToolResponseMessage = (functionResponses: ToolResponse[]) => ({
  toolResponse: { functionResponses },
})

export interface ToolCall {
  id: string
  name: string
  args: Record<string, unknown>
}

export type LiveServerEvent =
  | { type: 'setupComplete' }
  | { type: 'inputTranscript'; text: string }
  | { type: 'audio'; data: Uint8Array }
  | { type: 'outputTranscript'; text: string }
  | { type: 'interrupted' }
  | { type: 'generationComplete' }
  | { type: 'turnComplete' }
  | { type: 'toolCall'; calls: ToolCall[] }
  | { type: 'toolCallCancellation'; ids: string[] }
  | { type: 'goAway' }
  | { type: 'error'; message: string }

export class MalformedMessageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MalformedMessageError'
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Turns one raw server frame into zero or more typed events, in the order the
 * UI must apply them. Unknown message kinds (usage metadata, resumption
 * handles) produce no events. Structurally invalid frames throw.
 */
export function parseServerMessage(raw: string): LiveServerEvent[] {
  let message: unknown
  try {
    message = JSON.parse(raw)
  } catch {
    throw new MalformedMessageError('Server frame is not valid JSON.')
  }
  if (!isRecord(message)) throw new MalformedMessageError('Server frame is not a JSON object.')

  const events: LiveServerEvent[] = []

  if ('setupComplete' in message) events.push({ type: 'setupComplete' })

  if (isRecord(message.error)) {
    const text = typeof message.error.message === 'string' ? message.error.message : 'Unknown server error'
    events.push({ type: 'error', message: text })
  }

  const content = message.serverContent
  if (content !== undefined) {
    if (!isRecord(content)) throw new MalformedMessageError('serverContent is not an object.')

    if (isRecord(content.inputTranscription) && typeof content.inputTranscription.text === 'string') {
      events.push({ type: 'inputTranscript', text: content.inputTranscription.text })
    }

    if (content.modelTurn !== undefined) {
      if (!isRecord(content.modelTurn) || !Array.isArray(content.modelTurn.parts)) {
        throw new MalformedMessageError('modelTurn.parts is missing.')
      }
      for (const part of content.modelTurn.parts) {
        if (!isRecord(part) || part.thought === true) continue
        const inline = part.inlineData
        if (isRecord(inline) && typeof inline.mimeType === 'string' && inline.mimeType.startsWith('audio/pcm')) {
          if (typeof inline.data !== 'string') throw new MalformedMessageError('Audio part has no data.')
          let data: Uint8Array
          try {
            data = base64ToBytes(inline.data)
          } catch {
            throw new MalformedMessageError('Audio part is not valid base64.')
          }
          if (data.byteLength > 0) events.push({ type: 'audio', data })
        }
      }
    }

    if (isRecord(content.outputTranscription) && typeof content.outputTranscription.text === 'string') {
      events.push({ type: 'outputTranscript', text: content.outputTranscription.text })
    }
    if (content.interrupted === true) events.push({ type: 'interrupted' })
    if (content.generationComplete === true) events.push({ type: 'generationComplete' })
    if (content.turnComplete === true) events.push({ type: 'turnComplete' })
  }

  if (isRecord(message.toolCall)) {
    const raw = message.toolCall.functionCalls
    if (!Array.isArray(raw)) throw new MalformedMessageError('toolCall.functionCalls is missing.')
    const calls: ToolCall[] = []
    for (const call of raw) {
      if (!isRecord(call) || typeof call.name !== 'string') continue
      calls.push({
        id: typeof call.id === 'string' ? call.id : '',
        name: call.name,
        args: isRecord(call.args) ? call.args : {},
      })
    }
    events.push({ type: 'toolCall', calls })
  }

  if (isRecord(message.toolCallCancellation) && Array.isArray(message.toolCallCancellation.ids)) {
    const ids = message.toolCallCancellation.ids.filter((id): id is string => typeof id === 'string')
    events.push({ type: 'toolCallCancellation', ids })
  }

  if ('goAway' in message) events.push({ type: 'goAway' })

  return events
}
