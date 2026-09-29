import { describe, expect, it } from 'vitest'
import {
  arrayBufferToBase64,
  base64ToArrayBuffer,
  buildAudioChunkMessage,
  buildAudioStreamEndMessage,
  buildSetupMessage,
  buildTextTurnMessage,
  languageCodeFor,
  parseServerMessage,
  GEMINI_LIVE_INPUT_AUDIO_MIME_TYPE,
  GEMINI_LIVE_WEBSOCKET_ENDPOINT,
} from './geminiLiveProtocol'
import { buildGeminiLiveTokenUrl } from './geminiEphemeralTokenResolver'

/**
 * Regression test for a real, previously-shipped bug: this endpoint pointed
 * at the plain `BidiGenerateContent` RPC (the full-API-key method), and
 * every real connection attempt with a genuine minted token failed with
 * close code 1008 "Method doesn't allow unregistered callers" — because an
 * ephemeral/constrained token must be presented to the separately-named
 * `BidiGenerateContentConstrained` method instead (confirmed against
 * Google's own reference at https://ai.google.dev/api/live, and empirically
 * verified 2026-09-25 against a live connection). Unlike a test that merely
 * compares the built URL against this same constant (which would pass no
 * matter what the constant's value is), this pins the literal RPC method
 * name so a regression back to plain `BidiGenerateContent` fails loudly.
 */
describe('GEMINI_LIVE_WEBSOCKET_ENDPOINT', () => {
  it('targets the Constrained method required for ephemeral-token auth, not plain BidiGenerateContent', () => {
    expect(GEMINI_LIVE_WEBSOCKET_ENDPOINT.endsWith('.GenerativeService.BidiGenerateContentConstrained')).toBe(true)
    // The literal, unqualified method name must not appear anywhere in the
    // endpoint on its own — only as the suffix of the qualified Constrained
    // name checked above.
    expect(GEMINI_LIVE_WEBSOCKET_ENDPOINT).not.toMatch(/\.BidiGenerateContent$/)
  })

  it('uses the v1beta API version', () => {
    expect(GEMINI_LIVE_WEBSOCKET_ENDPOINT).toContain('.v1beta.')
  })

  it('places the ephemeral token in the access_token query parameter, never key', () => {
    const url = buildGeminiLiveTokenUrl('a-real-looking-token-value')
    expect(url).toContain('access_token=a-real-looking-token-value')
    expect(url).not.toMatch(/[?&]key=/)
  })
})

describe('languageCodeFor', () => {
  it('maps en -> en-US and kn -> kn-IN', () => {
    expect(languageCodeFor('en')).toBe('en-US')
    expect(languageCodeFor('kn')).toBe('kn-IN')
  })

  it('maps auto to undefined so Gemini applies its own detection/code-switching handling', () => {
    expect(languageCodeFor('auto')).toBeUndefined()
  })
})

describe('client message builders', () => {
  it('buildSetupMessage requests audio+transcription and includes languageCode only when given', () => {
    const withLanguage = buildSetupMessage({ model: 'models/x', languageCode: 'kn-IN' })
    expect(withLanguage.setup.model).toBe('models/x')
    expect(withLanguage.setup.generationConfig?.responseModalities).toEqual(['AUDIO'])
    expect(withLanguage.setup.generationConfig?.speechConfig).toEqual({ languageCode: 'kn-IN' })
    expect(withLanguage.setup.inputAudioTranscription).toEqual({})
    expect(withLanguage.setup.outputAudioTranscription).toEqual({})

    const withoutLanguage = buildSetupMessage({ model: 'models/x' })
    expect(withoutLanguage.setup.generationConfig?.speechConfig).toBeUndefined()
  })

  it('buildSetupMessage includes systemInstruction only when given', () => {
    const withInstruction = buildSetupMessage({ model: 'models/x', systemInstructionText: 'be helpful' })
    expect(withInstruction.setup.systemInstruction).toEqual({ parts: [{ text: 'be helpful' }] })

    const without = buildSetupMessage({ model: 'models/x' })
    expect(without.setup.systemInstruction).toBeUndefined()
  })

  it('buildAudioChunkMessage defaults to the documented 16kHz PCM mimeType', () => {
    const msg = buildAudioChunkMessage('QUJD')
    expect(msg).toEqual({ realtimeInput: { audio: { data: 'QUJD', mimeType: GEMINI_LIVE_INPUT_AUDIO_MIME_TYPE } } })
  })

  it('buildAudioStreamEndMessage matches the documented realtimeInput.audioStreamEnd shape', () => {
    expect(buildAudioStreamEndMessage()).toEqual({ realtimeInput: { audioStreamEnd: true } })
  })

  it('buildTextTurnMessage wraps text as a completed user turn', () => {
    expect(buildTextTurnMessage('hello')).toEqual({
      clientContent: { turns: [{ role: 'user', parts: [{ text: 'hello' }] }], turnComplete: true },
    })
  })
})

