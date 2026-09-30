import { describe, expect, it } from 'vitest'
import {
  buildAudioStreamEndMessage,
  buildSetupMessage,
  GEMINI_LIVE_MODEL,
  MalformedMessageError,
  parseServerMessage,
} from './geminiProtocol'
import { bytesToBase64 } from './pcm'

describe('buildSetupMessage', () => {
  it('requests audio with both transcriptions and the pinned Live model', () => {
    const { setup } = buildSetupMessage({ systemInstruction: 'hi', tools: [] })
    expect(setup.model).toBe(GEMINI_LIVE_MODEL)
    expect(setup.generationConfig.responseModalities).toEqual(['AUDIO'])
    expect(setup.inputAudioTranscription).toEqual({})
    expect(setup.outputAudioTranscription).toEqual({})
  })

  it('keeps automatic activity detection on, which audioStreamEnd relies on', () => {
    const { setup } = buildSetupMessage({ systemInstruction: 'hi', tools: [] })
    expect(setup.realtimeInputConfig.automaticActivityDetection).not.toHaveProperty('disabled', true)
    expect(buildAudioStreamEndMessage()).toEqual({ realtimeInput: { audioStreamEnd: true } })
  })
})

describe('parseServerMessage', () => {
  it('extracts audio, transcripts and turn signals in order', () => {
    const audio = bytesToBase64(new Uint8Array([1, 0, 255, 127]))
    const events = parseServerMessage(
      JSON.stringify({
        serverContent: {
          inputTranscription: { text: 'I am 26' },
          modelTurn: {
            parts: [
              { text: 'internal', thought: true },
              { inlineData: { mimeType: 'audio/pcm;rate=24000', data: audio } },
            ],
          },
          outputTranscription: { text: 'Namaste' },
          turnComplete: true,
        },
      }),
    )
    expect(events.map((event) => event.type)).toEqual(['inputTranscript', 'audio', 'outputTranscript', 'turnComplete'])
  })

  it('parses interruption, tool calls and setup', () => {
    expect(parseServerMessage('{"setupComplete":{}}')).toEqual([{ type: 'setupComplete' }])
    expect(parseServerMessage('{"serverContent":{"interrupted":true}}')).toEqual([{ type: 'interrupted' }])
    expect(
      parseServerMessage('{"toolCall":{"functionCalls":[{"id":"1","name":"findSchemes","args":{"focus":"loan"}}]}}'),
    ).toEqual([{ type: 'toolCall', calls: [{ id: '1', name: 'findSchemes', args: { focus: 'loan' } }] }])
  })

  it('ignores unknown messages', () => {
    expect(parseServerMessage('{"usageMetadata":{"totalTokenCount":3}}')).toEqual([])
  })

  it('rejects malformed frames', () => {
    expect(() => parseServerMessage('not json')).toThrow(MalformedMessageError)
    expect(() => parseServerMessage('[1,2]')).toThrow(MalformedMessageError)
    expect(() => parseServerMessage('{"serverContent":{"modelTurn":{}}}')).toThrow(MalformedMessageError)
    expect(() =>
      parseServerMessage('{"serverContent":{"modelTurn":{"parts":[{"inlineData":{"mimeType":"audio/pcm","data":"%%"}}]}}}'),
    ).toThrow(MalformedMessageError)
  })
})
