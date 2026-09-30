import { describe, expect, it } from 'vitest'
import { extractAndMerge } from './profileExtraction'
import { rankSchemes } from './ranking'
import type { SchemeRetriever } from './retrieval'
import { EMPTY_PROFILE, type UserProfile } from './types'

const PROFILE_A_POULTRY_KARNATAKA_SC: UserProfile = {
  rawNotes: [],
  age: 24,
  areaType: 'rural',
  state: 'Karnataka',
  socialCategory: 'sc',
  annualIncome: 200_000,
  businessSector: 'poultry',
  businessStage: 'new',
  businessStatus: 'idea',
  investmentRequired: 300_000,
}

const PROFILE_B_TAILORING_KERALA_WOMAN: UserProfile = {
  rawNotes: [],
  age: 47,
  gender: 'female',
  state: 'Kerala',
  businessSector: 'tailoring',
  businessStage: 'existing_expansion',
  businessStatus: 'existing',
  annualIncome: 600_000,
  financingRequired: 800_000,
}

const PROFILE_C_RETAIL_GENERAL_URBAN: UserProfile = {
  rawNotes: [],
  age: 35,
  gender: 'male',
  areaType: 'urban',
  state: 'Maharashtra',
  socialCategory: 'general',
  annualIncome: 900_000,
  businessSector: 'retail',
  businessStage: 'new',
  businessStatus: 'idea',
  investmentRequired: 1_200_000,
}

function topIds(profile: UserProfile, n = 3): string[] {
  return rankSchemes(profile)
    .slice(0, n)
    .map((r) => r.scheme.id)
}

function eligibleIds(profile: UserProfile): string[] {
  return rankSchemes(profile)
    .filter((r) => r.eligibility.status === 'likely_eligible' || r.eligibility.status === 'possibly_eligible')
    .map((r) => r.scheme.id)
    .sort()
}

describe('rankSchemes — CRITICAL: materially different profiles produce materially different rankings', () => {
  it('produces a different top-ranked scheme for each of three materially different profiles', () => {
    const topA = topIds(PROFILE_A_POULTRY_KARNATAKA_SC, 1)[0]
    const topB = topIds(PROFILE_B_TAILORING_KERALA_WOMAN, 1)[0]
    const topC = topIds(PROFILE_C_RETAIL_GENERAL_URBAN, 1)[0]

    // Not a hard requirement that all three differ pairwise by construction,
    // but for these three deliberately distinct profiles it must hold —
    // otherwise the assistant is just returning the same answer for everyone.
    expect(new Set([topA, topB, topC]).size).toBe(3)
  })

  it('produces different eligible-scheme sets across the three profiles', () => {
    const setA = eligibleIds(PROFILE_A_POULTRY_KARNATAKA_SC)
    const setB = eligibleIds(PROFILE_B_TAILORING_KERALA_WOMAN)
    const setC = eligibleIds(PROFILE_C_RETAIL_GENERAL_URBAN)

    expect(setA).not.toEqual(setB)
    expect(setB).not.toEqual(setC)
    expect(setA).not.toEqual(setC)
  })

  it('never recommends the Kerala state scheme to the Karnataka profile', () => {
    expect(eligibleIds(PROFILE_A_POULTRY_KARNATAKA_SC)).not.toContain('kudumbashree-microenterprise')
  })

  it('never ranks PMEGP as a likely/possible match for the poultry profile (excluded activity)', () => {
    expect(eligibleIds(PROFILE_A_POULTRY_KARNATAKA_SC)).not.toContain('pmegp')
  })

  it('flags NSFDC schemes as ineligible for profile B (income above ceiling, no SC/ST stated)', () => {
    const rankedB = rankSchemes(PROFILE_B_TAILORING_KERALA_WOMAN)
    const nsfdcMicro = rankedB.find((r) => r.scheme.id === 'nsfdc-micro-finance')!
    expect(nsfdcMicro.eligibility.status).toBe('likely_ineligible')
  })

  it('ranks Kudumbashree highly for profile B (Kerala woman)', () => {
    const rankedB = rankSchemes(PROFILE_B_TAILORING_KERALA_WOMAN)
    const kudumbashreeIndex = rankedB.findIndex((r) => r.scheme.id === 'kudumbashree-microenterprise')
    expect(kudumbashreeIndex).toBeGreaterThanOrEqual(0)
    expect(kudumbashreeIndex).toBeLessThan(3)
  })
})

