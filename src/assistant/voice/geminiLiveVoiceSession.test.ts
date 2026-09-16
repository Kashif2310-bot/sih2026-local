import { describe, expect, it } from 'vitest'
import { createGeminiLiveVoiceSessionFactory, GeminiLiveVoiceSession } from './geminiLiveVoiceSession'
import { arrayBufferToBase64 } from './geminiLiveProtocol'
import { FakeGeminiLiveTransport } from './testing/fakeGeminiLiveTransport'
import type { GeminiLiveVoiceSessionDeps } from './geminiLiveVoiceSession'
import type { GeminiLiveConnectionTarget } from './geminiLiveTransport'
import type { VoiceEvent, VoiceSessionConfig } from './types'

/**
 * Every test in this file drives GeminiLiveVoiceSession through a
 * FakeGeminiLiveTransport (testing/fakeGeminiLiveTransport.ts) — there is
 * no network, no real Gemini connection, and no Google server anywhere in
 * this file. What's under test is this adapter's PROTOCOL TRANSLATION:
 * does it send the right Gemini messages for a given VoiceSession call, and
 * does it emit the right VoiceEvents for a given (scripted) Gemini message.
 */

const TARGET: GeminiLiveConnectionTarget = { url: 'wss://fake.test/gemini-live' }

function baseConfig(overrides: Partial<VoiceSessionConfig> = {}): VoiceSessionConfig {
  return { language: { primary: 'en' }, ...overrides }
}

function harness(overrides: { failConnectWith?: Error; isConfigured?: boolean } = {}) {
  const transport = new FakeGeminiLiveTransport({ failConnectWith: overrides.failConnectWith })
  const deps: GeminiLiveVoiceSessionDeps = {
    createTransport: () => transport,
    resolveConnection: () => Promise.resolve(TARGET),
    isConfigured: () => overrides.isConfigured ?? true,
    model: 'models/test-model',
  }
  const session = new GeminiLiveVoiceSession(baseConfig(), deps, () => 'test-session-id')
  const events: VoiceEvent[] = []
  session.subscribe((e) => events.push(e))
  return { session, transport, events, deps }
}

function statusSequence(events: VoiceEvent[]): string[] {
  return events.filter((e): e is Extract<VoiceEvent, { type: 'status' }> => e.type === 'status').map((e) => e.status)
}

function pcm16Chunk(byteLength: number, sampleRateHz = 16000): { format: 'pcm16'; sampleRateHz: number; data: ArrayBuffer } {
  return { format: 'pcm16', sampleRateHz, data: new ArrayBuffer(byteLength) }
}

/**
 * connect() reaches transport.send(setupMessage) only after a few
 * microtask hops (await resolveConnection(), await transport.connect()).
 * Simulating setupComplete before that point would arrive before
 * waitForSetupComplete() has registered its waiter and be silently
 * dropped — so every test that simulates setupComplete waits for the
 * OBSERVABLE precondition (the setup message actually having been sent)
 * rather than guessing a tick count.
 */
async function untilSetupSent(transport: FakeGeminiLiveTransport): Promise<void> {
  for (let i = 0; i < 100 && transport.sentMessages.length === 0; i++) {
    await Promise.resolve()
  }
  if (transport.sentMessages.length === 0) {
    throw new Error('untilSetupSent: setup message was never sent — connect() did not reach transport.send()')
  }
}

/** connect() + immediately satisfy setupComplete, for tests that don't care about the handshake itself. */
async function connectedHarness() {
  const h = harness()
  const p = h.session.connect()
  await untilSetupSent(h.transport)
  h.transport.simulateServerMessage({ setupComplete: {} })
  await p
  return h
}

