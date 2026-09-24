/**
 * End-to-end tests for the native-audio conversation loop, driven by a
 * scripted fake Gemini rather than a real connection:
 *
 *   microphone frame -> session -> Gemini
 *   Gemini audio      -> session -> playback
 *   Gemini tool call  -> runtime -> deterministic pipeline -> tool response
 *   barge-in          -> playback silenced, stale audio invalidated
 *
 * These exercise the wiring that only exists once every layer is connected —
 * the individual layers have their own unit tests. What is faked here is
 * exactly one thing: Google's servers. Everything else (the adapter, the
 * runtime, the controller, the real deterministic pipeline) is the
 * production code path.
 */

import { describe, expect, it, vi } from 'vitest'
import { createEmptyApplicantProfile } from '../../shared/applicantProfile'
import { offlineProvider } from '../ai'
import { neverConfiguredLiveRetriever } from '../liveRetrieval'
import { EMPTY_PROFILE } from '../types'
import { GeminiLiveVoiceSession, type GeminiLiveVoiceSessionDeps } from '../voice/geminiLiveVoiceSession'
import { FakeGeminiLiveTransport } from '../voice/testing/fakeGeminiLiveTransport'
import { arrayBufferToBase64, type GeminiLiveClientMessage } from '../voice/geminiLiveProtocol'
import { VOICE_TOOL_DECLARATIONS } from './voiceTools'
import { VoiceAssistantController } from './voiceAssistantController'
import { createInitialConversationState } from './types'
import { VoiceConversationRuntime, type RuntimeEvent, type VoiceAudioBridge } from './voiceConversationRuntime'

/** Records what the audio layer was told to do, without any Web Audio. */
class FakeAudioBridge implements VoiceAudioBridge {
  readonly inputSampleRateHz = 16000
  playedChunks: ArrayBuffer[] = []
  interruptions = 0
  disposals = 0
  captureStarted = false
  private frameSink: ((frame: ArrayBuffer) => void) | null = null

  startCapture(onFrame: (frame: ArrayBuffer) => void): Promise<void> {
    this.captureStarted = true
    this.frameSink = onFrame
    return Promise.resolve()
  }

  stopCapture(): Promise<void> {
    this.frameSink = null
    return Promise.resolve()
  }

  playChunk(chunk: ArrayBuffer): void {
    this.playedChunks.push(chunk)
  }

  interruptPlayback(): void {
    this.interruptions += 1
  }

  dispose(): Promise<void> {
    this.disposals += 1
    this.frameSink = null
    return Promise.resolve()
  }

  /** Test hook: simulates the microphone producing one frame. */
  emitFrame(bytes = 320): void {
    this.frameSink?.(new ArrayBuffer(bytes))
  }
}

function pcmChunkBase64(sampleCount: number): string {
  return arrayBufferToBase64(new ArrayBuffer(sampleCount * 2))
}

interface Harness {
  transport: FakeGeminiLiveTransport
  session: GeminiLiveVoiceSession
  runtime: VoiceConversationRuntime
  audio: FakeAudioBridge
  controller: VoiceAssistantController
  events: RuntimeEvent[]
}

async function setup(): Promise<Harness> {
  const transport = new FakeGeminiLiveTransport()
  const deps: GeminiLiveVoiceSessionDeps = {
    createTransport: () => transport,
    resolveConnection: async () => ({ url: 'wss://fake.invalid/live' }),
    isConfigured: () => true,
    setupTimeoutMs: 50,
    interruptSettleTimeoutMs: 20,
  }
  const session = new GeminiLiveVoiceSession(
    {
      language: { primary: 'auto', allowCodeSwitching: true },
      replySource: 'provider',
      audioInputMode: 'continuous',
      tools: VOICE_TOOL_DECLARATIONS,
      systemInstruction: 'test instruction',
    },
    deps,
  )
  const controller = new VoiceAssistantController(
    { providers: [offlineProvider], liveRetriever: neverConfiguredLiveRetriever },
    createInitialConversationState(createEmptyApplicantProfile(), { ...EMPTY_PROFILE }),
  )
  const audio = new FakeAudioBridge()
  const runtime = new VoiceConversationRuntime({
    session,
    controller,
    replyAuthority: 'provider',
    audio,
    toolDeps: { controller },
  })
  const events: RuntimeEvent[] = []
  runtime.subscribe((e) => events.push(e))

  const started = runtime.start()
  // connect() only registers its setupComplete waiter after a few microtask
  // hops (resolveConnection, then transport.connect). Wait for the
  // OBSERVABLE precondition — the setup message actually having been sent —
  // rather than guessing a tick count, matching geminiLiveVoiceSession.test.ts.
  await vi.waitFor(() => expect(transport.sentMessages.length).toBeGreaterThan(0))
  transport.simulateServerMessage({ setupComplete: {} })
  await started

  return { transport, session, runtime, audio, controller, events }
}

