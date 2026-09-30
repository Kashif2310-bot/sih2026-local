import type { BusinessCategory } from '../data/villages'
import type { SchemePlan } from './finance'
import { getUpcomingEvents } from '../data/festivals'
import { LOKSCORE_WEIGHTS, QUORUM_THRESHOLDS } from './config'
import type { ResolvedLocation } from './resolveLocation'

export interface EntrepreneurProfile {
  name: string
  age: number
  gender: 'female' | 'male' | 'other'
  community: 'sc' | 'st' | 'obc' | 'general'
  annualIncome: number
  experienceYears: number
  /** Curated village id when mode=curated */
  villageId: string
  category: BusinessCategory
  availableMargin: number
  phone?: string
  locationMode: 'curated' | 'live'
  liveQuery?: string
  liveLat?: number
  liveLng?: number
  /** Omitted when the citizen never chose one — the scan then uses REACH_KM.default. */
  radiusKm?: number
  /** Presenter safety switch: skip all live network calls, seeded villages only. */
  demoMode?: boolean
}

export interface WeatherSignal {
  tempMax: number
  tempMin: number
  precipProb: number
  precipMm: number
  code: number
  summary: string
  summaryKn: string
  source: 'live' | 'unavailable'
}

export interface MandiSignal {
  commodity: string
  market: string
  modalPrice: number
  minPrice: number
  maxPrice: number
  unit: string
  trend: 'up' | 'down' | 'flat'
  changePct: number
  source: 'seeded' | 'unavailable'
}

export interface LokScoreBreakdown {
  demand: number
  competitionGap: number
  weatherFit: number
  financialFit: number
  eligibility: number
  total: number
  grade: 'A' | 'B' | 'C' | 'D'
  quorumRequired: number
  quorumPool: number
  mentorRequired: boolean
  rationale: string[]
  rationaleKn: string[]
  weights: typeof LOKSCORE_WEIGHTS
}

function clamp(n: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, n))
}

export function scoreEligibility(profile: EntrepreneurProfile): {
  score: number
  notes: string[]
  notesKn: string[]
} {
  const notes: string[] = []
  const notesKn: string[] = []
  let score = 40

  if (profile.community === 'sc') {
    score += 35
    notes.push('SC community matches NSFDC primary mandate.')
    notesKn.push('ಪರಿಶಿಷ್ಟ ಜಾತಿ NSFDC ಮುಖ್ಯ ಅರ್ಹತೆಗೆ ಹೊಂದಿಕೆಯಾಗುತ್ತದೆ.')
  } else {
    notes.push('NSFDC core schemes target SC beneficiaries — flag for alternate channel.')
    notesKn.push('ಎನ್‌ಎಸ್‌ಎಫ್‌ಡಿಸಿ ಮುಖ್ಯ ಯೋಜನೆಗಳು ಪರಿಶಿಷ್ಟ ಜಾತಿಗೆ — ಪರ್ಯಾಯ ಮಾರ್ಗ ಗುರುತಿಸಿ.')
  }

  if (profile.annualIncome <= 500_000) {
    score += 15
    notes.push('Income within NSFDC ceiling (≤ ₹5 lakh).')
    notesKn.push('ಆದಾಯ NSFDC ಮಿತಿಯೊಳಗೆ (≤ ₹5 ಲಕ್ಷ).')
  } else {
    score -= 20
    notes.push('Income above typical NSFDC ceiling — may need other lenders.')
    notesKn.push('ಆದಾಯ NSFDC ಮಿತಿ ಮೀರಿದೆ — ಇತರ ಸಾಲದಾತರು ಬೇಕಾಗಬಹುದು.')
  }

  if (profile.gender === 'female') {
    score += 10
    notes.push('Women get priority allocation (40% target under Term Loan / MFS).')
    notesKn.push('ಮಹಿಳೆಯರಿಗೆ ಆದ್ಯತೆ (ಟರ್ಮ್ ಲೋನ್/MFS ನಲ್ಲಿ 40% ಗುರಿ).')
  }

  if (profile.age >= 18 && profile.age <= 45) {
    score += 5
  }

  return { score: clamp(score), notes, notesKn }
}