describe('GeminiLiveVoiceSession — 1. successful connection lifecycle', () => {
  it('connects, sends setup, and reaches listening only after setupComplete', async () => {
    const { session, transport, events } = harness()
    const connectPromise = session.connect()
    expect(session.status).toBe('connecting')

    await untilSetupSent(transport)
    expect(transport.connectTargets).toEqual([TARGET])
    expect(transport.sentMessages).toHaveLength(1)
    expect(transport.sentMessages[0]).toMatchObject({ setup: { model: 'models/test-model' } })
    // Not yet resolved — still waiting for setupComplete.
    expect(session.status).toBe('connected')

    transport.simulateServerMessage({ setupComplete: {} })
    await connectPromise

    expect(session.status).toBe('listening')
    expect(statusSequence(events)).toEqual(['connecting', 'connected', 'listening'])
  })

  it('every event carries the session id and strictly increasing sequence numbers', async () => {
    const { events } = await connectedHarness()
    for (const e of events) expect(e.sessionId).toBe('test-session-id')
    const seqs = events.map((e) => e.seq)
    for (let i = 1; i < seqs.length; i++) expect(seqs[i]).toBeGreaterThan(seqs[i - 1])
  })
})

describe('GeminiLiveVoiceSession — 2. connection failure', () => {
  it('rejects connect() and emits an error when the transport fails to open', async () => {
    const failure = new Error('handshake refused')
    const { session, events } = harness({ failConnectWith: failure })
    await expect(session.connect()).rejects.toThrow(/handshake refused/)
    expect(session.status).toBe('error')
    const errorEvent = events.find((e) => e.type === 'error') as Extract<VoiceEvent, { type: 'error' }> | undefined
    expect(errorEvent).toMatchObject({ error: { code: 'connection_failed' }, recoverable: true })
  })

  it('rejects connect() if setupComplete never arrives before the timeout', async () => {
    const transport = new FakeGeminiLiveTransport()
    const deps: GeminiLiveVoiceSessionDeps = {
      createTransport: () => transport,
      resolveConnection: () => Promise.resolve(TARGET),
      isConfigured: () => true,
      setupTimeoutMs: 15, // injected short timeout — GEMINI_LIVE_SETUP_TIMEOUT_MS (8s) would be too slow for a unit test
    }
    const session = new GeminiLiveVoiceSession(baseConfig(), deps)
    const events: VoiceEvent[] = []
    session.subscribe((e) => events.push(e))

    // Deliberately never call transport.simulateServerMessage({ setupComplete: {} }).
    await expect(session.connect()).rejects.toThrow(/timed out.*setupComplete/)
    expect(session.status).toBe('error')
    expect(transport.closeCalls).toHaveLength(1) // failConnect() tears down the half-open transport
    const errorEvent = events.find((e) => e.type === 'error') as Extract<VoiceEvent, { type: 'error' }>
    expect(errorEvent.error.code).toBe('connection_failed')
  })
})

describe('GeminiLiveVoiceSession — network loss during setup', () => {
  it('rejects connect() if the transport closes before setupComplete arrives', async () => {
    const { session, transport } = harness()
    const connectPromise = session.connect()
    await untilSetupSent(transport)
    transport.simulateClose({ reason: 'ECONNRESET' })
    await expect(connectPromise).rejects.toThrow(/closed before setup completed/)
    expect(session.status).toBe('error')
  })
})

describe('GeminiLiveVoiceSession — reconnect after a recoverable error', () => {
  it('a fresh connect() after an error creates a new transport and can succeed', async () => {
    const failure = new Error('temporary')
    const transport1 = new FakeGeminiLiveTransport({ failConnectWith: failure })
    let created = 0
    const transports = [transport1, new FakeGeminiLiveTransport()]
    const deps: GeminiLiveVoiceSessionDeps = {
      createTransport: () => transports[created++],
      resolveConnection: () => Promise.resolve(TARGET),
      isConfigured: () => true,
    }
    const session = new GeminiLiveVoiceSession(baseConfig(), deps)
    await expect(session.connect()).rejects.toThrow()
    expect(session.status).toBe('error')

    const secondTransport = transports[1] as FakeGeminiLiveTransport
    const p = session.connect()
    await untilSetupSent(secondTransport)
    secondTransport.simulateServerMessage({ setupComplete: {} })
    await p
    expect(session.status).toBe('listening')
    expect(created).toBe(2)
  })
})

