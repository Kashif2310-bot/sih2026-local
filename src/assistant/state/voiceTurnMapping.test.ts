import { describe, expect, it, vi } from 'vitest'
import { OfflineVoiceSession } from '../voice/offlineVoiceSession'
import { VoiceAssistantController } from '../conversation/voiceAssistantController'
import { VoiceConversationRuntime, type RuntimeEvent } from '../conversation/voiceConversationRuntime'
import { offlineProvider } from '../ai'
import type { LiveRetriever } from '../liveRetrieval'
import { canInterruptVoice, mapVoiceTurnResult } from './voiceTurnMapping'

/** A real, network-free LiveRetriever that actually reports "available" and returns a validated (empty) response — exercises the genuine Prompt 8 evidence path (coverage gets built for real) without any real network call. */
function fakeConfiguredLiveRetriever(): LiveRetriever {
  return {
    isAvailable: () => Promise.resolve(true),
    retrieve: () => Promise.resolve([]),
  }
}

function collectEvents(runtime: VoiceConversationRuntime): RuntimeEvent[] {
  const events: RuntimeEvent[] = []
  runtime.subscribe((e) => events.push(e))
  return events
}

/**
 * These tests exercise the REAL voice engine this app now wires into the
 * UI (VoiceAssistantController + VoiceConversationRuntime + a real
 * VoiceSession, replySource: 'external' — the exact configuration
 * AssistantContext.tsx uses for a genuinely configured provider) end to
 * end, using OfflineVoiceSession as the always-available, network-free
 * VoiceSession implementation (see voiceConversationRuntime.test.ts's own
 * "OfflineVoiceSession integration" tests for the precedent this follows).
 * Gemini itself is never touched — this proves the WIRING/mapping is
 * correct regardless of which real provider eventually supplies the audio.
 */
