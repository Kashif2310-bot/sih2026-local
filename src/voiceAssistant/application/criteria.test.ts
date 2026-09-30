import { describe, expect, it } from 'vitest'
import { SCHEMES } from '../../assistant/data/schemes'
import { evaluateEligibility } from '../../assistant/eligibility'
import type { UserProfile } from '../../assistant/types'
import { buildCriteriaReport } from './criteria'

const PROFILES: UserProfile[] = [
  { rawNotes: [] },
  { rawNotes: [], state: 'Karnataka', age: 32, gender: 'female', socialCategory: 'sc', annualIncome: 180_000, businessSector: 'dairy', businessStage: 'new', financingRequired: 500_000 },
  { rawNotes: [], state: 'Kerala', areaType: 'rural', age: 26, gender: 'female', socialCategory: 'general', annualIncome: 250_000, businessSector: 'tailoring', businessStage: 'new' },
  { rawNotes: [], state: 'Karnataka', areaType: 'urban', age: 17, gender: 'male', socialCategory: 'obc', annualIncome: 900_000, businessSector: 'trading', businessStage: 'existing_expansion', financingRequired: 50_000_000 },
  { rawNotes: [], state: 'Tamil Nadu', age: 70, gender: 'male', socialCategory: 'general', businessSector: 'carpentry', financingRequired: 5_000 },
  { rawNotes: [], gender: 'male', socialCategory: 'st', businessSector: 'poultry', investmentRequired: 400_000, ownContribution: 40_000 },
  { rawNotes: [], age: 45, annualIncome: 100_000, businessSector: 'handicraft', businessStage: 'idea' },
]

/** The engine's soft mismatches: they lower the score but never rule the applicant out. */
const SOFT_REASON = /may still qualify|loan ceiling|minimum loan size/

describe('government criteria report', () => {
  it('agrees with the main eligibility engine for every scheme and profile', () => {
    for (const scheme of SCHEMES) {
      for (const profile of PROFILES) {
        const report = buildCriteriaReport(profile, scheme)
        const result = evaluateEligibility(profile, scheme)
        const label = `${scheme.id} / ${JSON.stringify(profile)}`
        expect(report.counts.not_met + report.counts.needs_verification, label).toBe(result.mismatchReasons.length)
        expect(report.counts.needs_information, label).toBe(result.missingInfo.length)
        const hardReasons = result.mismatchReasons.filter((r) => !SOFT_REASON.test(r))
        expect(report.counts.not_met, label).toBe(hardReasons.length)
        if (report.counts.not_met > 0) expect(result.status, label).toBe('likely_ineligible')
        expect(report.eligibility).toEqual({ status: result.status, score: result.score, confidence: result.confidence })
      }
    }
  })

  it('carries only curated scheme facts: documents, source and verification date', () => {
    const scheme = SCHEMES.find((s) => s.id === 'pm-mudra-yojana')!
    const report = buildCriteriaReport(PROFILES[1], scheme)
    expect(report.documentsListed).toEqual(scheme.documents)
    expect(report.source).toMatchObject({ name: scheme.source, url: scheme.sourceUrl, lastVerifiedDate: scheme.lastVerifiedDate })
    expect(report.source.dataStatus).toMatch(/not a live government feed/)
  })

  it('a state scheme outside its state is not met', () => {
    const kudumbashree = SCHEMES.find((s) => s.id === 'kudumbashree-microenterprise')!
    const row = buildCriteriaReport(PROFILES[1], kudumbashree).criteria.find((c) => c.id === 'state')
    expect(row?.status).toBe('not_met')
  })

  it('an unlisted sector is a soft mismatch the agency verifies; an excluded one is not met', () => {
    const vishwakarma = SCHEMES.find((s) => s.id === 'pm-vishwakarma')!
    const sector = (profile: UserProfile, id: string) => buildCriteriaReport(profile, SCHEMES.find((s) => s.id === id)!).criteria.find((c) => c.id === 'sector')
    expect(sector({ rawNotes: [], businessSector: 'dairy' }, vishwakarma.id)?.status).toBe('needs_verification')
    expect(sector({ rawNotes: [], businessSector: 'carpentry' }, vishwakarma.id)?.status).toBe('satisfied')
    expect(sector({ rawNotes: [], businessSector: 'poultry' }, 'pmegp')?.status).toBe('not_met')
  })
})