describe('GeminiLiveVoiceSession — 3. user transcript partial/final translation', () => {
  it('translates interim and final inputTranscription into VoiceEvents, correlated to the audio turn', async () => {
    const { session, transport, events } = await connectedHarness()
    session.sendAudioChunk(pcm16Chunk(10))
    expect(session.status).toBe('user_speaking')

    transport.simulateServerMessage({ serverContent: { interimInputTranscription: { text: 'I want' } } })
    transport.simulateServerMessage({ serverContent: { interimInputTranscription: { text: 'I want to' } } })

    session.endUserTurn()
    expect(session.status).toBe('processing')

    transport.simulateServerMessage({ serverContent: { inputTranscription: { text: 'I want to start a dairy business', finished: true } } })

    const partials = events.filter((e): e is Extract<VoiceEvent, { type: 'user_transcript_partial' }> => e.type === 'user_transcript_partial')
    expect(partials.map((p) => p.text)).toEqual(['I want', 'I want to'])
    const final = events.find((e) => e.type === 'user_transcript_final') as Extract<VoiceEvent, { type: 'user_transcript_final' }>
    expect(final.text).toBe('I want to start a dairy business')
    expect(final.languageHint).toBe('en')

    // All correlated to the same turn id.
    const turnStarted = events.find((e) => e.type === 'turn_started' && e.role === 'user') as Extract<VoiceEvent, { type: 'turn_started' }>
    expect(partials.every((p) => p.turnId === turnStarted.turnId)).toBe(true)
    expect(final.turnId).toBe(turnStarted.turnId)
  })

  it('sends audioStreamEnd on endUserTurn and forwards audio chunks base64-encoded', async () => {
    const { session, transport } = await connectedHarness()
    const chunk = pcm16Chunk(4)
    session.sendAudioChunk(chunk)
    session.endUserTurn()

    expect(transport.sentMessages).toContainEqual({
      realtimeInput: { audio: { data: arrayBufferToBase64(chunk.data), mimeType: 'audio/pcm;rate=16000' } },
    })
    expect(transport.sentMessages).toContainEqual({ realtimeInput: { audioStreamEnd: true } })
  })

  it('a typed message is its own final transcript immediately, with no server round trip needed', async () => {
    const { session, transport, events } = await connectedHarness()
    session.sendTextInput('I need a loan for poultry')

    const final = events.find((e) => e.type === 'user_transcript_final') as Extract<VoiceEvent, { type: 'user_transcript_final' }>
    expect(final.text).toBe('I need a loan for poultry')
    expect(transport.sentMessages).toContainEqual({
      clientContent: { turns: [{ role: 'user', parts: [{ text: 'I need a loan for poultry' }] }], turnComplete: true },
    })
    expect(session.status).toBe('processing')
  })

  it('rejects a non-pcm16 audio chunk rather than silently forwarding it', async () => {
    const { session } = await connectedHarness()
    expect(() => session.sendAudioChunk({ format: 'opus', data: new ArrayBuffer(4) })).toThrow(/expected a 'pcm16'/)
  })

  it('rejects a pcm16 chunk with the wrong declared sample rate', async () => {
    const { session } = await connectedHarness()
    expect(() => session.sendAudioChunk(pcm16Chunk(4, 8000))).toThrow(/8000Hz/)
  })
})

