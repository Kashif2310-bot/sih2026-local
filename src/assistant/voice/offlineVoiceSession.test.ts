import { describe, expect, it } from 'vitest'
import { createOfflineVoiceSession, offlineVoiceSessionFactory } from './offlineVoiceSession'
import type { VoiceEvent, VoiceSessionConfig } from './types'

const STEP_DELAY_MS = 2

function baseConfig(overrides: Partial<VoiceSessionConfig> = {}): VoiceSessionConfig {
  return { language: { primary: 'en' }, ...overrides }
}

function newSession(overrides: Partial<VoiceSessionConfig> = {}) {
  return createOfflineVoiceSession(baseConfig(overrides), { stepDelayMs: STEP_DELAY_MS })
}

function collect(session: { subscribe: (l: (e: VoiceEvent) => void) => () => void }) {
  const events: VoiceEvent[] = []
  const unsubscribe = session.subscribe((e) => events.push(e))
  return { events, unsubscribe }
}

/** Polls the collected events array until one matches, or rejects after timeoutMs. Real-time based on purpose — the offline session's own timing is real (tiny) delays, so this genuinely waits for asynchronous event delivery rather than assuming synchronous ordering. */
function waitFor(events: VoiceEvent[], predicate: (e: VoiceEvent) => boolean, timeoutMs = 2000): Promise<VoiceEvent> {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const check = () => {
      const found = events.find(predicate)
      if (found) {
        resolve(found)
        return
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`waitFor: timed out after ${timeoutMs}ms waiting for a matching event among ${events.length} collected`))
        return
      }
      setTimeout(check, 2)
    }
    check()
  })
}

function statusSequence(events: VoiceEvent[]): string[] {
  return events.filter((e): e is Extract<VoiceEvent, { type: 'status' }> => e.type === 'status').map((e) => e.status)
}

async function connectedSession(overrides: Partial<VoiceSessionConfig> = {}) {
  const session = newSession(overrides)
  const { events } = collect(session)
  await session.connect()
  return { session, events }
}

describe('OfflineVoiceSession — lifecycle', () => {
  it('starts idle before connect()', () => {
    const session = newSession()
    expect(session.status).toBe('idle')
  })

  it('connect() transitions idle -> connecting -> connected -> listening, in order', async () => {
    const { session, events } = await connectedSession()
    expect(session.status).toBe('listening')
    expect(statusSequence(events)).toEqual(['connecting', 'connected', 'listening'])
  })

  it('connect() is idempotent once already active', async () => {
    const { session, events } = await connectedSession()
    await session.connect()
    await session.connect()
    expect(statusSequence(events)).toEqual(['connecting', 'connected', 'listening'])
  })

  it('every emitted event carries this session\'s id and strictly increasing sequence numbers', async () => {
    const { session, events } = await connectedSession()
    expect(events.length).toBeGreaterThan(0)
    for (const e of events) expect(e.sessionId).toBe(session.id)
    const seqs = events.map((e) => e.seq)
    for (let i = 1; i < seqs.length; i++) expect(seqs[i]).toBeGreaterThan(seqs[i - 1])
  })

  it('throws if used before connect()', () => {
    const session = newSession()
    expect(() => session.sendTextInput('hello')).toThrow(/call connect/)
  })

  it('throws when connect() is called on a closed session', async () => {
    const { session } = await connectedSession()
    await session.close()
    await expect(session.connect()).rejects.toThrow(/closed session/)
  })
})

