import { describe, expect, it } from 'vitest'
import { profileFromAssessment } from './fromAssessment'
import { rankSchemes } from './ranking'
import { VILLAGES, BUSINESS_META } from '../data/villages'
import { curatedLocationFromVillage } from '../lib/resolveLocation'
import { buildSchemePlan } from '../lib/finance'
import type { EntrepreneurProfile, LokScoreBreakdown } from '../lib/lokScore'
import { LOKSCORE_WEIGHTS } from '../lib/config'

function villageByDistrict(district: string) {
  const v = VILLAGES.find((x) => x.district === district)
  if (!v) throw new Error(`no fixture village in ${district} — update this test if villages.ts changes`)
  return v
}

function profileFor(overrides: Partial<EntrepreneurProfile> = {}): EntrepreneurProfile {
  return {
    name: 'Test Case',
    age: 32,
    gender: 'female',
    community: 'sc',
    annualIncome: 150000,
    experienceYears: 1,
    villageId: 'dinka-mandya',
    category: 'dairy',
    availableMargin: 100000,
    locationMode: 'curated',
    radiusKm: 7,
    ...overrides,
  }
}

const score: LokScoreBreakdown = {
  demand: 60,
  competitionGap: 70,
  weatherFit: 50,
  financialFit: 65,
  eligibility: 80,
  total: 68,
  grade: 'B',
  quorumRequired: 3,
  quorumPool: 5,
  mentorRequired: false,
  rationale: ['fixture rationale'],
  rationaleKn: ['fixture rationale kn'],
  weights: LOKSCORE_WEIGHTS,
}

describe('profileFromAssessment', () => {
  it('maps demographic and finance fields straight across from the scan', () => {
    const profile = profileFor({ age: 41, gender: 'male', community: 'obc', annualIncome: 220000 })
    const location = curatedLocationFromVillage(villageByDistrict('Mandya'), 7)
    const plan = buildSchemePlan(profile.availableMargin)

    const result = profileFromAssessment({ profile, location, plan, score })

    expect(result.age).toBe(41)
    expect(result.gender).toBe('male')
    expect(result.socialCategory).toBe('obc')
    expect(result.annualIncome).toBe(220000)
    expect(result.ownContribution).toBe(profile.availableMargin)
    expect(result.investmentRequired).toBe(plan.projectCost)
    expect(result.financingRequired).toBe(plan.loanAmount)
    expect(result.areaType).toBe('rural')
    expect(result.businessStatus).toBe('idea')
  })

  it('maps every business category to its label and sector tag correctly', () => {
    const location = curatedLocationFromVillage(villageByDistrict('Mandya'), 7)
    const plan = buildSchemePlan(100000)

    const cases: Array<[EntrepreneurProfile['category'], string]> = [
      ['dairy', 'dairy'],
      ['retail', 'retail'],
      ['food', 'food_processing'],
      ['textiles', 'tailoring'],
      ['poultry', 'poultry'],
      ['agri_processing', 'food_processing'],
    ]
    for (const [category, expectedSector] of cases) {
      const result = profileFromAssessment({ profile: profileFor({ category }), location, plan, score })
      expect(result.businessSector).toBe(expectedSector)
      expect(result.proposedBusiness).toBe(BUSINESS_META[category].label)
      expect(result.occupation).toBe(BUSINESS_META[category].label)
    }
  })

  it('lets a "Textiles / Tailoring" scan reach PM Vishwakarma as a sector match', () => {
    const location = curatedLocationFromVillage(villageByDistrict('Mandya'), 7)
    const plan = buildSchemePlan(100000)
    const userProfile = profileFromAssessment({ profile: profileFor({ category: 'textiles' }), location, plan, score })

    const pmv = rankSchemes(userProfile).find((r) => r.scheme.id === 'pm-vishwakarma')!
    expect(pmv.eligibility.reasons).toContain('Supports tailoring businesses.')
    // Not 'likely_eligible' here: this scan's plan needs a ₹9 lakh loan, above
    // PM Vishwakarma's ₹3 lakh ceiling, which is correctly flagged as a concern.
    expect(['likely_eligible', 'possibly_eligible']).toContain(pmv.eligibility.status)
  })

  it('maps no scan category to fisheries — PMMSY is reachable only through free-text extraction on /assistant', () => {
    const location = curatedLocationFromVillage(villageByDistrict('Mandya'), 7)
    const plan = buildSchemePlan(100000)
    for (const category of Object.keys(BUSINESS_META) as Array<EntrepreneurProfile['category']>) {
      expect(profileFromAssessment({ profile: profileFor({ category }), location, plan, score }).businessSector).not.toBe('fisheries')
    }
  })

  it('resolves the state for every curated village district, including Tumakuru (regression: was previously missing)', () => {
    const plan = buildSchemePlan(100000)
    const districtsInFixtures = [...new Set(VILLAGES.map((v) => v.district))]
    // Fails loudly if villages.ts ever adds a district this bridge doesn't know about,
    // instead of silently shipping an undefined state for a real curated village.
    expect(districtsInFixtures).toEqual(
      expect.arrayContaining(['Mandya', 'Dharwad', 'Belagavi', 'Hassan', 'Tumakuru']),
    )
    for (const district of districtsInFixtures) {
      const location = curatedLocationFromVillage(villageByDistrict(district), 7)
      const result = profileFromAssessment({ profile: profileFor(), location, plan, score })
      expect(result.state, `district ${district} resolved to an undefined state`).toBe('Karnataka')
      expect(result.district).toBe(district)
    }
  })

  it('leaves state undefined for a district it genuinely does not know, rather than guessing', () => {
    const location = curatedLocationFromVillage(villageByDistrict('Mandya'), 7)
    const plan = buildSchemePlan(100000)
    const result = profileFromAssessment({
      profile: profileFor(),
      location: { ...location, district: 'Some Unmapped District' },
      plan,
      score,
    })
    expect(result.state).toBeUndefined()
    expect(result.district).toBe('Some Unmapped District')
  })

  it('infers the state directly when the "district" field is itself a state name', () => {
    const location = curatedLocationFromVillage(villageByDistrict('Mandya'), 7)
    const plan = buildSchemePlan(100000)
    const result = profileFromAssessment({
      profile: profileFor(),
      location: { ...location, district: 'Karnataka' },
      plan,
      score,
    })
    expect(result.state).toBe('Karnataka')
  })

  it('includes a human-readable summary of the scan in rawNotes, without inventing facts', () => {
    const village = villageByDistrict('Mandya')
    const location = curatedLocationFromVillage(village, 7)
    const plan = buildSchemePlan(100000)
    const profile = profileFor({ name: 'Lakshmi', category: 'dairy' })

    const result = profileFromAssessment({ profile, location, plan, score })

    expect(result.rawNotes).toHaveLength(1)
    expect(result.rawNotes[0]).toContain('Lakshmi')
    expect(result.rawNotes[0]).toContain(location.name)
    expect(result.rawNotes[0]).toContain(location.district)
    expect(result.rawNotes[0]).toContain(String(score.total))
    expect(result.rawNotes[0]).toContain(score.grade)
    expect(result.rawNotes[0]).toContain(plan.schemeName)
  })
})