describe('GeminiLiveVoiceSession — 4/5/6/7. model text, audio, completion, and turn boundaries', () => {
  it('translates modelTurn text+audio parts and turnComplete into the full model-turn event sequence', async () => {
    const { session, transport, events } = await connectedHarness()
    session.sendTextInput('tell me about schemes')

    transport.simulateServerMessage({
      serverContent: { modelTurn: { parts: [{ text: 'Here' }] } },
    })
    transport.simulateServerMessage({
      serverContent: { modelTurn: { parts: [{ text: ' are' }, { inlineData: { mimeType: 'audio/pcm;rate=24000', data: 'QUJD' } }] } },
    })
    transport.simulateServerMessage({
      serverContent: { modelTurn: { parts: [] }, turnComplete: true, generationComplete: true },
    })

    expect(session.status).toBe('listening')

    const types = events.map((e) => e.type)
    expect(types).toContain('turn_started')
    expect(types).toContain('model_text_partial')
    expect(types).toContain('model_audio_chunk')
    expect(types).toContain('model_text_final')
    expect(types).toContain('model_audio_end')

    const partials = events.filter((e): e is Extract<VoiceEvent, { type: 'model_text_partial' }> => e.type === 'model_text_partial')
    expect(partials.map((p) => p.text)).toEqual(['Here', 'Here are'])

    const final = events.find((e) => e.type === 'model_text_final') as Extract<VoiceEvent, { type: 'model_text_final' }>
    expect(final.text).toBe('Here are')

    const audioChunk = events.find((e) => e.type === 'model_audio_chunk') as Extract<VoiceEvent, { type: 'model_audio_chunk' }>
    expect(audioChunk.chunk.format).toBe('pcm16')
    expect(audioChunk.chunk.sampleRateHz).toBe(24000)
    expect(new Uint8Array(audioChunk.chunk.data)).toEqual(new Uint8Array([65, 66, 67])) // 'QUJD' -> "ABC"

    const modelTurnEnded = events.find((e) => e.type === 'turn_ended' && e.role === 'model') as Extract<VoiceEvent, { type: 'turn_ended' }>
    expect(modelTurnEnded.reason).toBe('completed')
  })

  it('translates outputTranscription text when the server sends it separately from modelTurn parts', async () => {
    const { session, transport, events } = await connectedHarness()
    session.sendTextInput('hi')
    transport.simulateServerMessage({ serverContent: { outputTranscription: { text: 'Hello there' } } })
    transport.simulateServerMessage({ serverContent: { turnComplete: true } })

    const final = events.find((e) => e.type === 'model_text_final') as Extract<VoiceEvent, { type: 'model_text_final' }>
    expect(final.text).toBe('Hello there')
  })
})