describe('OfflineVoiceSession — a full text-input turn', () => {
  it('produces the documented event sequence and ends back at listening', async () => {
    const { session, events } = await connectedSession()
    session.sendTextInput('I want to start a dairy business')

    await waitFor(events, (e) => e.type === 'turn_ended' && e.role === 'model')

    const types = events.map((e) => e.type)
    // user turn happens before the model turn
    expect(types.indexOf('user_transcript_final')).toBeLessThan(types.indexOf('model_text_final'))
    expect(types).toContain('turn_started')
    expect(types).toContain('user_transcript_partial')
    expect(types).toContain('user_transcript_final')
    expect(types).toContain('model_text_partial')
    expect(types).toContain('model_text_final')
    expect(types).toContain('model_audio_chunk')
    expect(types).toContain('model_audio_end')

    expect(statusSequence(events)).toEqual([
      'connecting',
      'connected',
      'listening',
      'user_speaking',
      'processing',
      'model_speaking',
      'listening',
    ])
    expect(session.status).toBe('listening')
  })

  it('the final user transcript matches exactly what was typed', async () => {
    const { session, events } = await connectedSession()
    session.sendTextInput('  I need a loan for poultry  ')
    const final = (await waitFor(events, (e) => e.type === 'user_transcript_final')) as Extract<
      VoiceEvent,
      { type: 'user_transcript_final' }
    >
    expect(final.text).toBe('I need a loan for poultry')
  })

  it('carries the session language as the transcript languageHint', async () => {
    const { session, events } = await connectedSession({ language: { primary: 'kn', allowCodeSwitching: true } })
    session.sendTextInput('nanu ondu dairy business start madabeku')
    const final = (await waitFor(events, (e) => e.type === 'user_transcript_final')) as Extract<
      VoiceEvent,
      { type: 'user_transcript_final' }
    >
    expect(final.languageHint).toBe('kn')
  })

  it('model replies are unmistakably labeled as an offline simulation, never as a real answer', async () => {
    const { session, events } = await connectedSession()
    session.sendTextInput('am I eligible for PMEGP')
    const final = (await waitFor(events, (e) => e.type === 'model_text_final')) as Extract<
      VoiceEvent,
      { type: 'model_text_final' }
    >
    expect(final.text).toMatch(/OFFLINE VOICE SESSION/)
    expect(final.text).toMatch(/simulation|scripted/i)
  })

  it('model audio chunks are tagged with format "mock", never a real codec', async () => {
    const { session, events } = await connectedSession()
    session.sendTextInput('hello')
    await waitFor(events, (e) => e.type === 'model_audio_end')
    const chunks = events.filter((e): e is Extract<VoiceEvent, { type: 'model_audio_chunk' }> => e.type === 'model_audio_chunk')
    expect(chunks.length).toBeGreaterThan(0)
    for (const c of chunks) expect(c.chunk.format).toBe('mock')
  })

  it('handles two sequential turns with distinct, increasing turn ids', async () => {
    const { session, events } = await connectedSession()
    session.sendTextInput('first message')
    await waitFor(events, (e) => e.type === 'turn_ended' && e.role === 'model')
    const firstModelTurn = events.find((e) => e.type === 'turn_ended' && e.role === 'model') as Extract<
      VoiceEvent,
      { type: 'turn_ended' }
    >

    session.sendTextInput('second message')
    await waitFor(
      events,
      (e) => e.type === 'turn_ended' && e.role === 'model' && e.turnId !== firstModelTurn.turnId,
    )
    const modelTurnIds = events
      .filter((e): e is Extract<VoiceEvent, { type: 'turn_ended' }> => e.type === 'turn_ended' && e.role === 'model')
      .map((e) => e.turnId)
    expect(new Set(modelTurnIds).size).toBe(2)
  })
})

describe('OfflineVoiceSession — push-to-talk audio input', () => {
  it('accumulates chunks and finalizes only on endUserTurn()', async () => {
    const { session, events } = await connectedSession()
    session.sendAudioChunk({ format: 'mock', data: new ArrayBuffer(10) })
    session.sendAudioChunk({ format: 'mock', data: new ArrayBuffer(20) })
    expect(session.status).toBe('user_speaking')
    expect(events.some((e) => e.type === 'user_transcript_final')).toBe(false)

    session.endUserTurn()
    const final = (await waitFor(events, (e) => e.type === 'user_transcript_final')) as Extract<
      VoiceEvent,
      { type: 'user_transcript_final' }
    >
    expect(final.text).toMatch(/30 bytes/)
    expect(final.text).toMatch(/OFFLINE VOICE SESSION/)
  })

  it('endUserTurn() with nothing captured is a harmless no-op', async () => {
    const { session } = await connectedSession()
    expect(() => session.endUserTurn()).not.toThrow()
    expect(session.status).toBe('listening')
  })
})

