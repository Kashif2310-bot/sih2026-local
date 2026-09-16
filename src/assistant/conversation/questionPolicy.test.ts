import { describe, expect, it } from 'vitest'
import { evaluateEligibility } from '../eligibility'
import { SCHEMES } from '../data/schemes'
import { EMPTY_PROFILE, type RankedScheme, type UserProfile } from '../types'
import type { MissingFieldInfo } from '../missingFields'
import {
  isUncertaintyResponse,
  reconcilePendingQuestion,
  selectNextQuestion,
  type QuestionMateriality,
} from './questionPolicy'
import type { AskedQuestionRecord } from './types'

function schemeById(id: string) {
  const s = SCHEMES.find((x) => x.id === id)
  if (!s) throw new Error(`fixture not found: ${id}`)
  return s
}

function rankedFor(id: string, profile: UserProfile, relevance = 50): RankedScheme {
  const scheme = schemeById(id)
  const eligibility = evaluateEligibility(profile, scheme)
  return { scheme, eligibility, relevance, rankScore: relevance }
}

function missing(field: keyof UserProfile, priority: number, question = `question about ${field}?`): MissingFieldInfo {
  return { field, priority, question }
}

describe('selectNextQuestion — base priority', () => {
  it('prefers a lower missingFields.ts priority number when materiality ties', () => {
    const decision = selectNextQuestion({
      userProfile: EMPTY_PROFILE,
      missingFields: [missing('state', 4), missing('annualIncome', 5)],
      ranked: [],
      questionsAsked: [],
    })
    expect(decision.shouldAsk).toBe(true)
    expect(decision.question?.fields).toEqual(['state'])
  })

  it('a high-materiality field outranks a low-materiality one despite a worse raw priority number', () => {
    const decision = selectNextQuestion({
      userProfile: EMPTY_PROFILE,
      missingFields: [missing('existingLoans', 9), missing('financingRequired', 3)],
      ranked: [],
      questionsAsked: [],
    })
    expect(decision.question?.fields).toEqual(['financingRequired'])
    expect(decision.question?.materiality).toBe('high')
  })

  it('returns shouldAsk:false when nothing is missing', () => {
    const decision = selectNextQuestion({ userProfile: EMPTY_PROFILE, missingFields: [], ranked: [], questionsAsked: [] })
    expect(decision.shouldAsk).toBe(false)
    expect(decision.reason).toBeTruthy()
  })

  it('marks a low-materiality field as optional and a high-materiality one as required', () => {
    const low = selectNextQuestion({ userProfile: EMPTY_PROFILE, missingFields: [missing('education', 9)], ranked: [], questionsAsked: [] })
    expect(low.question?.requirement).toBe('optional')
    const high = selectNextQuestion({ userProfile: EMPTY_PROFILE, missingFields: [missing('state', 4)], ranked: [], questionsAsked: [] })
    expect(high.question?.requirement).toBe('required')
  })
})

describe('selectNextQuestion — ranking-evidence bonus', () => {
  it('boosts a field that is blocking one of the current top-ranked, promising schemes', () => {
    const profileMissingState: UserProfile = { businessSector: 'dairy', rawNotes: [] }
    const rankedMissingState = [rankedFor('pmegp', profileMissingState, 80)]
    expect(rankedMissingState[0].eligibility.missingInfo.some((m) => m.includes('state'))).toBe(false) // pmegp has no state restriction — control check

    // Use a scheme whose missingInfo genuinely contains "state" (a state-scoped scheme with no profile.state set is excluded outright by retrieval, but eligibility.ts itself would report it if reached directly)
    const kudumbashree = schemeById('kudumbashree-microenterprise')
    const eligibility = evaluateEligibility(profileMissingState, kudumbashree)
    expect(eligibility.missingInfo.some((m) => m.toLowerCase().includes('state'))).toBe(true)
    const rankedBlockingState: RankedScheme = { scheme: kudumbashree, eligibility, relevance: 60, rankScore: 60 }

    const withoutRankingEvidence = selectNextQuestion({
      userProfile: profileMissingState,
      missingFields: [missing('state', 4), missing('annualIncome', 5)],
      ranked: [],
      questionsAsked: [],
    })
    const withRankingEvidence = selectNextQuestion({
      userProfile: profileMissingState,
      missingFields: [missing('state', 4), missing('annualIncome', 5)],
      ranked: [rankedBlockingState],
      questionsAsked: [],
    })

    // state already wins on base priority alone, but the rationale should
    // reflect the concrete blocking evidence once it's available.
    expect(withoutRankingEvidence.question?.rationale).not.toMatch(/closest-matching/)
    expect(withRankingEvidence.question?.rationale).toMatch(/closest-matching/)
  })
})

describe('selectNextQuestion — sector-aware deterministic phrasing', () => {
  it('phrases the business-stage question around the known sector instead of a generic prompt', () => {
    const decision = selectNextQuestion({
      userProfile: { businessSector: 'dairy', rawNotes: [] },
      missingFields: [missing('businessStage', 2, 'Is this a brand-new business idea, or are you expanding an existing one?')],
      ranked: [],
      questionsAsked: [],
    })
    expect(decision.question?.prompt).toMatch(/dairy/)
    expect(decision.question?.prompt).not.toBe('Is this a brand-new business idea, or are you expanding an existing one?')
  })

  it('falls back to the generic prompt when the sector is unknown', () => {
    const decision = selectNextQuestion({
      userProfile: EMPTY_PROFILE,
      missingFields: [missing('businessStage', 2, 'generic stage question?')],
      ranked: [],
      questionsAsked: [],
    })
    expect(decision.question?.prompt).toBe('generic stage question?')
  })
})