describe('GeminiLiveVoiceSession — 8/9/10. interruption and barge-in', () => {
  it('explicit interrupt() stops translating the model turn immediately', async () => {
    const { session, transport, events } = await connectedHarness()
    session.sendTextInput('a question')
    transport.simulateServerMessage({ serverContent: { modelTurn: { parts: [{ text: 'partial reply' }] } } })
    expect(session.status).toBe('model_speaking')

    session.interrupt()

    const interruptedEvent = events.find((e) => e.type === 'interrupted') as Extract<VoiceEvent, { type: 'interrupted' }>
    expect(interruptedEvent.reason).toBe('client_cancelled')
    expect(events.some((e) => e.type === 'turn_ended' && e.role === 'model' && e.reason === 'interrupted')).toBe(true)
    expect(session.status).toBe('interrupted')

    // Trailing stale content for the interrupted turn must be swallowed.
    transport.simulateServerMessage({
      serverContent: { modelTurn: { parts: [{ text: 'stale trailing text' }, { inlineData: { mimeType: 'audio/pcm;rate=24000', data: 'QUJD' } }] } },
    })
    expect(events.some((e) => e.type === 'model_text_partial' && e.text.includes('stale'))).toBe(false)
    expect(events.filter((e) => e.type === 'model_audio_chunk')).toHaveLength(0)
  })

  it('the server confirming interrupted:true clears the suppression window and returns to listening', async () => {
    const { session, transport, events } = await connectedHarness()
    session.sendTextInput('a question')
    transport.simulateServerMessage({ serverContent: { modelTurn: { parts: [{ text: 'partial' }] } } })
    session.interrupt()

    transport.simulateServerMessage({ serverContent: { interrupted: true } })
    expect(session.status).toBe('listening')

    // Now a genuinely new turn's content must NOT be suppressed.
    session.sendTextInput('a different question')
    transport.simulateServerMessage({ serverContent: { modelTurn: { parts: [{ text: 'fresh reply' }] } } })
    expect(events.some((e) => e.type === 'model_text_partial' && e.text === 'fresh reply')).toBe(true)
  })

  it('new input arriving while the model is speaking auto-interrupts as a user barge-in', async () => {
    const { session, transport, events } = await connectedHarness()
    session.sendTextInput('first question')
    transport.simulateServerMessage({ serverContent: { modelTurn: { parts: [{ text: 'replying' }] } } })
    const firstModelTurnId = (events.find((e) => e.type === 'turn_started' && e.role === 'model') as Extract<VoiceEvent, { type: 'turn_started' }>).turnId

    session.sendTextInput('actually, a different question')

    const bargeIn = events.find((e) => e.type === 'interrupted') as Extract<VoiceEvent, { type: 'interrupted' }>
    expect(bargeIn.reason).toBe('user_barge_in')
    expect(bargeIn.interruptedTurnId).toBe(firstModelTurnId)

    const secondFinal = events.filter((e) => e.type === 'user_transcript_final').at(-1) as Extract<VoiceEvent, { type: 'user_transcript_final' }>
    expect(secondFinal.text).toBe('actually, a different question')
    expect(transport.sentMessages).toContainEqual({
      clientContent: { turns: [{ role: 'user', parts: [{ text: 'actually, a different question' }] }], turnComplete: true },
    })
  })

  it('falls back to listening even if the server never confirms the interruption boundary', async () => {
    const transport = new FakeGeminiLiveTransport()
    const deps: GeminiLiveVoiceSessionDeps = {
      createTransport: () => transport,
      resolveConnection: () => Promise.resolve(TARGET),
      isConfigured: () => true,
      interruptSettleTimeoutMs: 15, // injected short timeout — the production value (1.5s) would be too slow for a unit test
    }
    const session = new GeminiLiveVoiceSession(baseConfig(), deps)
    const events: VoiceEvent[] = []
    session.subscribe((e) => events.push(e))
    const p = session.connect()
    await untilSetupSent(transport)
    transport.simulateServerMessage({ setupComplete: {} })
    await p

    session.sendTextInput('a question')
    transport.simulateServerMessage({ serverContent: { modelTurn: { parts: [{ text: 'partial' }] } } })
    session.interrupt()
    expect(session.status).toBe('interrupted')

    // No server confirmation ever arrives — only the fallback timeout resolves this.
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(session.status).toBe('listening')
    expect(events.filter((e) => e.type === 'interrupted')).toHaveLength(1)

    // Suppression must also have cleared — new content translates normally.
    session.sendTextInput('a new question')
    transport.simulateServerMessage({ serverContent: { modelTurn: { parts: [{ text: 'fresh' }] } } })
    expect(events.some((e) => e.type === 'model_text_partial' && e.text === 'fresh')).toBe(true)
  })
})

describe('GeminiLiveVoiceSession — 11. close/cleanup', () => {
  it('close() tears down the transport and stops emitting further events', async () => {
    const { session, transport, events } = await connectedHarness()
    session.sendTextInput('in flight')
    transport.simulateServerMessage({ serverContent: { modelTurn: { parts: [{ text: 'partial' }] } } })

    await session.close('test teardown')
    expect(session.status).toBe('closed')
    expect(transport.closeCalls).toHaveLength(1)

    const countAtClose = events.length
    // A stray message arriving after close() must be ignored.
    transport.simulateServerMessage({ serverContent: { modelTurn: { parts: [{ text: 'too late' }] } } })
    expect(events.length).toBe(countAtClose)
  })

  it('close() is safe to call more than once', async () => {
    const { session } = await connectedHarness()
    await session.close()
    await expect(session.close()).resolves.toBeUndefined()
  })

  it('throws when connect() is called on a closed session', async () => {
    const { session } = await connectedHarness()
    await session.close()
    await expect(session.connect()).rejects.toThrow(/closed session/)
  })

  it('throws for input before connect()', () => {
    const { session } = harness()
    expect(() => session.sendTextInput('too early')).toThrow(/call connect/)
  })
})