/** Filters sent messages by their discriminating key. Typed as a plain string because the members of GeminiLiveClientMessage have disjoint keys, so `keyof` over the union collapses to never. */
function sentOfType(transport: FakeGeminiLiveTransport, key: string): GeminiLiveClientMessage[] {
  return transport.sentMessages.filter((m) => key in m)
}

describe('session setup', () => {
  it('declares the app tools and system instruction to Gemini', async () => {
    const { transport } = await setup()
    const setup0 = transport.sentMessages[0]
    expect('setup' in setup0).toBe(true)
    if (!('setup' in setup0)) return

    expect(setup0.setup.systemInstruction?.parts[0].text).toBe('test instruction')
    expect(setup0.setup.tools?.[0].functionDeclarations.map((f) => f.name)).toEqual(
      VOICE_TOOL_DECLARATIONS.map((t) => t.name),
    )
    // Native audio out, plus transcripts of both halves for the shared UI.
    expect(setup0.setup.generationConfig?.responseModalities).toEqual(['AUDIO'])
    expect(setup0.setup.inputAudioTranscription).toBeDefined()
    expect(setup0.setup.outputAudioTranscription).toBeDefined()
    // Server VAD left enabled — that is what gives natural turn-taking.
    expect(setup0.setup.realtimeInputConfig?.automaticActivityDetection?.disabled).toBeUndefined()
  })

  it('starts the microphone only after the session is connected', async () => {
    const { audio } = await setup()
    expect(audio.captureStarted).toBe(true)
  })
})

describe('microphone -> Gemini', () => {
  it('streams captured frames to Gemini as realtime audio', async () => {
    const { transport, audio } = await setup()
    audio.emitFrame()
    audio.emitFrame()

    const audioMessages = sentOfType(transport, 'realtimeInput').filter(
      (m) => 'realtimeInput' in m && 'audio' in m.realtimeInput,
    )
    expect(audioMessages).toHaveLength(2)
  })

  it('keeps streaming while the assistant speaks, so barge-in is possible', async () => {
    const { transport, audio } = await setup()
    // Gemini starts speaking.
    transport.simulateServerMessage({
      serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm', data: pcmChunkBase64(10) } }] } },
    })

    const before = sentOfType(transport, 'realtimeInput').length
    audio.emitFrame()
    // An open mic must NOT be rejected mid-reply — that would make it
    // impossible for the citizen to interrupt.
    expect(sentOfType(transport, 'realtimeInput').length).toBe(before + 1)
  })
})

describe('Gemini -> speaker', () => {
  it('plays the model native audio chunks it receives', async () => {
    const { transport, audio } = await setup()
    transport.simulateServerMessage({
      serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm', data: pcmChunkBase64(8) } }] } },
    })
    transport.simulateServerMessage({
      serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm', data: pcmChunkBase64(8) } }] } },
    })

    expect(audio.playedChunks).toHaveLength(2)
    expect(audio.playedChunks[0].byteLength).toBe(16)
  })

  it('surfaces both halves of the conversation as transcripts', async () => {
    const { transport, events } = await setup()

    transport.simulateServerMessage({ serverContent: { inputTranscription: { text: 'I want to start a dairy' } } })
    transport.simulateServerMessage({ serverContent: { outputTranscription: { text: 'Tell me your age.' } } })
    transport.simulateServerMessage({ serverContent: { turnComplete: true } })

    const transcripts = events.filter((e): e is Extract<RuntimeEvent, { type: 'transcript' }> => e.type === 'transcript')
    expect(transcripts.map((t) => t.role)).toEqual(['user', 'assistant'])
    expect(transcripts[0].text).toBe('I want to start a dairy')
    expect(transcripts[1].text).toBe('Tell me your age.')
  })

  it('records what the model said into the shared conversation state', async () => {
    const { transport, controller } = await setup()
    transport.simulateServerMessage({ serverContent: { outputTranscription: { text: 'How old are you?' } } })
    transport.simulateServerMessage({ serverContent: { turnComplete: true } })

    const assistantTurns = controller.getState().turns.filter((t) => t.role === 'assistant')
    expect(assistantTurns.at(-1)?.text).toBe('How old are you?')
  })
})

describe('barge-in', () => {
  it('silences playback the moment Gemini reports an interruption', async () => {
    const { transport, audio } = await setup()
    transport.simulateServerMessage({
      serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm', data: pcmChunkBase64(8) } }] } },
    })
    expect(audio.interruptions).toBe(0)

    transport.simulateServerMessage({ serverContent: { interrupted: true } })

    expect(audio.interruptions).toBe(1)
  })

  it('silences playback immediately on an explicit stop, without a round trip', async () => {
    const { transport, runtime, audio } = await setup()
    transport.simulateServerMessage({
      serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm', data: pcmChunkBase64(8) } }] } },
    })

    runtime.interrupt()

    expect(audio.interruptions).toBeGreaterThanOrEqual(1)
  })

  it('lets the conversation continue after an interruption', async () => {
    const { transport, audio } = await setup()
    transport.simulateServerMessage({
      serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm', data: pcmChunkBase64(8) } }] } },
    })
    transport.simulateServerMessage({ serverContent: { interrupted: true } })

    // A new reply after the interruption still plays.
    transport.simulateServerMessage({
      serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm', data: pcmChunkBase64(4) } }] } },
    })
    expect(audio.playedChunks.at(-1)?.byteLength).toBe(8)
  })
})