describe('selectNextQuestion — repetition safety', () => {
  function declinedRecord(field: keyof UserProfile, declineCount: number): AskedQuestionRecord {
    return { field, questionId: `q-${field}`, askedAt: new Date().toISOString(), status: 'declined', declineCount }
  }

  it('a high-materiality field declined once is still eligible for one more ask', () => {
    const decision = selectNextQuestion({
      userProfile: EMPTY_PROFILE,
      missingFields: [missing('financingRequired', 3)],
      ranked: [],
      questionsAsked: [declinedRecord('financingRequired', 1)],
    })
    expect(decision.shouldAsk).toBe(true)
  })

  it('a high-materiality field declined twice is never asked again', () => {
    const decision = selectNextQuestion({
      userProfile: EMPTY_PROFILE,
      missingFields: [missing('financingRequired', 3)],
      ranked: [],
      questionsAsked: [declinedRecord('financingRequired', 2)],
    })
    expect(decision.shouldAsk).toBe(false)
  })

  it('a low-materiality field declined even once is never asked again', () => {
    const decision = selectNextQuestion({
      userProfile: EMPTY_PROFILE,
      missingFields: [missing('education', 9)],
      ranked: [],
      questionsAsked: [declinedRecord('education', 1)],
    })
    expect(decision.shouldAsk).toBe(false)
    expect(decision.reason).toMatch(/declined/)
  })

  it('moves on to the next-best candidate once the top one is exhausted', () => {
    const decision = selectNextQuestion({
      userProfile: EMPTY_PROFILE,
      missingFields: [missing('businessSector', 1), missing('state', 4)],
      ranked: [],
      questionsAsked: [declinedRecord('businessSector', 2)],
    })
    expect(decision.question?.fields).toEqual(['state'])
  })

  it('a merely-pending (ignored, not declined) question is still a legitimate candidate again', () => {
    const pending: AskedQuestionRecord = { field: 'state', questionId: 'q-state', askedAt: new Date().toISOString(), status: 'pending', declineCount: 0 }
    const decision = selectNextQuestion({
      userProfile: EMPTY_PROFILE,
      missingFields: [missing('state', 4)],
      ranked: [],
      questionsAsked: [pending],
    })
    expect(decision.shouldAsk).toBe(true)
    expect(decision.question?.fields).toEqual(['state'])
  })
})

describe('isUncertaintyResponse', () => {
  it.each([
    "I don't know",
    'I do not know yet',
    'not sure honestly',
    'not decided yet',
    "haven't decided",
    'no idea really',
    'skip this question please',
  ])('recognizes %j as a decline', (text) => {
    expect(isUncertaintyResponse(text)).toBe(true)
  })

  it.each(['I have 5 lakh', 'I am from Karnataka', 'yes definitely', 'I want a dairy business'])(
    'does not treat %j as a decline',
    (text) => {
      expect(isUncertaintyResponse(text)).toBe(false)
    },
  )
})

describe('reconcilePendingQuestion', () => {
  const record: AskedQuestionRecord = { field: 'state', questionId: 'q-state', askedAt: new Date().toISOString(), status: 'pending', declineCount: 0 }

  it('marks answered when the field was actually filled this turn', () => {
    const result = reconcilePendingQuestion({ pendingField: 'state', previousRecord: record, wasAnsweredThisTurn: true, wasDeclinedThisTurn: false })
    expect(result).toEqual({ status: 'answered', declineCount: 0 })
  })

  it('marks declined and increments the count when the citizen expressed uncertainty', () => {
    const result = reconcilePendingQuestion({ pendingField: 'state', previousRecord: record, wasAnsweredThisTurn: false, wasDeclinedThisTurn: true })
    expect(result).toEqual({ status: 'declined', declineCount: 1 })
  })

  it('returns null (no change) when the citizen neither answered nor declined', () => {
    const result = reconcilePendingQuestion({ pendingField: 'state', previousRecord: record, wasAnsweredThisTurn: false, wasDeclinedThisTurn: false })
    expect(result).toBeNull()
  })

  it('returns null when there was no pending question at all', () => {
    const result = reconcilePendingQuestion({ pendingField: null, previousRecord: undefined, wasAnsweredThisTurn: false, wasDeclinedThisTurn: false })
    expect(result).toBeNull()
  })
})

describe('materiality coverage sanity', () => {
  it('every field missingFields.ts can ask about has a defined materiality classification', () => {
    const trackedFields: Array<keyof UserProfile> = [
      'businessSector',
      'businessStage',
      'financingRequired',
      'state',
      'annualIncome',
      'socialCategory',
      'areaType',
      'age',
      'education',
      'existingLoans',
    ]
    for (const field of trackedFields) {
      const decision = selectNextQuestion({ userProfile: EMPTY_PROFILE, missingFields: [missing(field, 5)], ranked: [], questionsAsked: [] })
      expect(decision.question?.materiality satisfies QuestionMateriality | undefined).toBeDefined()
    }
  })
})
