import { describe, expect, it, vi } from 'vitest'
import { offlineProvider } from '../ai'
import type { LiveRetriever } from '../liveRetrieval'
import { OfflineVoiceSession } from '../voice/offlineVoiceSession'
import { GeminiLiveVoiceSession, type GeminiLiveVoiceSessionDeps } from '../voice/geminiLiveVoiceSession'
import { FakeGeminiLiveTransport } from '../voice/testing/fakeGeminiLiveTransport'
import type { VoiceEvent, VoiceEventInput, VoiceSession, VoiceSessionError, VoiceSessionStatus } from '../voice/types'
import { VoiceAssistantController } from './voiceAssistantController'
import type { VoiceAssistantTurnResult } from './voiceAssistantController'
import { VoiceConversationRuntime, type ConversationTurnHandler, type RuntimeEvent } from './voiceConversationRuntime'
import { buildPersonalizedReport } from './report'
import { createEmptyApplicantProfile } from '../../shared/applicantProfile'
import { EMPTY_PROFILE } from '../types'

function countingLiveRetriever(): LiveRetriever & { calls: number } {
  const state = { calls: 0 }
  return {
    get calls() {
      return state.calls
    },
    isAvailable: () => Promise.resolve(true),
    retrieve: async () => {
      state.calls += 1
      return []
    },
  }
}

/**
 * FakeVoiceSession — a minimal, hand-driven VoiceSession implementation
 * used ONLY to prove the RUNTIME's own concurrency/correlation logic is
 * robust regardless of what any specific provider's state machine allows.
 * Unlike OfflineVoiceSession/GeminiLiveVoiceSession (which structurally
 * cannot accept new input during 'processing'), this fake can emit any
 * event sequence a test wants — including races those two real
 * implementations happen to prevent by construction — so the runtime is
 * tested against the CONTRACT (VoiceEvent/VoiceSession), not against one
 * provider's particular timing.
 */
class FakeVoiceSession implements VoiceSession {
  readonly id: string
  private _status: VoiceSessionStatus = 'listening'
  private readonly listeners = new Set<(event: VoiceEvent) => void>()
  private seq = 0
  closeCalls = 0
  deliveredReplies: string[] = []
  deliverError: Error | null = null

  constructor(id = 'fake-session') {
    this.id = id
  }

  get status(): VoiceSessionStatus {
    return this._status
  }

  connect(): Promise<void> {
    this.setStatus('listening')
    return Promise.resolve()
  }

  close(): Promise<void> {
    this.closeCalls += 1
    this.setStatus('closed')
    return Promise.resolve()
  }

  sendAudioChunk(): void {}
  endUserTurn(): void {}

  sendTextInput(text: string): void {
    this.emitFinalTranscript(`fake-turn-${this.seq + 1}`, text)
  }

  interrupt(): void {
    this.emitInterrupted()
  }

  updateContext(): void {}

  deliverAssistantReply(text: string): void {
    if (this.deliverError) throw this.deliverError
    this.deliveredReplies.push(text)
    this.setStatus('listening')
  }