describe('OfflineVoiceSession — interruption / barge-in', () => {
  it('explicit interrupt() during model_speaking stops the reply mid-flight and returns to listening', async () => {
    const { session, events } = await connectedSession()
    session.sendTextInput('tell me about schemes')
    await waitFor(events, (e) => e.type === 'status' && e.status === 'model_speaking')

    session.interrupt()

    const interruptedEvent = (await waitFor(events, (e) => e.type === 'interrupted')) as Extract<
      VoiceEvent,
      { type: 'interrupted' }
    >
    expect(interruptedEvent.reason).toBe('client_cancelled')
    expect(events.some((e) => e.type === 'turn_ended' && e.role === 'model' && e.reason === 'interrupted')).toBe(true)

    // The initial connect() already produced one 'listening' status event —
    // wait specifically for the one that comes back AFTER the interrupt.
    await waitFor(events, (e) => e.type === 'status' && e.status === 'listening' && e.seq > interruptedEvent.seq, 2000)
    expect(session.status).toBe('listening')

    // No model_audio_end for the interrupted turn — it was genuinely cut off, not merely marked.
    expect(events.some((e) => e.type === 'model_audio_end')).toBe(false)
  })

  it('interrupt() is a harmless no-op when the model is not speaking', async () => {
    const { session, events } = await connectedSession()
    expect(() => session.interrupt()).not.toThrow()
    expect(events.some((e) => e.type === 'interrupted')).toBe(false)
    expect(session.status).toBe('listening')
  })

  it('new speech during model_speaking auto-interrupts as a user barge-in and starts a fresh turn', async () => {
    const { session, events } = await connectedSession()
    session.sendTextInput('first question')
    await waitFor(events, (e) => e.type === 'status' && e.status === 'model_speaking')
    const interruptedModelTurnId = (
      events.find((e) => e.type === 'turn_started' && e.role === 'model') as Extract<VoiceEvent, { type: 'turn_started' }>
    ).turnId

    // Citizen starts talking over the assistant — barge in with new text input.
    session.sendTextInput('actually, different question')

    const bargeIn = (await waitFor(events, (e) => e.type === 'interrupted')) as Extract<VoiceEvent, { type: 'interrupted' }>
    expect(bargeIn.reason).toBe('user_barge_in')
    expect(bargeIn.interruptedTurnId).toBe(interruptedModelTurnId)

    // The barge-in text becomes its own new user turn and gets a full reply.
    const secondFinal = (await waitFor(
      events,
      (e) => e.type === 'user_transcript_final' && e.text === 'actually, different question',
    )) as Extract<VoiceEvent, { type: 'user_transcript_final' }>
    expect(secondFinal.text).toBe('actually, different question')

    await waitFor(
      events,
      (e) => e.type === 'turn_ended' && e.role === 'model' && e.reason === 'completed' && e.turnId !== interruptedModelTurnId,
    )
    expect(session.status).toBe('listening')
  })

  it('an interrupted model turn never emits any of its own events after the interruption', async () => {
    const { session, events } = await connectedSession()
    session.sendTextInput('a long question that will take a while to answer in full')
    await waitFor(events, (e) => e.type === 'status' && e.status === 'model_speaking')
    const modelTurnId = (
      events.find((e) => e.type === 'turn_started' && e.role === 'model') as Extract<VoiceEvent, { type: 'turn_started' }>
    ).turnId

    const seqBeforeInterrupt = events[events.length - 1].seq
    session.interrupt()
    await waitFor(events, (e) => e.type === 'status' && e.status === 'listening' && e.seq > seqBeforeInterrupt, 2000)

    const countAtInterruptSettled = events.length
    await new Promise((r) => setTimeout(r, STEP_DELAY_MS * 6))
    const laterModelEventsForSameTurn = events
      .slice(countAtInterruptSettled)
      .filter((e) => 'turnId' in e && e.turnId === modelTurnId)
    expect(laterModelEventsForSameTurn).toEqual([])
  })
})

