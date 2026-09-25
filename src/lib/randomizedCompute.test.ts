import { describe, expect, it } from 'vitest'
import { BUSINESS_CATEGORIES, VILLAGES, type BusinessCategory } from '../data/villages'
import { NSFDC } from './config'
import { buildSchemePlan, toPaise } from './finance'
import { computeLokScore, type EntrepreneurProfile } from './lokScore'
import { fetchMandiSignal } from './mandi'
import { curatedLocationFromVillage, type ResolvedLocation } from './resolveLocation'
import { unavailableWeather } from './weather'
import { buildWorkingCapital } from './workingCapital'

const TYPED_PLACES: Array<{ query: string; lat: number; lng: number; district: string }> = [
  { query: 'Nashik', lat: 19.9975, lng: 73.7898, district: 'Nashik' },
  { query: 'Hassan, Karnataka', lat: 13.0033, lng: 76.1, district: 'Hassan' },
  { query: 'Pune', lat: 18.5204, lng: 73.8567, district: 'Pune' },
  { query: 'Mysuru', lat: 12.2958, lng: 76.6394, district: 'Mysuru' },
  { query: 'Belagavi', lat: 15.8497, lng: 74.4977, district: 'Belagavi' },
]

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a += 0x6d2b79f5
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function typedPlaceLocation(place: (typeof TYPED_PLACES)[number], _category: BusinessCategory): ResolvedLocation {
  const empty = {
    dairy: 0.5,
    retail: 0.5,
    food: 0.5,
    textiles: 0.5,
    poultry: 0.5,
    agri_processing: 0.5,
  } as Record<BusinessCategory, number>
  return {
    id: `live:${place.lat.toFixed(4)},${place.lng.toFixed(4)}`,
    name: place.query.split(',')[0] ?? place.query,
    nameKn: place.query,
    district: place.district,
    districtKn: place.district,
    block: place.query,
    lat: place.lat,
    lng: place.lng,
    population: null,
    households: null,
    nearbyMandi: 'Mandi signal unavailable',
    competitorDensity: empty,
    purchasingPowerIndex: null,
    milkCoopPresence: false,
    notes: `Typed place ${place.query} (no live Overpass in this test).`,
    notesKn: place.query,
    provenance: 'partial',
    provenanceLabelEn: `Typed place ${place.query}`,
    provenanceLabelKn: place.query,
    competitors: [],
    competitorQueryOk: false,
    geocodeOk: true,
    radiusKm: 7,
    hasCuratedSignals: false,
  }
}

function profileFor(margin: number, category: BusinessCategory, villageId: string): EntrepreneurProfile {
  return {
    name: 'Random Case',
    age: 29,
    gender: 'female',
    community: 'sc',
    annualIncome: 180000,
    experienceYears: 2,
    villageId,
    category,
    availableMargin: margin,
    locationMode: 'curated',
    radiusKm: 7,
  }
}

function expectedScheme(projectPaise: number): 'micro_finance' | 'term_loan' | 'over_limit' {
  if (projectPaise <= toPaise(NSFDC.microProjectCapRupees)) return 'micro_finance'
  if (projectPaise <= toPaise(NSFDC.termProjectCapRupees)) return 'term_loan'
  return 'over_limit'
}

function expectedLoanPaise(projectPaise: number, scheme: 'micro_finance' | 'term_loan' | 'over_limit'): number {
  const ninety = Math.floor((projectPaise * 9) / 10)
  if (scheme === 'micro_finance') return Math.min(ninety, toPaise(NSFDC.microLoanCapRupees))
  if (scheme === 'term_loan') return Math.min(ninety, toPaise(NSFDC.termLoanCapRupees))
  return ninety
}

function collectNonFinite(value: unknown, path: string, into: string[]) {
  if (value === undefined) {
    into.push(`${path} is undefined`)
    return
  }
  if (value === null) return
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) into.push(`${path}=${String(value)}`)
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => collectNonFinite(item, `${path}[${i}]`, into))
    return
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      collectNonFinite(v, path ? `${path}.${k}` : k, into)
    }
  }
}

async function runCompute(input: {
  margin: number
  category: BusinessCategory
  kind: 'seeded' | 'typed'
  villageIndex: number
  placeIndex: number
}) {
  const village = VILLAGES[input.villageIndex % VILLAGES.length]
  const place = TYPED_PLACES[input.placeIndex % TYPED_PLACES.length]
  const profile = profileFor(input.margin, input.category, village.id)
  profile.locationMode = input.kind === 'seeded' ? 'curated' : 'live'
  profile.liveQuery = place.query
  const location =
    input.kind === 'seeded' ? curatedLocationFromVillage(village, 7) : typedPlaceLocation(place, input.category)
  const plan = buildSchemePlan(input.margin, new Date('2026-01-01T00:00:00Z'))
  const weather = unavailableWeather()
  const mandi = await fetchMandiSignal(location, input.category)
  const wc = buildWorkingCapital({
    category: input.category,
    projectCostRupees: plan.projectCost,
    monthlyOpexRupees: plan.opsCostMonthly,
  })
  const score = computeLokScore({ profile, location, weather, mandi, plan })
  return { profile, location, plan, weather, mandi, wc, score }
}

