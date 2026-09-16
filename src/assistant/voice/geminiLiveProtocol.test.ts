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
} from './geminiLiveProtocol'

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