describe('GeminiLiveVoiceSession — 12. recoverable network failure', () => {
  it('an unexpected close after a successful connection is reported as a recoverable network error', async () => {
    const { session, transport, events } = await connectedHarness()
    transport.simulateClose({ code: 1006, reason: 'abnormal closure' })

    expect(session.status).toBe('error')
    const errorEvent = events.find((e) => e.type === 'error') as Extract<VoiceEvent, { type: 'error' }>
    expect(errorEvent.error.code).toBe('network_lost')
    expect(errorEvent.recoverable).toBe(true)
  })

  it('a transport-level error event alone does not change status (close drives the transition)', async () => {
    const { session, transport, events } = await connectedHarness()
    transport.simulateError({ code: 'network_lost', message: 'blip' })
    expect(session.status).toBe('listening')
    expect(events.some((e) => e.type === 'error')).toBe(true)
  })
})

describe('GeminiLiveVoiceSession — 13. language configuration', () => {
  it('maps the default (en) language into the setup message as en-US', async () => {
    const { transport } = await connectedHarness()
    const setup = transport.sentMessages[0]
    expect(setup).toMatchObject({ setup: { generationConfig: { speechConfig: { languageCode: 'en-US' } } } })
  })

  it('kn is translated to kn-IN in the setup message', async () => {
    const transport = new FakeGeminiLiveTransport()
    const deps: GeminiLiveVoiceSessionDeps = {
      createTransport: () => transport,
      resolveConnection: () => Promise.resolve(TARGET),
      isConfigured: () => true,
    }
    const session = new GeminiLiveVoiceSession(baseConfig({ language: { primary: 'kn', allowCodeSwitching: true } }), deps)
    const p = session.connect()
    await untilSetupSent(transport)
    transport.simulateServerMessage({ setupComplete: {} })
    await p
    expect(transport.sentMessages[0]).toMatchObject({ setup: { generationConfig: { speechConfig: { languageCode: 'kn-IN' } } } })
  })

  it('auto (mixed Kannada-English) omits languageCode entirely rather than guessing one', async () => {
    const transport = new FakeGeminiLiveTransport()
    const deps: GeminiLiveVoiceSessionDeps = {
      createTransport: () => transport,
      resolveConnection: () => Promise.resolve(TARGET),
      isConfigured: () => true,
    }
    const session = new GeminiLiveVoiceSession(baseConfig({ language: { primary: 'auto', allowCodeSwitching: true } }), deps)
    const p = session.connect()
    await untilSetupSent(transport)
    transport.simulateServerMessage({ setupComplete: {} })
    await p
    const setupMsg = transport.sentMessages[0] as { setup: { generationConfig?: { speechConfig?: unknown } } }
    expect(setupMsg.setup.generationConfig?.speechConfig).toBeUndefined()
  })

  it('carries the configured language as the transcript languageHint', async () => {
    const transport = new FakeGeminiLiveTransport()
    const deps: GeminiLiveVoiceSessionDeps = {
      createTransport: () => transport,
      resolveConnection: () => Promise.resolve(TARGET),
      isConfigured: () => true,
    }
    const session = new GeminiLiveVoiceSession(baseConfig({ language: { primary: 'kn' } }), deps)
    const events: VoiceEvent[] = []
    session.subscribe((e) => events.push(e))
    const p = session.connect()
    await untilSetupSent(transport)
    transport.simulateServerMessage({ setupComplete: {} })
    await p
    session.sendTextInput('namaskara')
    const final = events.find((e) => e.type === 'user_transcript_final') as Extract<VoiceEvent, { type: 'user_transcript_final' }>
    expect(final.languageHint).toBe('kn')
  })
})