describe('parseServerMessage', () => {
  it('recognizes setupComplete', () => {
    expect(parseServerMessage({ setupComplete: {} })).toEqual({ setupComplete: {} })
  })

  it('recognizes an error message and drops unknown fields', () => {
    expect(parseServerMessage({ error: { message: 'boom', code: 500, status: 'INTERNAL' } })).toEqual({
      error: { message: 'boom', code: 500, status: 'INTERNAL' },
    })
  })

  it('rejects an error message with no message field', () => {
    expect(parseServerMessage({ error: { code: 500 } })).toBeNull()
  })

  it('parses a full serverContent message with text and audio parts', () => {
    const parsed = parseServerMessage({
      serverContent: {
        modelTurn: { parts: [{ text: 'hi' }, { inlineData: { mimeType: 'audio/pcm;rate=24000', data: 'QUJD' } }] },
        turnComplete: true,
        generationComplete: true,
      },
    })
    expect(parsed).toEqual({
      serverContent: {
        modelTurn: { parts: [{ text: 'hi', inlineData: undefined }, { text: undefined, inlineData: { mimeType: 'audio/pcm;rate=24000', data: 'QUJD' } }] },
        generationComplete: true,
        turnComplete: true,
        interrupted: undefined,
        inputTranscription: undefined,
        interimInputTranscription: undefined,
        outputTranscription: undefined,
        waitingForInput: undefined,
      },
    })
  })

  it('drops thought parts so model reasoning never reaches the transcript', () => {
    const parsed = parseServerMessage({
      serverContent: {
        modelTurn: { parts: [{ text: '**Recording User Details** I have logged...', thought: true }, { text: 'I found a scheme' }] },
      },
    })
    expect(parsed && 'serverContent' in parsed && parsed.serverContent.modelTurn?.parts.map((p) => p.text)).toEqual([
      undefined,
      'I found a scheme',
    ])
  })

  it('parses interrupted and transcription fields', () => {
    const parsed = parseServerMessage({
      serverContent: {
        interrupted: true,
        inputTranscription: { text: 'namaskara', finished: true },
        interimInputTranscription: { text: 'namas' },
      },
    })
    if (parsed && 'serverContent' in parsed) {
      expect(parsed.serverContent.interrupted).toBe(true)
      expect(parsed.serverContent.inputTranscription).toEqual({ text: 'namaskara', finished: true })
      expect(parsed.serverContent.interimInputTranscription).toEqual({ text: 'namas', finished: undefined })
    } else {
      throw new Error('expected a serverContent message')
    }
  })

  it('returns null for garbage input rather than guessing', () => {
    expect(parseServerMessage(null)).toBeNull()
    expect(parseServerMessage(undefined)).toBeNull()
    expect(parseServerMessage('a string')).toBeNull()
    expect(parseServerMessage(42)).toBeNull()
    expect(parseServerMessage({ somethingElseEntirely: true })).toBeNull()
  })
})

describe('base64 <-> ArrayBuffer round trip', () => {
  it('round-trips arbitrary bytes exactly', () => {
    const original = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255, 127, 128])
    const base64 = arrayBufferToBase64(original.buffer)
    const roundTripped = new Uint8Array(base64ToArrayBuffer(base64))
    expect(Array.from(roundTripped)).toEqual(Array.from(original))
  })

  it('round-trips an empty buffer', () => {
    const base64 = arrayBufferToBase64(new ArrayBuffer(0))
    expect(base64ToArrayBuffer(base64).byteLength).toBe(0)
  })
})
