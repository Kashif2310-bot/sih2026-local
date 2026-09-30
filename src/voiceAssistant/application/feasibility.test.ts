import { describe, expect, it, vi } from 'vitest'
import type { UserProfile } from '../../assistant/types'
import { buildSchemePlan } from '../../lib/finance'
import { computeLokScore, type WeatherSignal } from '../../lib/lokScore'
import { fetchMandiSignal } from '../../lib/mandi'
import { resolveCuratedVillage } from '../../lib/resolveLocation'
import type { ApplicantDetails } from './extraction'
import { computeFeasibilityReport, feasibilityReadiness, type FeasibilityDeps } from './feasibility'

const PROFILE: UserProfile = {
  rawNotes: [],
  state: 'Karnataka',
  district: 'Mandya',
  age: 32,
  gender: 'female',
  socialCategory: 'sc',
  annualIncome: 180_000,
  businessSector: 'dairy',
  financingRequired: 450_000,
}
const DETAILS: ApplicantDetails = { applicantName: 'Lakshmi Devi', experienceYears: 3 }

const WEATHER: WeatherSignal = { tempMax: 31, tempMin: 21, precipProb: 20, precipMm: 1, code: 2, summary: 'Partly cloudy', summaryKn: '', source: 'live' }
const NOW = new Date('2026-09-30T10:00:00.000Z')

function deps(overrides: Partial<FeasibilityDeps> = {}): FeasibilityDeps {
  return {
    // Demo mode of main's resolver: seeded village data, no network.
    resolveCurated: (villageId, category, radiusKm) => resolveCuratedVillage(villageId, category, radiusKm, true),
    resolveLive: vi.fn(async () => ({ ok: false as const, error: 'Could not geocode that location.', errorKn: '' })),
    fetchWeather: vi.fn(async () => WEATHER),
    fetchMandi: fetchMandiSignal,
    now: () => NOW,
    ...overrides,
  }
}

describe('feasibility inputs from the application', () => {
  it('lists exactly what LokScore still needs, without defaulting anything', () => {
    const readiness = feasibilityReadiness({ rawNotes: [], businessSector: 'dairy' }, {})
    expect(readiness.ready).toBe(false)
    if (!readiness.ready) {
      expect(readiness.missing.map((m) => m.key)).toEqual([
        'applicant_name',
        'age',
        'gender',
        'social_category',
        'annual_income',
        'loan_amount',
        'district',
        'experience_years',
      ])
    }
  })

  it('a business type LokScore does not model is reported, not scored', () => {
    const readiness = feasibilityReadiness({ ...PROFILE, businessSector: 'carpentry' }, DETAILS)
    expect(readiness.ready).toBe(false)
    if (!readiness.ready) expect(readiness.unsupportedReason).toMatch(/carpentry is not modelled/)
  })

  it('the margin comes from own money first, then project cost, then the loan need (NSFDC 10% / 90%)', () => {
    const margin = (profile: UserProfile) => {
      const r = feasibilityReadiness(profile, DETAILS)
      return r.ready ? [r.inputs.profile.availableMargin, r.inputs.marginBasis] : null
    }
    expect(margin({ ...PROFILE, ownContribution: 70_000 })).toEqual([70_000, 'own_contribution'])
    expect(margin({ ...PROFILE, investmentRequired: 600_000 })).toEqual([60_000, 'project_cost'])
    expect(margin(PROFILE)).toEqual([50_000, 'loan_need'])
  })

  it('uses curated village data only when the citizen named a curated village; otherwise a live district lookup', () => {
    const live = feasibilityReadiness(PROFILE, DETAILS)
    expect(live.ready && live.inputs.location).toEqual({ mode: 'live', query: 'Mandya, Karnataka' })
    const curated = feasibilityReadiness(PROFILE, { ...DETAILS, curatedVillageId: 'dinka-mandya' })
    expect(curated.ready && curated.inputs.location).toEqual({ mode: 'curated', villageId: 'dinka-mandya' })
  })
})

describe('LokScore report', () => {
  it('is the main prototype LokScore on the same inputs, with its matrix', async () => {
    const readiness = feasibilityReadiness(PROFILE, { ...DETAILS, curatedVillageId: 'dinka-mandya' })
    if (!readiness.ready) throw new Error('inputs should be ready')
    const result = await computeFeasibilityReport(readiness.inputs, deps())
    if (!result.ok) throw new Error(result.reason)
    const { report } = result

    const location = await resolveCuratedVillage('dinka-mandya', 'dairy', readiness.inputs.profile.radiusKm, true)
    const mandi = await fetchMandiSignal(location, 'dairy')
    const expected = computeLokScore({ profile: readiness.inputs.profile, location, weather: WEATHER, mandi, plan: buildSchemePlan(50_000, NOW) })
    expect(report.lokScore).toEqual(expected)

    expect(report.matrix.map((r) => r.id)).toEqual(['demand', 'competitionGap', 'weather', 'finance', 'eligibility'])
    expect(report.matrix.reduce((sum, r) => sum + r.weightPercent, 0)).toBe(100)
    expect(report.inputs).toMatchObject({ name: 'Lakshmi Devi', experienceYears: 3, availableMargin: 50_000, marginBasis: 'loan_need' })
    expect(report.notes.join(' ')).toMatch(/separate from the government criteria report/)
    expect(report.notes.join(' ')).toMatch(/derived/)
  })

  it('a failed live lookup is reported as a failure, never a made-up location', async () => {
    const readiness = feasibilityReadiness(PROFILE, DETAILS)
    if (!readiness.ready) throw new Error('inputs should be ready')
    const result = await computeFeasibilityReport(readiness.inputs, deps())
    expect(result).toEqual({ ok: false, reason: expect.stringContaining('Mandya, Karnataka') })
  })

  it('weather that cannot be fetched is marked unavailable and listed as a failed source', async () => {
    const readiness = feasibilityReadiness(PROFILE, { ...DETAILS, curatedVillageId: 'dinka-mandya' })
    if (!readiness.ready) throw new Error('inputs should be ready')
    const result = await computeFeasibilityReport(readiness.inputs, deps({ fetchWeather: vi.fn(async () => Promise.reject(new Error('offline'))) }))
    if (!result.ok) throw new Error(result.reason)
    expect(result.report.weather.source).toBe('unavailable')
    expect(result.report.failedSources.length).toBeGreaterThan(0)
    expect(result.report.dataStatus).toBe('incomplete')
  })
})