describe('OfflineVoiceSession — error handling and reconnect', () => {
  it('a recoverable error moves to error status without closing the session', async () => {
    const { session, events } = await connectedSession()
    session.simulateError({ code: 'network_lost', message: 'simulated network blip' }, true)
    expect(session.status).toBe('error')
    const errorEvent = events.find((e) => e.type === 'error')
    expect(errorEvent).toMatchObject({ type: 'error', recoverable: true })

    // connect() retries successfully after a recoverable error.
    await session.connect()
    expect(session.status).toBe('listening')
  })

  it('a non-recoverable error closes the session, and it cannot be reconnected', async () => {
    const { session, events } = await connectedSession()
    session.simulateError({ code: 'permission_denied', message: 'mic permission denied' }, false)

    await waitFor(events, (e) => e.type === 'status' && e.status === 'closed')
    expect(session.status).toBe('closed')
    await expect(session.connect()).rejects.toThrow(/closed session/)
  })

  it('rejects audio input while the session is in error status', async () => {
    const { session } = await connectedSession()
    session.simulateError({ code: 'unknown', message: 'boom' }, true)
    expect(() => session.sendAudioChunk({ format: 'mock', data: new ArrayBuffer(4) })).toThrow(/call connect/)
  })
})

describe('OfflineVoiceSession — cleanup / disconnect', () => {
  it('close() releases resources and stops further events, even mid-turn', async () => {
    const { session, events } = await connectedSession()
    session.sendTextInput('question in flight when we hang up')
    await waitFor(events, (e) => e.type === 'status' && e.status === 'model_speaking')

    await session.close('test teardown')
    const countAtClose = events.length

    await new Promise((r) => setTimeout(r, STEP_DELAY_MS * 8))
    expect(events.length).toBe(countAtClose)
    expect(session.status).toBe('closed')
  })

  it('close() is safe to call more than once', async () => {
    const { session } = await connectedSession()
    await session.close()
    await expect(session.close()).resolves.toBeUndefined()
  })

  it('unsubscribe stops delivering events to that listener without affecting others', async () => {
    const session = newSession()
    const a: VoiceEvent[] = []
    const b: VoiceEvent[] = []
    const unsubA = session.subscribe((e) => a.push(e))
    session.subscribe((e) => b.push(e))

    await session.connect()
    unsubA()
    session.sendTextInput('hi')
    await waitFor(b, (e) => e.type === 'user_transcript_final')

    expect(b.some((e) => e.type === 'user_transcript_final')).toBe(true)
    expect(a.some((e) => e.type === 'user_transcript_final')).toBe(false)
  })

  it('close() clears listeners so a lingering reference cannot leak further events', async () => {
    const { session, events } = await connectedSession()
    await session.close()
    const countAfterClose = events.length
    // Any further calls on a closed session must throw, never silently emit.
    expect(() => session.sendTextInput('too late')).toThrow(/closed/)
    expect(events.length).toBe(countAfterClose)
  })
})