describe('GeminiLiveVoiceSession — 14. context update', () => {
  it('updateContext merges context and emits a diagnostic without reconnecting or closing the transport', async () => {
    const { session, transport, events } = await connectedHarness()
    const sentBefore = transport.sentMessages.length
    session.updateContext({ language: { primary: 'kn' } })

    expect(transport.closeCalls).toHaveLength(0)
    expect(transport.sentMessages.length).toBe(sentBefore) // no message resent to Gemini — see updateContext()'s doc comment
    const diag = events.find((e) => e.type === 'diagnostic' && e.message === 'context updated') as Extract<VoiceEvent, { type: 'diagnostic' }>
    expect(diag.data?.fields).toEqual(['language'])
    expect(session.status).toBe('listening')
  })

  it('throws if called before connect()', () => {
    const { session } = harness()
    expect(() => session.updateContext({ language: { primary: 'en' } })).toThrow(/call connect/)
  })
})

describe('GeminiLiveVoiceSession — 15. no credentials exposed through client-facing code', () => {
  it('the sent setup message never contains an api key, token, or secret field', async () => {
    const { transport } = await connectedHarness()
    const raw = JSON.stringify(transport.sentMessages[0])
    expect(raw.toLowerCase()).not.toMatch(/api[_-]?key|secret|token/)
  })

  it('the connection target passed to the transport is whatever resolveConnection returns, never a hardcoded key-bearing URL', async () => {
    const { transport } = await connectedHarness()
    expect(transport.connectTargets[0]).toEqual(TARGET)
    expect(transport.connectTargets[0].url).not.toMatch(/key=/i)
  })

  it('isSupported() is false with no configuration, and no connection is attempted', async () => {
    const factory = createGeminiLiveVoiceSessionFactory({ isConfigured: () => false })
    await expect(factory.isSupported()).resolves.toBe(false)
  })

  it('the default connection resolver throws a clear, non-crashing error when unconfigured', async () => {
    const { defaultGeminiLiveConnectionResolver } = await import('./geminiLiveConfig')
    await expect(defaultGeminiLiveConnectionResolver()).rejects.toThrow(/not configured/)
  })
})

describe('GeminiLiveVoiceSession — 16. offline provider still works', () => {
  it('OfflineVoiceSession is unaffected by anything added for Gemini Live', async () => {
    const { OfflineVoiceSession } = await import('./offlineVoiceSession')
    const session = new OfflineVoiceSession({ language: { primary: 'en' } }, { stepDelayMs: 2 })
    await session.connect()
    expect(session.status).toBe('listening')
    await session.close()
  })

  it('the offline factory remains providerId "offline" and always supported', async () => {
    const { offlineVoiceSessionFactory } = await import('./offlineVoiceSession')
    expect(offlineVoiceSessionFactory.providerId).toBe('offline')
    await expect(offlineVoiceSessionFactory.isSupported()).resolves.toBe(true)
  })
})