describe('rankSchemes — provider/retrieval failure and empty-result resilience', () => {
  it('returns an empty array without throwing when the retriever returns no candidates', () => {
    const emptyRetriever: SchemeRetriever = { retrieve: () => [] }
    expect(() => rankSchemes(EMPTY_PROFILE, undefined, emptyRetriever)).not.toThrow()
    expect(rankSchemes(EMPTY_PROFILE, undefined, emptyRetriever)).toEqual([])
  })

  it('propagates a retriever exception rather than silently fabricating results', () => {
    const throwingRetriever: SchemeRetriever = {
      retrieve: () => {
        throw new Error('retrieval backend unavailable')
      },
    }
    expect(() => rankSchemes(EMPTY_PROFILE, undefined, throwingRetriever)).toThrow('retrieval backend unavailable')
  })

  it('still produces a valid ranking for a profile with no fields set', () => {
    expect(() => rankSchemes(EMPTY_PROFILE)).not.toThrow()
    const ranked = rankSchemes(EMPTY_PROFILE)
    expect(ranked.length).toBeGreaterThan(0)
    expect(ranked.every((r) => r.eligibility.status === 'insufficient_data' || r.eligibility.status === 'possibly_eligible' || r.eligibility.status === 'likely_ineligible' || r.eligibility.status === 'likely_eligible')).toBe(true)
  })
})

describe('rankSchemes — PM Vishwakarma trade sector tags', () => {
  // One stated trade per sector tag added for the 18 PM Vishwakarma trades
  // (Guidelines v30.0, para 2.3), plus handicraft's basket/mat keywords.
  const TRADE_STATEMENTS: Array<[tag: string, statement: string]> = [
    ['metal_tools', 'I am 34 years old and I work as a locksmith'],
    ['goldsmith', 'I am 41 years old and I am a goldsmith in my village'],
    ['stonework', 'I am 29 years old and I do stone carving'],
    ['cobbler_footwear', 'I am 38 years old and I work as a cobbler'],
    ['masonry', 'I am 45 years old and I work as a mason'],
    ['barber', 'I am 31 years old and I work as a barber'],
    ['garland_making', 'I am 27 years old and I make flower garlands'],
    ['washerman', 'I am 50 years old and I work as a washerman'],
    ['boat_making', 'I am 36 years old and I do boat making'],
    ['fishing_net_making', 'I am 33 years old and I make fishing nets'],
    ['handicraft', 'I am 40 years old and I do basket and mat weaving'],
  ]

  it.each(TRADE_STATEMENTS)('%s: ranks PM Vishwakarma first with its official figures', (tag, statement) => {
    const profile = extractAndMerge(statement, EMPTY_PROFILE).profile
    expect(profile.businessSector).toBe(tag)

    const top = rankSchemes(profile)[0]!
    expect(top.scheme.id).toBe('pm-vishwakarma')
    expect(top.eligibility.status).toBe('likely_eligible')
    expect(top.scheme.loanAmount?.maxRupees).toBe(300_000)
    expect(top.scheme.interest?.ratePercent).toBe(5)
    expect(top.scheme.subsidy?.description).toContain('₹15,000')
  })
})

describe('rankSchemes — PMMSY (fisheries)', () => {
  function pmmsyFor(statement: string) {
    const profile = extractAndMerge(statement, EMPTY_PROFILE).profile
    expect(profile.businessSector).toBe('fisheries')
    const ranked = rankSchemes(profile)
    return { profile, ranked, pmmsy: ranked.find((r) => r.scheme.id === 'pmmsy')! }
  }

  it('ranks PMMSY first for a General-category fish farmer, with the 40% General-category assistance', () => {
    const { profile, ranked, pmmsy } = pmmsyFor('I am 35 years old, general category, and I want to start fish farming in a pond')
    expect(profile.socialCategory).toBe('general')
    expect(ranked[0]!.scheme.id).toBe('pmmsy')
    expect(pmmsy.eligibility.status).toBe('likely_eligible')
    expect(pmmsy.scheme.subsidy?.ratePercentMin).toBe(40)
    expect(pmmsy.scheme.subsidy?.description).toContain('40% of the project/unit cost for General category')
  })

  it('ranks PMMSY first for an SC woman fish vendor, with the 60% SC/ST/Women assistance', () => {
    const { profile, ranked, pmmsy } = pmmsyFor('I am a 30 year old woman from the SC category and I work as a fish vendor')
    expect(profile.socialCategory).toBe('sc')
    expect(profile.gender).toBe('female')
    expect(ranked[0]!.scheme.id).toBe('pmmsy')
    expect(pmmsy.eligibility.status).toBe('likely_eligible')
    expect(pmmsy.scheme.subsidy?.ratePercentMax).toBe(60)
    expect(pmmsy.scheme.subsidy?.description).toContain('60% for SC/ST/Women')
  })

  it('ranks PMMSY first for an ST fisherman too', () => {
    const { profile, ranked, pmmsy } = pmmsyFor('I am 40 years old, ST category, and I am a fisherman')
    expect(profile.socialCategory).toBe('st')
    expect(ranked[0]!.scheme.id).toBe('pmmsy')
    expect(pmmsy.scheme.subsidy?.ratePercentMax).toBe(60)
  })
})
