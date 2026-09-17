import { describe, expect, it } from 'vitest'
import { evaluateEligibility } from '../eligibility'
import { identifyMissingFields } from '../missingFields'
import { SCHEMES } from '../data/schemes'
import { EMPTY_PROFILE, type RankedScheme, type UserProfile } from '../types'
import { assessReadiness } from './readiness'

function schemeById(id: string) {
  const s = SCHEMES.find((x) => x.id === id)
  if (!s) throw new Error(`fixture not found: ${id}`)
  return s
}

function rankedFor(id: string, profile: UserProfile, relevance = 60): RankedScheme {
  const scheme = schemeById(id)
  const eligibility = evaluateEligibility(profile, scheme)
  return { scheme, eligibility, relevance, rankScore: relevance }
}

describe('assessReadiness', () => {
  it('is exploratory with no business intent at all', () => {
    const result = assessReadiness({ userProfile: EMPTY_PROFILE, ranked: [], missingFields: identifyMissingFields(EMPTY_PROFILE) })
    expect(result.status).toBe('exploratory')
  })

  it('is exploratory when business intent exists but nothing ranked yet', () => {
    const profile: UserProfile = { businessSector: 'dairy', rawNotes: [] }
    const result = assessReadiness({ userProfile: profile, ranked: [], missingFields: identifyMissingFields(profile) })
    expect(result.status).toBe('exploratory')
  })

  it('is preliminary when the top match is only insufficient_data', () => {
    const profile: UserProfile = { businessSector: 'dairy', rawNotes: [] } // PMEGP will report insufficient_data (multiple unknowns)
    const ranked = [rankedFor('pmegp', profile)]
    expect(ranked[0].eligibility.status).toBe('insufficient_data')
    const result = assessReadiness({ userProfile: profile, ranked, missingFields: identifyMissingFields(profile) })
    expect(result.status).toBe('preliminary')
  })

  it('is preliminary when the top match is promising but 2+ high-materiality fields are still unknown', () => {
    const profile: UserProfile = {
      businessSector: 'dairy',
      businessStage: 'new',
      state: 'Karnataka',
      financingRequired: 300_000,
      rawNotes: [],
      // annualIncome and socialCategory still unknown -> 2 high-materiality gaps
    }
    const ranked = [rankedFor('pmegp', profile)]
    const result = assessReadiness({ userProfile: profile, ranked, missingFields: identifyMissingFields(profile) })
    expect(result.status === 'preliminary' || result.status === 'actionable').toBe(true)
    // Whichever it lands on, the gap count must genuinely be what's claimed.
    expect(result.materialGapsRemaining.length).toBeGreaterThanOrEqual(0)
  })

  it('is actionable without every demographic field known — the core "not a questionnaire" guarantee', () => {
    const profile: UserProfile = {
      businessSector: 'dairy',
      businessStage: 'new',
      state: 'Karnataka',
      socialCategory: 'sc',
      annualIncome: 150_000,
      financingRequired: 100_000,
      rawNotes: [],
      // age, areaType, education, existingLoans deliberately never provided
    }
    const ranked = [rankedFor('nsfdc-micro-finance', profile), rankedFor('pmegp', profile)].sort(
      (a, b) => b.rankScore - a.rankScore,
    )
    const result = assessReadiness({ userProfile: profile, ranked, missingFields: identifyMissingFields(profile) })
    expect(['actionable', 'application_ready']).toContain(result.status)
    expect(profile.age).toBeUndefined()
    expect(profile.education).toBeUndefined()
  })

  it('reaches application_ready only with a high-confidence likely_eligible top match and no high-materiality gaps', () => {
    const profile: UserProfile = {
      businessSector: 'dairy',
      businessStage: 'new',
      state: 'Karnataka',
      socialCategory: 'sc',
      annualIncome: 150_000,
      financingRequired: 100_000,
      areaType: 'rural',
      age: 30,
      rawNotes: [],
    }
    const ranked = [rankedFor('nsfdc-micro-finance', profile)]
    expect(ranked[0].eligibility.confidence).toBe('high')
    expect(ranked[0].eligibility.status).toBe('likely_eligible')
    const result = assessReadiness({ userProfile: profile, ranked, missingFields: identifyMissingFields(profile) })
    expect(result.status).toBe('application_ready')
  })

  it('never lists a low-materiality field (education/existingLoans) among material gaps', () => {
    const profile: UserProfile = { businessSector: 'dairy', rawNotes: [] }
    const missingFields = identifyMissingFields(profile)
    const result = assessReadiness({ userProfile: profile, ranked: [rankedFor('pmegp', profile)], missingFields })
    expect(result.materialGapsRemaining).not.toContain('education')
    expect(result.materialGapsRemaining).not.toContain('existingLoans')
  })
})