describe('tool calling', () => {
  it('runs a tool call and returns a structured response to Gemini', async () => {
    const { transport } = await setup()

    transport.simulateServerMessage({
      toolCall: { functionCalls: [{ id: 'tc-1', name: 'getCitizenProfile', args: {} }] },
    })
    await vi.waitFor(() => expect(sentOfType(transport, 'toolResponse')).toHaveLength(1))

    const response = sentOfType(transport, 'toolResponse')[0]
    if (!('toolResponse' in response)) throw new Error('expected a toolResponse')
    const fr = response.toolResponse.functionResponses[0]
    expect(fr.id).toBe('tc-1')
    expect(fr.name).toBe('getCitizenProfile')
    expect((fr.response as { ok: boolean }).ok).toBe(true)
  })

  it('routes a recorded detail through the real pipeline and back to Gemini', async () => {
    const { transport, controller } = await setup()

    transport.simulateServerMessage({
      toolCall: {
        functionCalls: [{ id: 'tc-2', name: 'recordCitizenDetail', args: { detail: 'I am 28 years old' } }],
      },
    })
    await vi.waitFor(() => expect(sentOfType(transport, 'toolResponse')).toHaveLength(1))

    // The deterministic pipeline actually ran.
    expect(controller.getState().userProfile.age).toBe(28)
  })

  it('answers an unknown tool with an error instead of leaving Gemini waiting', async () => {
    const { transport } = await setup()

    transport.simulateServerMessage({
      toolCall: { functionCalls: [{ id: 'tc-3', name: 'notARealTool', args: {} }] },
    })
    await vi.waitFor(() => expect(sentOfType(transport, 'toolResponse')).toHaveLength(1))

    const response = sentOfType(transport, 'toolResponse')[0]
    if (!('toolResponse' in response)) throw new Error('expected a toolResponse')
    expect((response.toolResponse.functionResponses[0].response as { ok: boolean }).ok).toBe(false)
  })

  it('batches several calls into one response so the model is not answered piecemeal', async () => {
    const { transport } = await setup()

    transport.simulateServerMessage({
      toolCall: {
        functionCalls: [
          { id: 'a', name: 'getCitizenProfile', args: {} },
          { id: 'b', name: 'getApplicationReadiness', args: {} },
        ],
      },
    })
    await vi.waitFor(() => expect(sentOfType(transport, 'toolResponse')).toHaveLength(1))

    const response = sentOfType(transport, 'toolResponse')[0]
    if (!('toolResponse' in response)) throw new Error('expected a toolResponse')
    expect(response.toolResponse.functionResponses.map((f) => f.id)).toEqual(['a', 'b'])
  })

  it('does not answer a tool call the model already cancelled', async () => {
    const { transport } = await setup()

    transport.simulateServerMessage({ toolCall: { functionCalls: [{ id: 'tc-4', name: 'getCitizenProfile', args: {} }] } })
    transport.simulateServerMessage({ toolCallCancellation: { ids: ['tc-4'] } })

    // Let the (now-pointless) tool finish.
    await new Promise((r) => setTimeout(r, 20))
    expect(sentOfType(transport, 'toolResponse')).toHaveLength(0)
  })
})

describe('transcript ingestion', () => {
  it('feeds the citizen spoken words into the deterministic pipeline', async () => {
    const { transport, controller } = await setup()

    transport.simulateServerMessage({
      serverContent: { inputTranscription: { text: 'I am 35 years old and I live in a village' } },
    })

    await vi.waitFor(() => expect(controller.getState().userProfile.age).toBe(35))
  })

  it('does not ask the controller to author a competing spoken reply', async () => {
    const { transport, controller } = await setup()
    const authorSpy = vi.spyOn(controller, 'handleUserTranscript')

    transport.simulateServerMessage({ serverContent: { inputTranscription: { text: 'I am 40 years old' } } })
    await vi.waitFor(() => expect(controller.getState().userProfile.age).toBe(40))

    // Gemini is speaking; a second generated reply would be a second voice.
    expect(authorSpy).not.toHaveBeenCalled()
  })
})

describe('teardown', () => {
  it('releases microphone and audio resources exactly once', async () => {
    const { runtime, audio } = await setup()
    await runtime.dispose()
    await runtime.dispose()
    expect(audio.disposals).toBe(1)
  })

  it('closes the underlying transport', async () => {
    const { runtime, transport } = await setup()
    await runtime.dispose()
    expect(transport.closeCalls.length).toBeGreaterThan(0)
  })
})