describe('mapVoiceTurnResult — voice engine wiring into AssistantState', () => {
  it('maps a real completed voice turn onto exactly the fields the text pipeline also writes, including Prompt 8 evidence coverage and the personalized report', async () => {
    const session = new OfflineVoiceSession({ language: { primary: 'en' }, replySource: 'external' }, { stepDelayMs: 2 })
    const controller = new VoiceAssistantController({ providers: [offlineProvider], liveRetriever: fakeConfiguredLiveRetriever() })
    const runtime = new VoiceConversationRuntime({ session, controller })
    const events = collectEvents(runtime)

    await runtime.start()
    runtime.sendText('I want to start a poultry business in Karnataka, SC category, income 2 lakh.')
    await vi.waitFor(() => expect(events.some((e) => e.type === 'turn_completed')).toBe(true), { timeout: 2000 })

    const completed = events.find((e) => e.type === 'turn_completed')
    if (completed?.type !== 'turn_completed') throw new Error('expected a turn_completed event')

    let idCounter = 0
    const mapped = mapVoiceTurnResult(completed.result, () => `id-${(idCounter += 1)}`, () => 1_700_000_000_000)

    // Same UserProfile/ApplicantProfile facts the controller itself extracted.
    expect(mapped.profile.businessSector).toBe('poultry')
    expect(mapped.profile.state).toBe('Karnataka')
    expect(mapped.applicantProfile.data.businessSector).toBe('poultry')

    // Real evidence-layer output reached the mapped fields — never silently dropped.
    expect(mapped.evidenceCoverage).not.toBeNull()
    expect(mapped.evidenceCoverage?.claimsAllGovernmentSchemesChecked).toBe(false)
    expect(Array.isArray(mapped.contextualEvidence)).toBe(true)

    // A real PersonalizedReport, not a second/simplified analysis model.
    expect(mapped.report.reportId).toBeTruthy()
    expect(mapped.actionPlan).toBe(mapped.report.recommendedNextSteps)

    // Exactly one user + one assistant chat bubble, both flagged as voice-originated.
    expect(mapped.newMessages).toHaveLength(2)
    expect(mapped.newMessages[0].role).toBe('user')
    expect(mapped.newMessages[0].fromVoice).toBe(true)
    expect(mapped.newMessages[1].role).toBe('assistant')
    expect(mapped.newMessages[1].fromVoice).toBe(true)

    await runtime.dispose()
  })

  it('never fabricates a user chat bubble when the controller state has no matching prior turn', () => {
    let idCounter = 0
    const genId = () => `id-${(idCounter += 1)}`
    const fakeResult = {
      state: {
        userProfile: { rawNotes: [] },
        applicantProfile: { data: { rawNotes: [] }, fieldProvenance: {}, updatedAt: '2026-01-01T00:00:00.000Z' },
        phase: 'discovery' as const,
        turns: [], // deliberately empty — no user turn to find
        missingFields: [],
        questionsAsked: [],
        pendingQuestionField: null,
        ranked: [],
        sourceStatus: null,
        lastEvidenceFetchSnapshot: null,
        deepAnalysisRequested: false,
      },
      question: { shouldAsk: false as const, reason: 'test' },
      readiness: { status: 'exploratory' as const, rationale: [], materialGapsRemaining: [] },
      report: {
        reportId: 'r1',
        version: 1,
        generatedAt: '2026-01-01T00:00:00.000Z',
        maturity: 'exploratory' as const,
        executiveSummary: {
          financingIntention: 'undetermined' as const,
          keyStrengths: [],
          majorBlockers: [],
          overallReadiness: 'exploratory' as const,
        },
        citizenSnapshot: {},
        businessIdea: {},
        businessContext: {},
        businessSnapshot: { expansionOrNew: 'unknown' as const },
        opportunityAssessment: {
          dimensions: [],
          businessSuitability: {
            kind: 'information_insufficient' as const,
            rationale: '',
            claimsProfitability: false as const,
            claimsGuaranteedDemand: false as const,
            claimsGuaranteedApproval: false as const,
            claimsGuaranteedSubsidy: false as const,
          },
        },
        relevantSchemes: [],
        comparativeView: [],
        governmentContextualEvidence: [],
        financialPath: { status: 'not_determined' as const, notes: [] },
        documentReadiness: [],
        documentsNeeded: [],
        applicationReadiness: { status: 'not_ready' as const, dimensions: [], applicationSubmitted: false as const },
        recommendedNextSteps: [],
        risksAndUncertainties: [],
        uncertainties: [],
        sourceCoverage: {
          sourcesQueried: [],
          sourcesSuccessfullyRetrieved: [],
          sourcesUnavailable: [],
          candidateSchemeCount: 0,
          eligibleOrPossibleCount: 0,
          verifiedLocalCount: 0,
          liveOfficialCount: 0,
          totalSchemesConsidered: 0,
          verificationTimestamps: [],
          claimsAllGovernmentSchemesChecked: false as const,
          contextualEvidenceCount: 0,
          recordsRetrieved: 0,
          recordsRejected: 0,
          recordsDeduplicated: 0,
          sourcesFailedCount: 0,
          sourcesNotConfiguredCount: 0,
          centralSourcesQueried: 0,
          stateSourcesQueried: 0,
        },
        verification: { checkedAt: null, sourceStatus: null },
        readiness: { status: 'exploratory' as const, rationale: [], materialGapsRemaining: [] },
      },
      replyText: 'Hello',
      isFallback: true,
      usedProvider: 'offline' as const,
      contextualEvidence: [],
      evidenceCoverage: null,
    }

    const mapped = mapVoiceTurnResult(fakeResult, genId)
    expect(mapped.newMessages).toHaveLength(1)
    expect(mapped.newMessages[0].role).toBe('assistant')
  })
})

describe('canInterruptVoice — barge-in is only offered while the assistant is speaking or thinking', () => {
  it('is true only for an active session in speaking or processing', () => {
    expect(canInterruptVoice(true, 'speaking')).toBe(true)
    expect(canInterruptVoice(true, 'processing')).toBe(true)
    expect(canInterruptVoice(true, 'listening')).toBe(false)
    expect(canInterruptVoice(true, 'idle')).toBe(false)
    expect(canInterruptVoice(false, 'speaking')).toBe(false)
  })
})
