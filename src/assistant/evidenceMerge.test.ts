import { describe, expect, it } from 'vitest'
import { evaluateEligibility } from './eligibility'
import { LIVE_EVIDENCE_RELEVANCE_BONUS, mergeLiveEvidence } from './evidenceMerge'
import { SCHEMES } from './data/schemes'
import { EMPTY_PROFILE, type LiveEvidenceItem, type RankedScheme } from './types'

function schemeById(id: string) {
  const s = SCHEMES.find((x) => x.id === id)
  if (!s) throw new Error(`fixture not found: ${id}`)
  return s
}

function rankedFor(id: string, relevance: number): RankedScheme {
  const scheme = schemeById(id)
  return { scheme, eligibility: evaluateEligibility(EMPTY_PROFILE, scheme), relevance, rankScore: relevance }
}

function evidenceFor(schemeId: string, overrides: Partial<LiveEvidenceItem> = {}): LiveEvidenceItem {
  return {
    schemeId,
    sourceName: 'data.gov.in (Open Government Data Platform)',
    sourceUrl: 'https://api.data.gov.in/resource/abc123',
    sourceType: 'official_open_data',
    verificationStatus: 'live_official',
    retrievedAt: new Date().toISOString(),
    summary: '1,204 units sanctioned in Karnataka in FY2023-24.',
    ...overrides,
  }
}

describe('mergeLiveEvidence', () => {
  it('returns the ranked list unchanged when there is no live evidence', () => {
    const ranked = [rankedFor('pmegp', 50)]
    expect(mergeLiveEvidence(ranked, [])).toEqual(ranked)
  })

  it('attaches evidence only to the matching scheme, leaving others untouched', () => {
    const ranked = [rankedFor('pmegp', 50), rankedFor('pm-mudra-yojana', 40)]
    const merged = mergeLiveEvidence(ranked, [evidenceFor('pmegp')])
    const pmegp = merged.find((r) => r.scheme.id === 'pmegp')!
    const mudra = merged.find((r) => r.scheme.id === 'pm-mudra-yojana')!
    expect(pmegp.liveEvidence).toHaveLength(1)
    expect(mudra.liveEvidence).toBeUndefined()
  })

  it('boosts relevance and rankScore by the documented bonus, capped at 100', () => {
    const ranked = [rankedFor('pmegp', 50)]
    const merged = mergeLiveEvidence(ranked, [evidenceFor('pmegp')])
    expect(merged[0].relevance).toBe(50 + LIVE_EVIDENCE_RELEVANCE_BONUS)
    expect(merged[0].rankScore).toBe(50 + LIVE_EVIDENCE_RELEVANCE_BONUS)

    const nearCap = [rankedFor('pmegp', 98)]
    const mergedCap = mergeLiveEvidence(nearCap, [evidenceFor('pmegp')])
    expect(mergedCap[0].relevance).toBe(100)
    expect(mergedCap[0].rankScore).toBe(100)
  })

  it('collects multiple evidence items for the same scheme', () => {
    const ranked = [rankedFor('pmegp', 50)]
    const merged = mergeLiveEvidence(ranked, [
      evidenceFor('pmegp', { summary: 'fact one' }),
      evidenceFor('pmegp', { summary: 'fact two' }),
    ])
    expect(merged[0].liveEvidence).toHaveLength(2)
  })

  it('BUG-REGRESSION: never lets a relevance/rankScore boost push an ineligible scheme above an eligible one (status tier must still dominate)', () => {
    const eligibleNoEvidence = rankedFor('pmegp', 40)
    eligibleNoEvidence.eligibility = { ...eligibleNoEvidence.eligibility, status: 'likely_eligible', score: 40 }
    eligibleNoEvidence.rankScore = 40

    const ineligibleWithBigRelevance = rankedFor('pm-mudra-yojana', 95)
    ineligibleWithBigRelevance.eligibility = { ...ineligibleWithBigRelevance.eligibility, status: 'likely_ineligible', score: 95 }
    ineligibleWithBigRelevance.rankScore = 95

    const merged = mergeLiveEvidence([eligibleNoEvidence, ineligibleWithBigRelevance], [
      evidenceFor('pm-mudra-yojana'),
    ])

    // Even boosted to 100, the ineligible scheme must still sort below the eligible one.
    expect(merged[0].scheme.id).toBe('pmegp')
    expect(merged[1].scheme.id).toBe('pm-mudra-yojana')
    expect(merged[1].rankScore).toBe(100)
  })

  it('does not mutate the input array or its entries', () => {
    const original = [rankedFor('pmegp', 50)]
    const originalCopy = JSON.parse(JSON.stringify(original))
    mergeLiveEvidence(original, [evidenceFor('pmegp')])
    expect(JSON.parse(JSON.stringify(original))).toEqual(originalCopy)
  })

  it('ignores evidence for a scheme id that is not in the ranked list', () => {
    const ranked = [rankedFor('pmegp', 50)]
    const merged = mergeLiveEvidence(ranked, [evidenceFor('kudumbashree-microenterprise')])
    expect(merged[0].liveEvidence).toBeUndefined()
    expect(merged[0].relevance).toBe(50)
  })
})