describe('GeminiLiveVoiceSession — external reply delivery (replySource: "external")', () => {
  async function externalReplySession() {
    const transport = new FakeGeminiLiveTransport()
    const deps: GeminiLiveVoiceSessionDeps = {
      createTransport: () => transport,
      resolveConnection: () => Promise.resolve(TARGET),
      isConfigured: () => true,
    }
    const session = new GeminiLiveVoiceSession(baseConfig({ replySource: 'external' }), deps)
    const events: VoiceEvent[] = []
    session.subscribe((e) => events.push(e))
    const p = session.connect()
    await untilSetupSent(transport)
    transport.simulateServerMessage({ setupComplete: {} })
    await p
    return { session, transport, events }
  }

  it('never translates the server\'s own autonomous reply into model events, and stays at "processing"', async () => {
    const { session, transport, events } = await externalReplySession()
    session.sendTextInput('a question')
    transport.simulateServerMessage({ serverContent: { modelTurn: { parts: [{ text: 'an autonomous reply Gemini generated on its own' }] } } })
    transport.simulateServerMessage({ serverContent: { turnComplete: true } })

    expect(session.status).toBe('processing')
    expect(events.some((e) => e.type === 'model_text_partial' || e.type === 'model_text_final')).toBe(false)
  })

  it('the citizen\'s own transcription still flows through normally in external mode', async () => {
    const { session, transport, events } = await externalReplySession()
    session.sendAudioChunk({ format: 'pcm16', sampleRateHz: 16000, data: new ArrayBuffer(4) })
    transport.simulateServerMessage({ serverContent: { interimInputTranscription: { text: 'partial speech' } } })
    expect(events.some((e) => e.type === 'user_transcript_partial' && e.text === 'partial speech')).toBe(true)
    expect(session.status).toBe('user_speaking')
  })

  it('deliverAssistantReply() emits the controller-authored text as the model turn and returns to listening', async () => {
    const { session, events } = await externalReplySession()
    session.sendTextInput('a question')
    expect(session.status).toBe('processing')

    session.deliverAssistantReply('Are you already keeping cattle, or would this be a new setup?')

    expect(session.status).toBe('listening')
    const final = events.find((e) => e.type === 'model_text_final') as Extract<VoiceEvent, { type: 'model_text_final' }>
    expect(final.text).toBe('Are you already keeping cattle, or would this be a new setup?')
    expect(events.some((e) => e.type === 'turn_ended' && e.role === 'model' && e.reason === 'completed')).toBe(true)
    // Honestly no synthesized audio for controller-authored text in this phase.
    expect(events.some((e) => e.type === 'model_audio_chunk')).toBe(false)
  })

  it('throws when called on a session not configured for external replies', async () => {
    const { session } = await connectedHarness()
    session.sendTextInput('hello')
    expect(() => session.deliverAssistantReply('x')).toThrow(/replySource: 'external'/)
  })

  it('throws when called outside "processing" status', async () => {
    const { session } = await externalReplySession()
    expect(() => session.deliverAssistantReply('x')).toThrow(/expected 'processing'/)
  })

  it('default (unset replySource) preserves autonomous server-driven replies exactly as before', async () => {
    const { session, transport, events } = await connectedHarness()
    session.sendTextInput('hello')
    transport.simulateServerMessage({ serverContent: { modelTurn: { parts: [{ text: 'hi there' }] } } })
    transport.simulateServerMessage({ serverContent: { turnComplete: true } })
    expect(session.status).toBe('listening')
    expect(events.some((e) => e.type === 'model_text_final')).toBe(true)
  })
})

describe('createGeminiLiveVoiceSessionFactory', () => {
  it('reports providerId "gemini-live" and reflects the injected isConfigured() check', async () => {
    const configuredFactory = createGeminiLiveVoiceSessionFactory({ isConfigured: () => true })
    expect(configuredFactory.providerId).toBe('gemini-live')
    await expect(configuredFactory.isSupported()).resolves.toBe(true)

    const unconfiguredFactory = createGeminiLiveVoiceSessionFactory({ isConfigured: () => false })
    await expect(unconfiguredFactory.isSupported()).resolves.toBe(false)
  })

  it('create() builds a working session using the injected deps', async () => {
    const transport = new FakeGeminiLiveTransport()
    const factory = createGeminiLiveVoiceSessionFactory({
      createTransport: () => transport,
      resolveConnection: () => Promise.resolve(TARGET),
      isConfigured: () => true,
    })
    const session = factory.create(baseConfig())
    expect(session.status).toBe('idle')
    const p = session.connect()
    await untilSetupSent(transport)
    transport.simulateServerMessage({ setupComplete: {} })
    await p
    expect(session.status).toBe('listening')
  })
})