export function computeLokScore(input: {
  profile: EntrepreneurProfile
  location: ResolvedLocation
  weather: WeatherSignal
  mandi: MandiSignal | null
  plan: SchemePlan
}): LokScoreBreakdown {
  const { profile, location, weather, mandi, plan } = input
  const category = profile.category
  const events = location.hasCuratedSignals ? getUpcomingEvents(location.id) : []

  let demand = 40
  if (location.purchasingPowerIndex != null) {
    demand = 35 + location.purchasingPowerIndex * 25
  } else {
    demand = 45 // neutral when PPI unknown — labeled in rationale
  }
  const eventLift = events.reduce((acc, e) => acc + (e.demandLift[category] ?? 0), 0)
  demand += Math.min(30, eventLift * 50)
  if (mandi && mandi.source === 'seeded') {
    if (mandi.trend === 'up') demand += 8
    if (mandi.trend === 'down') demand -= 6
  }
  if (category === 'dairy' && location.milkCoopPresence) demand += 5
  demand = clamp(demand)

  let competitionGap: number
  if (!location.competitorQueryOk && location.provenance !== 'curated_seed') {
    competitionGap = 40 // unknown live competitors — not a fabricated density
  } else {
    const density = location.competitorDensity[category]
    competitionGap = clamp((1 - density) * 100)
    if (category === 'dairy' && location.milkCoopPresence && density > 0.55) {
      competitionGap = clamp(competitionGap + 18)
    }
  }

  let weatherFit = 50
  if (weather.source === 'unavailable') {
    weatherFit = 45
  } else if (category === 'dairy' || category === 'poultry') {
    weatherFit = weather.tempMax > 38 ? 35 : weather.precipProb > 70 ? 50 : 78
  } else if (category === 'food') {
    weatherFit = weather.precipProb > 60 ? 45 : 75
  } else if (category === 'agri_processing') {
    weatherFit = weather.precipProb > 50 ? 70 : 60
  } else {
    weatherFit = weather.precipProb > 75 ? 48 : 72
  }
  weatherFit = clamp(weatherFit)

  const ppi = location.purchasingPowerIndex ?? 0.55
  const monthlyRevenueProxy = profile.availableMargin * 0.12 * (0.7 + ppi * 0.5)
  const monthlyEmi = plan.quarterlyEmi / 3
  const coverage = monthlyEmi > 0 ? monthlyRevenueProxy / (monthlyEmi + plan.opsCostMonthly) : 0
  let financialFit = clamp(coverage * 55)
  if (plan.schemeId === 'micro_finance' || plan.schemeId === 'term_loan') financialFit += 15
  if (plan.schemeId === 'over_limit') financialFit = 25
  financialFit = clamp(financialFit)

  const elig = scoreEligibility(profile)
  const eligibility = elig.score
  const w = LOKSCORE_WEIGHTS

  const total = clamp(
    Math.round(
      demand * w.demand +
        competitionGap * w.competitionGap +
        weatherFit * w.weather +
        financialFit * w.finance +
        eligibility * w.eligibility,
    ),
  )

  const grade: LokScoreBreakdown['grade'] =
    total >= 80 ? 'A' : total >= 65 ? 'B' : total >= 50 ? 'C' : 'D'

  let quorumRequired = 4
  let quorumPool = 5
  let mentorRequired = true
  if (total >= QUORUM_THRESHOLDS.high) {
    quorumRequired = 2
    quorumPool = 3
    mentorRequired = false
  } else if (total >= QUORUM_THRESHOLDS.mid) {
    quorumRequired = 3
    quorumPool = 5
    mentorRequired = false
  }

  const density = location.competitorDensity[category]
  const rationale: string[] = [
    `Demand ${Math.round(demand)}/100` +
      (location.purchasingPowerIndex == null ? ' (PPI unknown — neutral baseline)' : ' from events/PPI/mandi') +
      '.',
    !location.competitorQueryOk && location.provenance !== 'curated_seed'
      ? `Competition gap ${Math.round(competitionGap)}/100 — live competitor data unavailable (not fabricated).`
      : `Competition gap ${Math.round(competitionGap)}/100 — density ${(density * 100).toFixed(0)}% in ${location.radiusKm} km.`,
    weather.source === 'unavailable'
      ? `Weather ${Math.round(weatherFit)}/100 — live weather unavailable.`
      : `Weather fitness ${Math.round(weatherFit)}/100 for ${category}.`,
    `Financial coverage ${Math.round(financialFit)}/100 vs NSFDC repayment path.`,
    ...elig.notes.slice(0, 2),
  ]
  const rationaleKn: string[] = [
    `ಬೇಡಿಕೆ ${Math.round(demand)}/100.`,
    `ಸ್ಪರ್ಧಾ ಅಂತರ ${Math.round(competitionGap)}/100.`,
    `ಹವಾಮಾನ ${Math.round(weatherFit)}/100.`,
    `ಹಣಕಾಸು ${Math.round(financialFit)}/100.`,
    ...elig.notesKn.slice(0, 2),
  ]

  return {
    demand: Math.round(demand),
    competitionGap: Math.round(competitionGap),
    weatherFit: Math.round(weatherFit),
    financialFit: Math.round(financialFit),
    eligibility: Math.round(eligibility),
    total,
    grade,
    quorumRequired,
    quorumPool,
    mentorRequired,
    rationale,
    rationaleKn,
    weights: LOKSCORE_WEIGHTS,
  }
}