describe('OfflineVoiceSession — updateContext', () => {
  it('merges new context and emits a diagnostic event naming the changed fields', async () => {
    const { session, events } = await connectedSession()
    session.updateContext({ language: { primary: 'auto', allowCodeSwitching: true } })
    const diag = events.find((e) => e.type === 'diagnostic' && e.message === 'context updated') as
      | Extract<VoiceEvent, { type: 'diagnostic' }>
      | undefined
    expect(diag?.data?.fields).toEqual(['language'])
  })

  it('throws if called before connect()', () => {
    const session = newSession()
    expect(() => session.updateContext({ language: { primary: 'en' } })).toThrow(/call connect/)
  })
})

describe('OfflineVoiceSession — external reply delivery (replySource: "external")', () => {
  it('stays at "processing" (never autonomously speaks) until deliverAssistantReply() is called', async () => {
    const { session, events } = await connectedSession({ replySource: 'external' })
    session.sendTextInput('I want to start a dairy business')
    await waitFor(events, (e) => e.type === 'status' && e.status === 'processing')

    await new Promise((r) => setTimeout(r, STEP_DELAY_MS * 6))
    expect(session.status).toBe('processing')
    expect(events.some((e) => e.type === 'model_text_final')).toBe(false)

    session.deliverAssistantReply('Are you already keeping cattle, or would this be a new setup?')
    const final = (await waitFor(events, (e) => e.type === 'model_text_final')) as Extract<VoiceEvent, { type: 'model_text_final' }>
    expect(final.text).toBe('Are you already keeping cattle, or would this be a new setup?')
    await waitFor(events, (e) => e.type === 'status' && e.status === 'listening')
  })

  it('throws when called on a session that was not configured for external replies', async () => {
    const { session } = await connectedSession()
    session.sendTextInput('hello')
    expect(() => session.deliverAssistantReply('x')).toThrow(/replySource: 'external'/)
  })

  it('throws when called with no turn actually pending', async () => {
    const { session } = await connectedSession({ replySource: 'external' })
    expect(() => session.deliverAssistantReply('x')).toThrow(/no turn is currently awaiting/)
  })

  it('an externally-delivered reply is interruptible exactly like an autonomous one', async () => {
    const { session, events } = await connectedSession({ replySource: 'external' })
    session.sendTextInput('a question')
    await waitFor(events, (e) => e.type === 'status' && e.status === 'processing')
    // runModelTurn() has one more internal sleep() tick between entering
    // 'processing' and actually registering as ready for
    // deliverAssistantReply() — wait past it rather than racing.
    await new Promise((r) => setTimeout(r, STEP_DELAY_MS * 3))
    session.deliverAssistantReply('a longer reply with several words to stream out')
    await waitFor(events, (e) => e.type === 'status' && e.status === 'model_speaking')

    session.interrupt()
    const interrupted = await waitFor(events, (e) => e.type === 'interrupted')
    expect(interrupted).toMatchObject({ reason: 'client_cancelled' })
    expect(events.some((e) => e.type === 'model_audio_end')).toBe(false)
  })

  it('close() while awaiting an external reply resolves cleanly with no dangling promise/error', async () => {
    const { session, events } = await connectedSession({ replySource: 'external' })
    session.sendTextInput('a question')
    await waitFor(events, (e) => e.type === 'status' && e.status === 'processing')
    await session.close()
    expect(session.status).toBe('closed')
  })

  it('default (unset replySource) behaves exactly as before — autonomous reply, no deliverAssistantReply needed', async () => {
    const { session, events } = await connectedSession()
    session.sendTextInput('hello')
    await waitFor(events, (e) => e.type === 'turn_ended' && e.role === 'model')
    expect(session.status).toBe('listening')
  })
})

describe('offlineVoiceSessionFactory', () => {
  it('reports itself always supported and builds a working session', async () => {
    expect(offlineVoiceSessionFactory.providerId).toBe('offline')
    await expect(offlineVoiceSessionFactory.isSupported()).resolves.toBe(true)

    const session = offlineVoiceSessionFactory.create(baseConfig())
    expect(session.status).toBe('idle')
    await session.connect()
    expect(session.status).toBe('listening')
    await session.close()
  })
})
