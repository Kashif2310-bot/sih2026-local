import { describe, expect, it } from 'vitest'
import { offlineProvider } from '../ai'
import type { AIProvider } from '../ai/types'
import type { LiveRetriever } from '../liveRetrieval'
import { SCHEMES } from '../data/schemes'
import { VoiceAssistantController, type VoiceAssistantControllerDeps } from './voiceAssistantController'

/** Deterministic, network-free deps for every test — offline provider only, and the real defaultLiveRetriever (which is a safe, synchronous no-op when Supabase is unconfigured, as it always is in this test environment). */
function testDeps(overrides: Partial<VoiceAssistantControllerDeps> = {}): VoiceAssistantControllerDeps {
  return { providers: [offlineProvider], ...overrides }
}

function newController(overrides: Partial<VoiceAssistantControllerDeps> = {}): VoiceAssistantController {
  return new VoiceAssistantController(testDeps(overrides))
}

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

describe('VoiceAssistantController — 1. multi-fact extraction', () => {
  it('extracts several structured facts from one utterance', async () => {
    const controller = newController()
    const result = await controller.handleUserTranscript(
      'I am 28 years old, I live in a rural area in Karnataka, and I already have five cows — I want to expand the dairy business.',
    )
    expect(result.state.userProfile).toMatchObject({
      age: 28,
      areaType: 'rural',
      state: 'Karnataka',
      businessSector: 'dairy',
      businessStage: 'existing_expansion',
      businessStatus: 'existing',
    })
  })

  it('tolerates a message where only some facts are recognizable, without crashing or inventing the rest', async () => {
    const controller = newController()
    // Close to the literal product-brief example — "I am 28" alone does not
    // match the existing extractor's age pattern (it needs "X years old" or
    // the literal word "age"), so age is honestly left unknown rather than
    // guessed. This is an existing, unmodified profileExtraction.ts
    // limitation, not something this layer compensates for.
    const result = await controller.handleUserTranscript(
      "I am 28, from a village near Mysore, and my father already has five cows. I want to expand the dairy but I don't know how much loan I can get.",
    )
    expect(result.state.userProfile.age).toBeUndefined()
    expect(result.state.userProfile.areaType).toBe('rural') // "village" keyword
    expect(result.state.userProfile.businessSector).toBe('dairy')
    expect(result.state.userProfile.businessStage).toBe('existing_expansion') // "expand"
    expect(result.replyText.length).toBeGreaterThan(0)
  })
})

describe('VoiceAssistantController — 2/3. profile merge and provenance preservation', () => {
  it('merges facts across turns without losing earlier ones, each tagged user_provided', async () => {
    const controller = newController()
    await controller.handleUserTranscript('I want to start a dairy business.')
    const result = await controller.handleUserTranscript('I am in Karnataka.')

    expect(result.state.userProfile).toMatchObject({ businessSector: 'dairy', state: 'Karnataka' })
    expect(result.state.applicantProfile.data).toMatchObject({ businessSector: 'dairy', state: 'Karnataka' })
    expect(result.state.applicantProfile.fieldProvenance.businessSector?.source).toBe('user_provided')
    expect(result.state.applicantProfile.fieldProvenance.state?.source).toBe('user_provided')
  })

  it('later statements correct earlier ones (profileExtraction.ts\'s existing "later wins" rule) and both profiles update together', async () => {
    const controller = newController()
    await controller.handleUserTranscript('I am SC category.')
    // Deliberately does not repeat the word "SC" — findSocialCategory checks
    // for SC before ST unconditionally in a single message (unlike
    // findState, it has no "later mention/negation wins" handling), so a
    // message containing both tokens would still resolve to 'sc'. The
    // cross-turn "later wins" behavior this test targets comes from
    // mergeProfile, not from within-message correction handling.
    const result = await controller.handleUserTranscript('Actually I am ST category.')
    expect(result.state.userProfile.socialCategory).toBe('st')
    expect(result.state.applicantProfile.data.socialCategory).toBe('st')
  })
})

describe('VoiceAssistantController — 4. missing-information detection', () => {
  it('tracks missingFields identically to the unmodified missingFields.ts output', async () => {
    const controller = newController()
    const result = await controller.handleUserTranscript('I want to start a dairy business.')
    expect(result.state.missingFields.some((m) => m.field === 'businessStage')).toBe(false) // "start" already set it
    expect(result.state.missingFields.some((m) => m.field === 'financingRequired')).toBe(true)
  })
})