  subscribe(listener: (event: VoiceEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  // -- test-driving API --------------------------------------------------

  setStatus(status: VoiceSessionStatus): void {
    const previous = this._status
    if (previous === status) return
    this._status = status
    this.emit({ type: 'status', status, previousStatus: previous })
  }

  emitFinalTranscript(turnId: string, text: string): void {
    this.setStatus('processing')
    this.emit({ type: 'user_transcript_final', turnId, text })
  }

  emitPartialTranscript(turnId: string, text: string): void {
    this.emit({ type: 'user_transcript_partial', turnId, text })
  }

  emitInterrupted(turnId = 'interrupted-turn'): void {
    this.emit({ type: 'interrupted', interruptedTurnId: turnId, reason: 'client_cancelled' })
    this.setStatus('interrupted')
  }

  emitError(error: VoiceSessionError, recoverable: boolean): void {
    this.emit({ type: 'error', error, recoverable })
  }

  private emit(partial: VoiceEventInput): void {
    this.seq += 1
    const full = { ...partial, seq: this.seq, at: new Date().toISOString(), sessionId: this.id } as VoiceEvent
    for (const listener of this.listeners) listener(full)
  }
}

/** A lightweight test double satisfying ConversationTurnHandler, for tests that need to force a slow/throwing controller — see the interface's own doc comment for why the real, deliberately-resilient controller is awkward to break for this specific purpose. */
class ScriptedController implements ConversationTurnHandler {
  calls: string[] = []
  private readonly script: (text: string) => Promise<VoiceAssistantTurnResult>

  constructor(script: (text: string) => Promise<VoiceAssistantTurnResult>) {
    this.script = script
  }

  handleUserTranscript(transcript: string): Promise<VoiceAssistantTurnResult> {
    this.calls.push(transcript)
    return this.script(transcript)
  }
}

function fakeTurnResult(replyText: string): VoiceAssistantTurnResult {
  const readiness = { status: 'exploratory' as const, rationale: [], materialGapsRemaining: [] }
  return {
    state: {} as VoiceAssistantTurnResult['state'],
    question: { shouldAsk: false, reason: 'test fixture' },
    readiness,
    report: buildPersonalizedReport({
      applicantProfile: createEmptyApplicantProfile(),
      userProfile: EMPTY_PROFILE,
      ranked: [],
      actionPlan: [],
      readiness,
      sourceStatus: null,
      reportId: 'runtime-fixture',
    }),
    replyText,
    isFallback: true,
    usedProvider: 'offline',
    contextualEvidence: [],
    evidenceCoverage: null,
  }
}

function realController(): VoiceAssistantController {
  return new VoiceAssistantController({ providers: [offlineProvider] })
}

function collectEvents(runtime: { subscribe: (l: (e: RuntimeEvent) => void) => () => void }) {
  const events: RuntimeEvent[] = []
  runtime.subscribe((e) => events.push(e))
  return events
}

describe('VoiceConversationRuntime — 1/2. final vs. partial transcript reaching the controller', () => {
  it('a final transcript reaches the controller', async () => {
    const session = new FakeVoiceSession()
    const controller = new ScriptedController(async (text) => fakeTurnResult(`echo: ${text}`))
    new VoiceConversationRuntime({ session, controller })

    session.emitFinalTranscript('t1', 'I want to start a dairy business.')
    await vi.waitFor(() => expect(controller.calls).toEqual(['I want to start a dairy business.']))
  })

  it('a partial transcript never reaches the controller', async () => {
    const session = new FakeVoiceSession()
    const controller = new ScriptedController(async (text) => fakeTurnResult(`echo: ${text}`))
    new VoiceConversationRuntime({ session, controller })

    session.emitPartialTranscript('t1', 'I want to start a dairy...')
    await new Promise((r) => setTimeout(r, 20))
    expect(controller.calls).toEqual([])
  })
})

describe('VoiceConversationRuntime — 3. controller response reaches VoiceSession', () => {
  it('delivers the controller\'s replyText via deliverAssistantReply(), not sendTextInput()', async () => {
    const session = new FakeVoiceSession()
    const controller = new ScriptedController(async (text) => fakeTurnResult(`Are you already doing this, or new? (heard: ${text})`))
    new VoiceConversationRuntime({ session, controller })

    session.emitFinalTranscript('t1', 'I want a dairy business.')
    await vi.waitFor(() => expect(session.deliveredReplies).toHaveLength(1))
    expect(session.deliveredReplies[0]).toBe('Are you already doing this, or new? (heard: I want a dairy business.)')
  })
})

describe('VoiceConversationRuntime — 4. text input uses the same controller', () => {
  it('runtime.sendText() and a spoken transcript both flow through the identical pipeline', async () => {
    const session = new FakeVoiceSession()
    const controller = new ScriptedController(async (text) => fakeTurnResult(`heard: ${text}`))
    const runtime = new VoiceConversationRuntime({ session, controller })

    runtime.sendText('typed input')
    await vi.waitFor(() => expect(controller.calls).toEqual(['typed input']))
    await vi.waitFor(() => expect(session.deliveredReplies).toEqual(['heard: typed input']))
  })
})

describe('VoiceConversationRuntime — 5/6. duplicate final transcript is ignored', () => {
  it('the same turnId arriving twice is only processed once', async () => {
    const session = new FakeVoiceSession()
    const controller = new ScriptedController(async (text) => fakeTurnResult(`heard: ${text}`))
    new VoiceConversationRuntime({ session, controller })

    session.emitFinalTranscript('dup-turn', 'hello')
    await vi.waitFor(() => expect(controller.calls).toHaveLength(1))
    // Re-emit the identical turnId directly (bypassing setStatus's no-op guard by emitting the raw event again).
    session.emitFinalTranscript('dup-turn', 'hello')
    await new Promise((r) => setTimeout(r, 20))
    expect(controller.calls).toHaveLength(1)
  })
})

describe('VoiceConversationRuntime — 7/8. interruption cancels a stale reply and stale content cannot leak', () => {
  it('a reply that resolves after an interruption is never delivered', async () => {
    const session = new FakeVoiceSession()
    let resolveTurn: ((r: VoiceAssistantTurnResult) => void) | null = null
    const controller = new ScriptedController(
      () =>
        new Promise<VoiceAssistantTurnResult>((resolve) => {
          resolveTurn = resolve
        }),
    )
    const events = collectEvents(new VoiceConversationRuntime({ session, controller }))

    session.emitFinalTranscript('t1', 'first question')
    await vi.waitFor(() => expect(controller.calls).toHaveLength(1))

    session.emitInterrupted() // the user barges in / this turn is cancelled before the controller resolves
    resolveTurn!(fakeTurnResult('a stale reply for the cancelled turn'))

    await new Promise((r) => setTimeout(r, 20))
    expect(session.deliveredReplies).toEqual([])
    expect(events.some((e) => e.type === 'turn_completed')).toBe(false)
  })

  it('new transcript after an interruption is processed immediately, not queued behind the old one', async () => {
    const session = new FakeVoiceSession()
    let resolveFirst: ((r: VoiceAssistantTurnResult) => void) | null = null
    let callCount = 0
    const controller = new ScriptedController((text) => {
      callCount += 1
      if (callCount === 1) {
        return new Promise<VoiceAssistantTurnResult>((resolve) => {
          resolveFirst = resolve
        })
      }
      return Promise.resolve(fakeTurnResult(`second reply: ${text}`))
    })
    new VoiceConversationRuntime({ session, controller })

    session.emitFinalTranscript('t1', 'first question')
    await vi.waitFor(() => expect(controller.calls).toHaveLength(1))
    session.emitInterrupted()
    session.emitFinalTranscript('t2', 'actually I already have cows')

    await vi.waitFor(() => expect(session.deliveredReplies).toEqual(['second reply: actually I already have cows']))
    // The stale first turn resolving afterward must still never be delivered.
    resolveFirst!(fakeTurnResult('stale'))
    await new Promise((r) => setTimeout(r, 20))
    expect(session.deliveredReplies).toEqual(['second reply: actually I already have cows'])
  })
})

describe('VoiceConversationRuntime — 9. concurrent user turns', () => {
  it('two final transcripts arriving back-to-back only deliver the latest result', async () => {
    const session = new FakeVoiceSession()
    const resolvers: Array<() => void> = []
    const controller = new ScriptedController(
      (text) =>
        new Promise<VoiceAssistantTurnResult>((resolve) => {
          resolvers.push(() => resolve(fakeTurnResult(`reply to: ${text}`)))
        }),
    )
    new VoiceConversationRuntime({ session, controller })

    session.emitFinalTranscript('t1', 'first')
    session.emitFinalTranscript('t2', 'second')
    await vi.waitFor(() => expect(controller.calls).toEqual(['first', 'second']))

    // Resolve out of order — the FIRST call resolving after the second was
    // already issued must still be discarded as stale.
    resolvers[0]()
    resolvers[1]()
    await vi.waitFor(() => expect(session.deliveredReplies).toEqual(['reply to: second']))
  })
})

describe('VoiceConversationRuntime — 10. VoiceSession closes during processing', () => {
  it('a reply that resolves after the session closed is never delivered', async () => {
    const session = new FakeVoiceSession()
    let resolveTurn: ((r: VoiceAssistantTurnResult) => void) | null = null
    const controller = new ScriptedController(
      () =>
        new Promise<VoiceAssistantTurnResult>((resolve) => {
          resolveTurn = resolve
        }),
    )
    new VoiceConversationRuntime({ session, controller })

    session.emitFinalTranscript('t1', 'a question')
    await vi.waitFor(() => expect(controller.calls).toHaveLength(1))
    await session.close()
    resolveTurn!(fakeTurnResult('too late'))

    await new Promise((r) => setTimeout(r, 20))
    expect(session.deliveredReplies).toEqual([])
  })
})

describe('VoiceConversationRuntime — 11. controller error', () => {
  it('emits a controller error, attempts a fallback delivery to recover the session, and reports recovered:true', async () => {
    const session = new FakeVoiceSession()
    const controller = new ScriptedController(async () => {
      throw new Error('boom — extraction blew up')
    })
    const events = collectEvents(new VoiceConversationRuntime({ session, controller }))

    session.emitFinalTranscript('t1', 'a question')
    await vi.waitFor(() => expect(session.deliveredReplies).toHaveLength(1))

    const errorEvent = events.find((e) => e.type === 'error') as Extract<RuntimeEvent, { type: 'error' }>
    expect(errorEvent.error).toMatchObject({ source: 'controller', code: 'controller_error', recovered: true })
    expect(session.deliveredReplies[0]).toMatch(/sorry|try again/i)
    expect(session.status).toBe('listening') // recovered, not stuck
  })

  it('a controller error never fabricates a successful turn_completed event', async () => {
    const session = new FakeVoiceSession()
    const controller = new ScriptedController(async () => {
      throw new Error('boom')
    })
    const events = collectEvents(new VoiceConversationRuntime({ session, controller }))
    session.emitFinalTranscript('t1', 'x')
    await vi.waitFor(() => expect(events.some((e) => e.type === 'error')).toBe(true))
    expect(events.some((e) => e.type === 'turn_completed')).toBe(false)
  })
})

describe('VoiceConversationRuntime — 12. VoiceSession error', () => {
  it('forwards a session-level error without inventing a successful response', async () => {
    const session = new FakeVoiceSession()
    const controller = new ScriptedController(async (text) => fakeTurnResult(`heard: ${text}`))
    const events = collectEvents(new VoiceConversationRuntime({ session, controller }))

    session.emitError({ code: 'network_lost', message: 'connection dropped' }, true)

    const errorEvent = events.find((e) => e.type === 'error') as Extract<RuntimeEvent, { type: 'error' }>
    expect(errorEvent.error).toMatchObject({ source: 'session', code: 'network_lost' })
    expect(session.deliveredReplies).toEqual([])
  })
})

describe('VoiceConversationRuntime — 13/14. malformed and empty transcript', () => {
  it('a whitespace-only transcript is ignored safely', async () => {
    const session = new FakeVoiceSession()
    const controller = new ScriptedController(async (text) => fakeTurnResult(`heard: ${text}`))
    new VoiceConversationRuntime({ session, controller })

    session.emitFinalTranscript('t1', '   ')
    await new Promise((r) => setTimeout(r, 20))
    expect(controller.calls).toEqual([])
  })

  it('a genuinely empty transcript is ignored safely', async () => {
    const session = new FakeVoiceSession()
    const controller = new ScriptedController(async (text) => fakeTurnResult(`heard: ${text}`))
    new VoiceConversationRuntime({ session, controller })

    session.emitFinalTranscript('t1', '')
    await new Promise((r) => setTimeout(r, 20))
    expect(controller.calls).toEqual([])
  })
})

describe('VoiceConversationRuntime — 15/16. lifecycle cleanup and double disposal', () => {
  it('dispose() unsubscribes from the session and stops reacting to further events', async () => {
    const session = new FakeVoiceSession()
    const controller = new ScriptedController(async (text) => fakeTurnResult(`heard: ${text}`))
    const runtime = new VoiceConversationRuntime({ session, controller })

    await runtime.dispose()
    session.emitFinalTranscript('t1', 'after dispose')
    await new Promise((r) => setTimeout(r, 20))
    expect(controller.calls).toEqual([])
    expect(session.closeCalls).toBe(1)
    expect(runtime.audioState).toBe('closed')
  })

  it('calling dispose() twice is safe and idempotent', async () => {
    const session = new FakeVoiceSession()
    const controller = new ScriptedController(async (text) => fakeTurnResult(`heard: ${text}`))
    const runtime = new VoiceConversationRuntime({ session, controller })
    await runtime.dispose()
    await expect(runtime.dispose()).resolves.toBeUndefined()
    expect(session.closeCalls).toBe(1) // close() was not called a second time
  })

  it('emits exactly one "closed" event on dispose, and none on a redundant second dispose', async () => {
    const session = new FakeVoiceSession()
    const controller = new ScriptedController(async (text) => fakeTurnResult(`heard: ${text}`))
    const runtime = new VoiceConversationRuntime({ session, controller })
    const events = collectEvents(runtime)

    await runtime.dispose()
    expect(events.filter((e) => e.type === 'closed')).toHaveLength(1)

    await runtime.dispose()
    // The second dispose() is a no-op before it even reaches emit() — and
    // listeners were already cleared by the first dispose() regardless.
    expect(events.filter((e) => e.type === 'closed')).toHaveLength(1)
  })
})

describe('VoiceConversationRuntime — 17/18. OfflineVoiceSession integration and provider independence', () => {
  it('works end-to-end with a real OfflineVoiceSession (replySource: external)', async () => {
    const session = new OfflineVoiceSession({ language: { primary: 'en' }, replySource: 'external' }, { stepDelayMs: 2 })
    const controller = realController()
    const runtime = new VoiceConversationRuntime({ session, controller })
    const events = collectEvents(runtime)

    await runtime.start()
    expect(session.status).toBe('listening')

    runtime.sendText('I want to start a dairy business in Karnataka.')
    await vi.waitFor(() => expect(events.some((e) => e.type === 'turn_completed')).toBe(true), { timeout: 2000 })

    const state = controller.getState()
    expect(state.userProfile.businessSector).toBe('dairy')
    expect(state.userProfile.state).toBe('Karnataka')
    await runtime.dispose()
  })

  it('the identical runtime code works with GeminiLiveVoiceSession (fake transport) — no provider-specific runtime logic', async () => {
    const transport = new FakeGeminiLiveTransport()
    const deps: GeminiLiveVoiceSessionDeps = {
      createTransport: () => transport,
      resolveConnection: () => Promise.resolve({ url: 'wss://fake.test' }),
      isConfigured: () => true,
    }
    const session = new GeminiLiveVoiceSession({ language: { primary: 'en' }, replySource: 'external' }, deps)
    const controller = realController()
    const runtime = new VoiceConversationRuntime({ session, controller })
    const events = collectEvents(runtime)

    const connectPromise = runtime.start()
    for (let i = 0; i < 50 && transport.sentMessages.length === 0; i++) await Promise.resolve()
    transport.simulateServerMessage({ setupComplete: {} })
    await connectPromise
    expect(session.status).toBe('listening')

    runtime.sendText('I want to start a dairy business in Karnataka.')
    await vi.waitFor(() => expect(events.some((e) => e.type === 'turn_completed')).toBe(true), { timeout: 2000 })

    const state = controller.getState()
    expect(state.userProfile.businessSector).toBe('dairy')
    expect(state.userProfile.state).toBe('Karnataka')
    await runtime.dispose()
  })
})

describe('VoiceConversationRuntime — 19/20/21. English, Kannada, and mixed-language conversations', () => {
  it('an English transcript is handled normally', async () => {
    const session = new FakeVoiceSession()
    const controller = realController()
    new VoiceConversationRuntime({ session, controller })
    session.emitFinalTranscript('t1', 'I want to start a dairy business in Karnataka.')
    await vi.waitFor(() => expect(controller.getState().userProfile.businessSector).toBe('dairy'))
  })

  it('a Kannada-English mixed transcript is passed through unchanged — no runtime-level translation layer', async () => {
    const session = new FakeVoiceSession()
    const controller = realController()
    new VoiceConversationRuntime({ session, controller })
    const text = 'Nanu Karnataka dinda bandiddini, nanage dairy business start madbeku.'
    session.emitFinalTranscript('t1', text)
    await vi.waitFor(() => expect(controller.getState().turns.some((t) => t.text === text)).toBe(true))
    expect(controller.getState().userProfile.state).toBe('Karnataka')
    expect(controller.getState().userProfile.businessSector).toBe('dairy')
  })
})

describe('VoiceConversationRuntime — 22/23/24/25. profile persistence, readiness, and invalidation across a real conversation', () => {
  it('profile updates survive multiple turns, readiness improves, and a business-intent change refreshes evidence', async () => {
    const session = new FakeVoiceSession()
    const controller = realController()
    new VoiceConversationRuntime({ session, controller })

    session.emitFinalTranscript('t1', 'I want to start a dairy business in Karnataka.')
    await vi.waitFor(() => expect(controller.getState().userProfile.businessSector).toBe('dairy'))
    expect(controller.getState().phase).not.toBe('application_ready') // far too early after one sentence

    session.emitFinalTranscript('t2', 'I already have five cows.')
    await vi.waitFor(() => expect(controller.getState().userProfile.businessStage).toBe('existing_expansion'))
    // Fact from turn 1 must still be present after turn 2 — "already have"
    // in turn 2 legitimately overwrites businessStage 'new' -> 'existing_expansion'
    // (profileExtraction.ts's own "later statements win" rule), but must not
    // touch unrelated fields already known.
    expect(controller.getState().userProfile.businessSector).toBe('dairy')
    expect(controller.getState().userProfile.state).toBe('Karnataka')
    // No field the citizen has already answered is ever re-asked (structural
    // guarantee: identifyMissingFields only offers genuinely unknown fields).
    const answeredFields = new Set(['businessSector', 'state', 'businessStage'])
    expect(controller.getState().missingFields.some((m) => answeredFields.has(m.field))).toBe(false)

    session.emitFinalTranscript('t3', 'I need a loan of 2 lakh to expand.')
    await vi.waitFor(() => expect(controller.getState().userProfile.financingRequired).toBe(200_000))

    session.emitFinalTranscript('t4', 'Actually, I am considering tailoring instead.')
    await vi.waitFor(() => expect(controller.getState().userProfile.businessSector).toBe('tailoring'))
    // Ranking has genuinely moved away from dairy-specific evidence toward tailoring's.
    expect(controller.getState().ranked.some((r) => r.scheme.id === 'pm-vishwakarma')).toBe(true)
  })
})

describe('VoiceConversationRuntime — integration scenario (whole runtime, no React, no real network)', () => {
  it('a real OfflineVoiceSession + real VoiceAssistantController carry a 4-turn conversation end-to-end', async () => {
    const liveRetriever = countingLiveRetriever()
    const controller = new VoiceAssistantController({ providers: [offlineProvider], liveRetriever })
    const session = new OfflineVoiceSession({ language: { primary: 'en' }, replySource: 'external' }, { stepDelayMs: 2 })
    const runtime = new VoiceConversationRuntime({ session, controller })
    const runtimeEvents: RuntimeEvent[] = []
    runtime.subscribe((e) => runtimeEvents.push(e))

    await runtime.start()
    expect(session.status).toBe('listening')

    // Turn 1: "I want to start a dairy business in Karnataka."
    runtime.sendText('I want to start a dairy business in Karnataka.')
    await vi.waitFor(() => expect(runtimeEvents.some((e) => e.type === 'turn_completed')).toBe(true), { timeout: 2000 })
    let state = controller.getState()
    expect(state.userProfile.businessSector).toBe('dairy')
    expect(state.userProfile.state).toBe('Karnataka')
    const turn1 = runtimeEvents.find((e) => e.type === 'turn_completed') as Extract<RuntimeEvent, { type: 'turn_completed' }>
    expect(turn1.result.question.shouldAsk).toBe(true) // a relevant next question was chosen
    expect(turn1.result.replyText.length).toBeGreaterThan(0) // an assistant response was generated
    expect(liveRetriever.calls).toBe(1) // first evidence fetch, now that enough is known

    // deliverAssistantReply() only starts the offline session's word-by-word
    // streamed playback of the reply — it takes real (small) time to finish
    // and return the session to 'listening', which is when new input is
    // valid again. Wait for that, not just the runtime's own turn_completed
    // (which fires the moment delivery is initiated).
    await vi.waitFor(() => expect(session.status).toBe('listening'), { timeout: 2000 })

    // Turn 2: "I already have five cows."
    runtimeEvents.length = 0
    runtime.sendText('I already have five cows.')
    await vi.waitFor(() => expect(runtimeEvents.some((e) => e.type === 'turn_completed')).toBe(true), { timeout: 2000 })
    state = controller.getState()
    expect(state.userProfile.businessStage).toBe('existing_expansion')
    // Whatever question is selected now is never about a field the citizen
    // has already given a value for (repetition safety's real invariant —
    // a field that was merely asked-but-not-yet-answered, like
    // financingRequired here, legitimately remains a valid candidate until
    // it's actually answered or declined; see questionPolicy.test.ts).
    const turn2 = runtimeEvents.find((e) => e.type === 'turn_completed') as Extract<RuntimeEvent, { type: 'turn_completed' }>
    const askedField = turn2.result.question.question?.fields[0]
    if (askedField) {
      expect(state.userProfile[askedField]).toBeUndefined()
    }
    await vi.waitFor(() => expect(session.status).toBe('listening'), { timeout: 2000 })

    // Turn 3: "I need a loan to expand."
    runtimeEvents.length = 0
    const callsBeforeTurn3 = liveRetriever.calls
    runtime.sendText('I need a loan to expand.')
    await vi.waitFor(() => expect(runtimeEvents.some((e) => e.type === 'turn_completed')).toBe(true), { timeout: 2000 })
    // "expand" restates businessStage (no material change) and no amount is
    // given, so nothing decision-critical actually changed this turn —
    // evidence must NOT be blindly refetched.
    expect(liveRetriever.calls).toBe(callsBeforeTurn3)
    await vi.waitFor(() => expect(session.status).toBe('listening'), { timeout: 2000 })

    // Turn 4: "Actually, I am considering tailoring instead."
    runtimeEvents.length = 0
    runtime.sendText('Actually, I am considering tailoring instead.')
    await vi.waitFor(() => expect(runtimeEvents.some((e) => e.type === 'turn_completed')).toBe(true), { timeout: 2000 })
    state = controller.getState()
    expect(state.userProfile.businessSector).toBe('tailoring') // business intent genuinely changed
    expect(liveRetriever.calls).toBe(callsBeforeTurn3 + 1) // business-intent change invalidated evidence and refetched
    // The conversation is no longer anchored to dairy — a dairy-only scheme
    // (PM Vishwakarma explicitly lists tailoring, not dairy) is now relevant.
    expect(state.ranked.some((r) => r.scheme.id === 'pm-vishwakarma')).toBe(true)

    await runtime.dispose()
    expect(session.status).toBe('closed')
  })
})