function checkCase(
  label: string,
  margin: number,
  out: Awaited<ReturnType<typeof runCompute>>,
): string[] {
  const errors: string[] = []
  const { plan, score, wc, weather, mandi, location, profile } = out
  collectNonFinite({ plan, score, wc, weather, mandi, location, profile }, '', errors)

  const marginPaise = toPaise(margin)
  const projectPaise = toPaise(plan.projectCost)
  if (projectPaise !== marginPaise * 10) {
    errors.push(`project_cost_paise ${projectPaise} !== margin_paise*10 ${marginPaise * 10}`)
  }

  const scheme = expectedScheme(projectPaise)
  if (plan.schemeId !== scheme) {
    errors.push(`scheme ${plan.schemeId} !== ${scheme} (project ₹${plan.projectCost})`)
  }

  if (scheme === 'micro_finance' || scheme === 'term_loan') {
    const loanPaise = toPaise(plan.loanAmount)
    const want = expectedLoanPaise(projectPaise, scheme)
    if (loanPaise !== want) {
      errors.push(`loan_paise ${loanPaise} !== min(90%,cap) ${want}`)
    }

    const repay = plan.schedule.filter((row) => row.status === 'repayment')
    const wantLen = plan.tenureYears * 4 - plan.moratoriumMonths / 3
    if (repay.length !== wantLen) {
      errors.push(`repayment schedule length ${repay.length} !== (tenure-moratorium) quarters ${wantLen}`)
    }
    for (const row of repay) {
      if (!(row.total > 0)) errors.push(`repayment Q${row.quarter} amount ${row.total} is not > 0`)
    }
    const sumRepay = repay.reduce((acc, row) => acc + toPaise(row.total), 0)
    if (!(sumRepay > loanPaise)) {
      errors.push(`sum(repayments paise) ${sumRepay} is not > principal ${loanPaise}`)
    }
  }

  if (!(score.total >= 0 && score.total <= 100)) {
    errors.push(`LokScore ${score.total} not in [0,100]`)
  }

  return errors.map((e) => `${label}: ${e}`)
}

describe('randomized compute path', () => {
  it('holds NSFDC + LokScore invariants on 200 random cases', async () => {
    const rng = mulberry32(20260920)
    const failures: string[] = []
    for (let i = 0; i < 200; i++) {
      const margin = 1_000 + Math.floor(rng() * (500_000 - 1_000 + 1))
      const category = BUSINESS_CATEGORIES[i % BUSINESS_CATEGORIES.length]
      const kind: 'seeded' | 'typed' = i % 2 === 0 ? 'seeded' : 'typed'
      try {
        const out = await runCompute({
          margin,
          category,
          kind,
          villageIndex: i,
          placeIndex: i,
        })
        failures.push(
          ...checkCase(`#${i} margin=${margin} ${category} ${kind}`, margin, out),
        )
      } catch (e) {
        failures.push(`#${i} margin=${margin} ${category} ${kind} crashed: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    expect(failures, failures.join('\n')).toEqual([])
  })

  it('holds exact margin boundaries 13999 / 14000 / 14001 / 500000', async () => {
    const failures: string[] = []
    const bounds = [13_999, 14_000, 14_001, 500_000]
    for (const [i, margin] of bounds.entries()) {
      const category = BUSINESS_CATEGORIES[i % BUSINESS_CATEGORIES.length]
      const kind: 'seeded' | 'typed' = i % 2 === 0 ? 'seeded' : 'typed'
      try {
        const out = await runCompute({
          margin,
          category,
          kind,
          villageIndex: i,
          placeIndex: i,
        })
        failures.push(...checkCase(`boundary margin=${margin} ${category} ${kind}`, margin, out))
        const projectPaise = toPaise(out.plan.projectCost)
        if (margin === 13_999 || margin === 14_000) {
          if (out.plan.schemeId !== 'micro_finance') {
            failures.push(`margin ${margin} expected micro, got ${out.plan.schemeId} (project ${projectPaise})`)
          }
        }
        if (margin === 14_001 || margin === 500_000) {
          if (out.plan.schemeId !== 'term_loan') {
            failures.push(`margin ${margin} expected term, got ${out.plan.schemeId} (project ${projectPaise})`)
          }
        }
      } catch (e) {
        failures.push(`boundary margin=${margin} crashed: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    expect(failures, failures.join('\n')).toEqual([])
  })
})