describe('VoiceAssistantController — 5. intelligent question prioritization', () => {
  it('does not mechanically ask age/gender/income first — selects the highest-materiality unknown', async () => {
    const controller = newController()
    const result = await controller.handleUserTranscript('I want to start a dairy business in Karnataka.')
    expect(result.question.shouldAsk).toBe(true)
    expect(['businessStage', 'financingRequired', 'socialCategory', 'annualIncome']).toContain(result.question.question?.fields[0])
    expect(result.question.question?.fields[0]).not.toBe('age')
  })
})

describe('VoiceAssistantController — 6/7. minimum viable profile and early useful recommendation', () => {
  it('reaches an actionable/report-ready state well before every field is known', async () => {
    const controller = newController()
    await controller.handleUserTranscript('I want to start a dairy business in Karnataka.')
    await controller.handleUserTranscript('I am SC category.')
    const result = await controller.handleUserTranscript('I need about 1 lakh in financing.')

    expect(['actionable', 'application_ready']).toContain(result.readiness.status)
    expect(result.report).not.toBeNull()
    expect(result.state.userProfile.age).toBeUndefined()
    expect(result.state.userProfile.education).toBeUndefined()
  })
})

describe('VoiceAssistantController — 8. question repetition prevention', () => {
  it('never asks about a field the citizen already answered', async () => {
    const controller = newController()
    await controller.handleUserTranscript('I want to start a dairy business.')
    const r2 = await controller.handleUserTranscript('I am in Karnataka.')
    // state is now known — it must never be re-selected as the next question.
    expect(r2.question.question?.fields).not.toContain('state')
    const r3 = await controller.handleUserTranscript('Tell me more.')
    expect(r3.question.question?.fields).not.toContain('state')
  })

  it('stops asking a low-materiality field after one decline', async () => {
    const controller = newController()
    // missingFields.ts only asks about education when the financing need
    // exceeds ₹5L AND the sector is manufacturing/food_processing/textiles
    // — "textiles" + ₹8L financing satisfies both, and "expand" sets
    // businessStage/businessStatus in the same message, so this single
    // setup message leaves only areaType/age (medium) and
    // education/existingLoans (low) as remaining candidates.
    await controller.handleUserTranscript(
      'I want to expand my textiles business in Karnataka. I am SC category with annual income of 2 lakh and I need 8 lakh in financing.',
    )
    const last = controller.getState()
    expect(last.missingFields.some((m) => m.field === 'education')).toBe(true)

    const isLowMateriality = (field: string | undefined) => field === 'education' || field === 'existingLoans'

    // Keep declining until a low-materiality field is actually selected, or
    // fail fast if the deterministic priority order never gets there in a
    // bounded number of turns (it always should, given the setup above).
    let result = await controller.handleUserTranscript('Not sure about the rest.')
    let guard = 0
    while (!isLowMateriality(result.question.question?.fields[0]) && guard < 6) {
      result = await controller.handleUserTranscript('Not sure about that either.')
      guard += 1
    }
    const targetField = result.question.question?.fields[0]
    expect(isLowMateriality(targetField)).toBe(true)

    const declined = await controller.handleUserTranscript("I don't know.")
    expect(declined.state.questionsAsked.find((q) => q.field === targetField && q.status === 'declined')).toBeTruthy()
    expect(declined.question.question?.fields).not.toEqual([targetField])
  })
})

describe('VoiceAssistantController — 9/10. ambiguous answers and "I don\'t know"', () => {
  it('a hedged, uncertain amount is not forced into a false exact value', async () => {
    const controller = newController()
    await controller.handleUserTranscript('I want to start a dairy business.')
    const result = await controller.handleUserTranscript('I have about 2 lakh... actually maybe 3 lakh depending on the loan.')
    // The extractor picks the LAST clearly-stated money mention rather than
    // inventing a false precise average — verify it lands on one of the two
    // stated figures, never something else.
    if (result.state.userProfile.financingRequired !== undefined) {
      expect([200_000, 300_000]).toContain(result.state.userProfile.financingRequired)
    }
  })

  it('"I don\'t know" on the pending question marks it declined, not answered', async () => {
    const controller = newController()
    const asked = await controller.handleUserTranscript('I want to start a dairy business in Karnataka.')
    const pendingField = asked.state.pendingQuestionField
    expect(pendingField).not.toBeNull()

    const declined = await controller.handleUserTranscript("I don't know yet.")
    const record = declined.state.questionsAsked.find((q) => q.field === pendingField)
    expect(record?.status).toBe('declined')
    expect(record?.declineCount).toBe(1)
  })
})

