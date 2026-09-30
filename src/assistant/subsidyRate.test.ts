import { describe, expect, it } from 'vitest'
import { SCHEMES } from './data/schemes'
import { applicableSubsidyRate, describeApplicableSubsidy } from './subsidyRate'
import type { Gender, SchemeSubsidyInfo, SocialCategory } from './types'

const PMMSY_SUBSIDY = SCHEMES.find((s) => s.id === 'pmmsy')!.subsidy!
const PMEGP_SUBSIDY = SCHEMES.find((s) => s.id === 'pmegp')!.subsidy!

function rateFor(socialCategory?: SocialCategory, gender?: Gender) {
  return applicableSubsidyRate(PMMSY_SUBSIDY, { socialCategory, gender })
}

const SIXTY = { kind: 'decided', ratePercent: 60, label: 'SC/ST/Women' }
const FORTY = { kind: 'decided', ratePercent: 40, label: 'General category' }

describe('applicableSubsidyRate — PMMSY (60% SC/ST/Women, 40% General category)', () => {
  it('gives SC or ST applicants 60%, whatever their gender (stated or not)', () => {
    for (const category of ['sc', 'st'] as const) {
      for (const gender of ['male', 'female', 'other', undefined] as const) {
        expect(rateFor(category, gender)).toEqual(SIXTY)
      }
    }
  })

  it('gives women 60%, whatever their category (stated or not)', () => {
    for (const category of ['sc', 'st', 'obc', 'general', undefined] as const) {
      expect(rateFor(category, 'female')).toEqual(SIXTY)
    }
  })

  it('gives 40% once both category and gender are known and neither qualifies', () => {
    expect(rateFor('general', 'male')).toEqual(FORTY)
    expect(rateFor('obc', 'male')).toEqual(FORTY)
    expect(rateFor('general', 'other')).toEqual(FORTY)
    expect(rateFor('obc', 'other')).toEqual(FORTY)
  })

  it('stays undetermined while a fact that could still raise the rate is unknown', () => {
    // General category, gender unknown: a General-category woman gets 60%.
    expect(rateFor('general', undefined)).toEqual({ kind: 'undetermined', decidedBy: ['gender'] })
    expect(rateFor('obc', undefined)).toEqual({ kind: 'undetermined', decidedBy: ['gender'] })
    // A man of unknown category could be SC/ST.
    expect(rateFor(undefined, 'male')).toEqual({ kind: 'undetermined', decidedBy: ['socialCategory'] })
    expect(rateFor(undefined, undefined)).toEqual({ kind: 'undetermined', decidedBy: ['socialCategory', 'gender'] })
  })

  it('returns null for a scheme whose rate does not depend on the applicant, or no subsidy at all', () => {
    expect(applicableSubsidyRate(PMEGP_SUBSIDY, { socialCategory: 'sc', gender: 'female' })).toBeNull()
    expect(applicableSubsidyRate(undefined, { socialCategory: 'sc' })).toBeNull()
  })
})

describe('describeApplicableSubsidy — the subsidy line shown to the applicant', () => {
  it('shows only the applicant’s own decided rate', () => {
    expect(describeApplicableSubsidy(PMMSY_SUBSIDY, { socialCategory: 'sc', gender: 'male' })).toBe(
      '60% of the project/unit cost — the SC/ST/Women rate, which applies to you.',
    )
    expect(describeApplicableSubsidy(PMMSY_SUBSIDY, { socialCategory: 'general', gender: 'male' })).toBe(
      '40% of the project/unit cost — the General category rate, which applies to you.',
    )
  })

  it('falls back to the full description (every rate) when the rate is undetermined', () => {
    expect(describeApplicableSubsidy(PMMSY_SUBSIDY, { socialCategory: 'general' })).toBe(PMMSY_SUBSIDY.description)
  })

  it('leaves a scheme without applicant tiers exactly as today', () => {
    expect(describeApplicableSubsidy(PMEGP_SUBSIDY, { socialCategory: 'sc', gender: 'female' })).toBe(PMEGP_SUBSIDY.description)
  })
})

describe('applicantTiers data', () => {
  it('PMMSY’s tiers agree with its published range and description', () => {
    const tiers = PMMSY_SUBSIDY.applicantTiers!
    expect(tiers.standardRatePercent).toBe(PMMSY_SUBSIDY.ratePercentMin)
    expect(tiers.higherRatePercent).toBe(PMMSY_SUBSIDY.ratePercentMax)
    expect(PMMSY_SUBSIDY.description).toContain(`${tiers.standardRatePercent}% of the project/unit cost for General category`)
    expect(PMMSY_SUBSIDY.description).toContain(`${tiers.higherRatePercent}% for SC/ST/Women`)
  })

  it('is additive: no other scheme has applicant tiers', () => {
    const withTiers = SCHEMES.filter((s) => (s.subsidy as SchemeSubsidyInfo | undefined)?.applicantTiers).map((s) => s.id)
    expect(withTiers).toEqual(['pmmsy'])
  })
})