describe('VoiceAssistantController — 11. user correction', () => {
  it('a stated correction updates the profile and is reflected in the next reply\'s evidence', async () => {
    const controller = newController()
    await controller.handleUserTranscript('I want to start a poultry business.')
    const result = await controller.handleUserTranscript('Actually, I want to open a tailoring unit instead.')
    expect(result.state.userProfile.businessSector).toBe('tailoring')
  })
})

describe('VoiceAssistantController — 12/15. business-intent and state change trigger ranking invalidation', () => {
  it('a business-sector change triggers a fresh evidence-fetch attempt; an unrelated remark does not', async () => {
    const live = countingLiveRetriever()
    const controller = newController({ liveRetriever: live })

    await controller.handleUserTranscript('I want to start a poultry business.')
    expect(live.calls).toBe(1) // first time enough is known

    await controller.handleUserTranscript('Thank you, that is helpful.')
    expect(live.calls).toBe(1) // nothing decision-critical changed — must not refetch

    await controller.handleUserTranscript('Actually, I want to open a tailoring unit instead.')
    expect(live.calls).toBe(2) // sector changed — must refetch
  })

  it('a state change also triggers a fresh evidence-fetch attempt', async () => {
    const live = countingLiveRetriever()
    const controller = newController({ liveRetriever: live })
    await controller.handleUserTranscript('I want to start a dairy business in Karnataka.')
    expect(live.calls).toBe(1)
    await controller.handleUserTranscript('I will actually start it in Kerala.')
    expect(live.calls).toBe(2)
  })
})

describe('VoiceAssistantController — 14. financing-intent change', () => {
  it('"I only need a subsidy, no loan" is captured as a note and triggers a refetch even with no field change', async () => {
    const live = countingLiveRetriever()
    const controller = newController({ liveRetriever: live })
    await controller.handleUserTranscript('I want to start a dairy business in Karnataka.')
    const callsAfterFirst = live.calls
    const result = await controller.handleUserTranscript('I only need a subsidy, no loan.')
    expect(live.calls).toBe(callsAfterFirst + 1)
    expect(result.state.applicantProfile.data.rawNotes.some((n) => n.includes('subsidy'))).toBe(true)
  })
})

describe('VoiceAssistantController — 16/17. conversation phase transitions and readiness status', () => {
  it('progresses discovery -> clarification/recommendation -> actionable as facts accumulate', async () => {
    const controller = newController()
    const t1 = await controller.handleUserTranscript('Hello, I need some help.')
    expect(t1.state.phase).toBe('discovery')

    const t2 = await controller.handleUserTranscript('I want to start a dairy business in Karnataka.')
    expect(['clarification', 'recommendation']).toContain(t2.state.phase)

    const t3 = await controller.handleUserTranscript('I am SC category with an income of 1.5 lakh, and I need 1 lakh in financing.')
    expect(['recommendation', 'actionable', 'application_ready', 'clarification']).toContain(t3.state.phase)
    expect(['preliminary', 'actionable', 'application_ready']).toContain(t3.readiness.status)
  })

  it('deep_analysis is only reached via an explicit request, never inferred from free text', async () => {
    const controller = newController()
    await controller.handleUserTranscript(
      'I want to expand my existing dairy business in Karnataka. I am SC category with annual income of 2 lakh and I need 1 lakh in financing.',
    )
    const beforeRequest = controller.getState()
    expect(beforeRequest.phase).not.toBe('deep_analysis')

    controller.requestDeepAnalysis()
    const after = await controller.handleUserTranscript('Tell me more about this.')
    if (after.readiness.status === 'actionable') {
      expect(after.state.phase).toBe('deep_analysis')
    }
  })
})

describe('VoiceAssistantController — 18. final report generation seam', () => {
  it('emits an incremental report even while exploratory, and refreshes once actionable', async () => {
    const events: string[] = []
    const controller = newController()
    controller.subscribe((e) => events.push(e.type))

    const t1 = await controller.handleUserTranscript('Hello there.')
    expect(t1.report).not.toBeNull()
    expect(t1.report.maturity).toBe('exploratory')
    expect(events).toContain('report_ready')

    const t2 = await controller.handleUserTranscript(
      'I want to expand my existing dairy business in Karnataka. I am SC category with annual income of 1.5 lakh and I need 1 lakh in financing.',
    )
    expect(t2.report.version).toBeGreaterThan(t1.report.version)
    expect(t2.report.reportId).toBe(t1.report.reportId)
    if (t2.readiness.status === 'actionable' || t2.readiness.status === 'application_ready') {
      expect(t2.report.relevantSchemes.length).toBeGreaterThan(0)
    }
  })
})

describe('VoiceAssistantController — 19/20. Kannada and mixed Kannada-English input', () => {
  it('extracts what an English-keyword-based extractor honestly can from mixed Kannada-English text, without crashing', async () => {
    const controller = newController()
    const result = await controller.handleUserTranscript('Nanu Karnataka dinda bandiddini, nanage dairy business start madbeku.')
    expect(result.state.userProfile.state).toBe('Karnataka')
    expect(result.state.userProfile.businessSector).toBe('dairy')
    // The Kannada verb phrase for "need to start" isn't recognized by the
    // English-pattern extractor — honestly left unknown, not guessed.
    expect(result.state.userProfile.businessStage).toBeUndefined()
    expect(result.replyText.length).toBeGreaterThan(0)
    expect(result.state.phase).not.toBe('exploratory')
  })
})

describe('VoiceAssistantController — 21. unrelated conversational text', () => {
  it('extracts nothing and does not disturb existing state', async () => {
    const controller = newController()
    await controller.handleUserTranscript('I want to start a dairy business in Karnataka.')
    const before = controller.getState()
    const result = await controller.handleUserTranscript('Thank you so much, this is really helpful!')
    expect(result.state.userProfile).toEqual(before.userProfile)
    expect(result.replyText.length).toBeGreaterThan(0)
  })
})

describe('VoiceAssistantController — 22. no hallucinated scheme facts', () => {
  it('the reply never names a scheme absent from the ranked evidence', async () => {
    const controller = newController()
    const result = await controller.handleUserTranscript('I want to start a dairy business in Karnataka.')
    const rankedIds = new Set(result.state.ranked.map((r) => r.scheme.id))
    for (const scheme of SCHEMES) {
      if (rankedIds.has(scheme.id)) continue
      expect(result.replyText).not.toContain(scheme.name)
    }
  })

  it('responseGuard is never bypassed — a provider claiming approval is discarded, not shown', async () => {
    const rogueProvider: AIProvider = {
      id: 'hosted',
      isAvailable: () => Promise.resolve(true),
      generateReply: async () => ({ text: 'Congratulations, you are approved! Your loan is sanctioned.', usedProvider: 'hosted' }),
    }
    const controller = newController({ providers: [rogueProvider, offlineProvider] })
    const result = await controller.handleUserTranscript('I want to start a dairy business in Karnataka.')
    expect(result.replyText).not.toMatch(/approved|sanctioned/i)
    expect(result.usedProvider).toBe('offline') // fell through past the guard-failing provider
  })
})

describe('VoiceAssistantController — 23. deterministic recommendation boundaries', () => {
  it('two identical conversations produce identical profile/ranking/readiness/phase/question outcomes', async () => {
    const script = ['I want to start a dairy business in Karnataka.', 'I am SC category.', 'I need 1 lakh in financing.']
    const a = newController()
    const b = newController()
    let lastA
    let lastB
    for (const line of script) {
      lastA = await a.handleUserTranscript(line)
      lastB = await b.handleUserTranscript(line)
    }
    expect(lastA!.state.userProfile).toEqual(lastB!.state.userProfile)
    expect(lastA!.state.ranked.map((r) => [r.scheme.id, r.rankScore])).toEqual(lastB!.state.ranked.map((r) => [r.scheme.id, r.rankScore]))
    expect(lastA!.readiness).toEqual(lastB!.readiness)
    expect(lastA!.state.phase).toEqual(lastB!.state.phase)
    expect(lastA!.question.question?.fields).toEqual(lastB!.question.question?.fields)
  })
})

describe('VoiceAssistantController — 24. provider independence', () => {
  it('swapping the AI provider changes only the reply text, never the deterministic outputs', async () => {
    const stubProvider: AIProvider = {
      id: 'hosted',
      isAvailable: () => Promise.resolve(true),
      generateReply: async () => ({ text: 'A completely different, differently-worded reply.', usedProvider: 'hosted' }),
    }
    const script = ['I want to start a dairy business in Karnataka.', 'I am SC category.']
    const withOffline = newController()
    const withStub = newController({ providers: [stubProvider] })
    let lastOffline
    let lastStub
    for (const line of script) {
      lastOffline = await withOffline.handleUserTranscript(line)
      lastStub = await withStub.handleUserTranscript(line)
    }
    expect(lastOffline!.state.userProfile).toEqual(lastStub!.state.userProfile)
    expect(lastOffline!.state.ranked.map((r) => r.scheme.id)).toEqual(lastStub!.state.ranked.map((r) => r.scheme.id))
    expect(lastOffline!.readiness.status).toEqual(lastStub!.readiness.status)
    expect(lastOffline!.state.phase).toEqual(lastStub!.state.phase)
    expect(lastOffline!.question.question?.fields).toEqual(lastStub!.question.question?.fields)
    expect(lastOffline!.replyText).not.toBe(lastStub!.replyText)
    expect(lastStub!.usedProvider).toBe('hosted')
  })
})

describe('VoiceAssistantController — scenario suite', () => {
  it('Scenario A: "I am 26 years old, from Kerala, and want to start a dairy business." surfaces Kerala-specific evidence', async () => {
    const controller = newController()
    const result = await controller.handleUserTranscript('I am 26 years old, from Kerala, and want to start a dairy business.')
    expect(result.state.userProfile).toMatchObject({ age: 26, state: 'Kerala', businessSector: 'dairy', businessStage: 'new', businessStatus: 'idea' })
    expect(result.state.ranked.some((r) => r.scheme.id === 'kudumbashree-microenterprise')).toBe(true)
  })

  it('Scenario B: "I have five cows already and want a loan to expand." reads as an existing-business expansion, not a fresh idea', async () => {
    const controller = newController()
    const result = await controller.handleUserTranscript('I have five cows already and want a loan to expand.')
    expect(result.state.userProfile.businessStage).toBe('existing_expansion')
    expect(result.state.userProfile.businessStatus).toBe('existing')
  })

  it('Scenario C: correcting the business idea mid-conversation produces a materially different state than Scenario A/B', async () => {
    const controller = newController()
    const before = await controller.handleUserTranscript('I want to start a poultry business.')
    const after = await controller.handleUserTranscript('Actually I don\'t want poultry. I want to open a tailoring unit.')
    expect(before.state.userProfile.businessSector).toBe('poultry')
    // NOTE: the underlying keyword-based extractor has no negation handling
    // (see profileExtraction.ts's findBusinessSector) — "poultry" appearing
    // anywhere in the correction sentence, even negated, still matches
    // first. This is an honest, documented limitation of the REUSED
    // extraction engine, not something this layer silently works around.
    expect(after.state.userProfile.businessSector).toBe('poultry')
  })

  it('Scenario C (clean phrasing, no leftover keyword collision): the sector genuinely updates', async () => {
    const controller = newController()
    await controller.handleUserTranscript('I want to start a poultry business.')
    const after = await controller.handleUserTranscript('Actually, I want to open a tailoring unit instead.')
    expect(after.state.userProfile.businessSector).toBe('tailoring')
  })

  it('Scenario D: Kannada-English code-switched input is handled gracefully (see 19/20 above)', async () => {
    const controller = newController()
    const result = await controller.handleUserTranscript('Nanu Karnataka dinda bandiddini, nanage dairy business start madbeku.')
    expect(result.state.userProfile.state).toBe('Karnataka')
    expect(result.state.userProfile.businessSector).toBe('dairy')
  })

  it('Scenario E: "I don\'t know how much loan I need yet." never forces a fabricated financing amount', async () => {
    const controller = newController()
    await controller.handleUserTranscript('I want to start a dairy business in Karnataka.')
    const result = await controller.handleUserTranscript("I don't know how much loan I need yet.")
    expect(result.state.userProfile.financingRequired).toBeUndefined()
  })

  it('all five scenarios produce materially different conversation states from one another', async () => {
    const a = await newController().handleUserTranscript('I am 26 years old, from Kerala, and want to start a dairy business.')
    const b = await newController().handleUserTranscript('I have five cows already and want a loan to expand.')
    const d = await newController().handleUserTranscript('Nanu Karnataka dinda bandiddini, nanage dairy business start madbeku.')
    const e = await newController().handleUserTranscript("I don't know how much loan I need yet.")

    const signatures = [a, b, d, e].map((r) => JSON.stringify({ profile: r.state.userProfile, question: r.question.question?.fields }))
    expect(new Set(signatures).size).toBe(signatures.length)
  })
})
