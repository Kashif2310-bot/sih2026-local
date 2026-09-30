import { effectiveFinancingNeed } from '../../assistant/missingFields'
import { normalizeSectorLabel } from '../../assistant/lexicon'
import type { UserProfile } from '../../assistant/types'
import { BUSINESS_META, VILLAGES, type BusinessCategory } from '../../data/villages'
import { REACH_KM } from '../../lib/config'
import { buildFeasibility } from '../../lib/feasibility'
import { buildSchemePlan, LOAN_RATIO, MARGIN_RATIO } from '../../lib/finance'
import { collectFailedSources, dataStatusFromFailures, type LiveSourceId } from '../../lib/liveSignals'
import {
  computeLokScore,
  scoreEligibility,
  type EntrepreneurProfile,
  type LokScoreBreakdown,
  type MandiSignal,
  type WeatherSignal,
} from '../../lib/lokScore'
import { fetchMandiSignal } from '../../lib/mandi'
import { resolveCuratedVillage, resolveLiveLocation, type ResolvedLocation } from '../../lib/resolveLocation'
import { fetchWeather, unavailableWeather } from '../../lib/weather'
import type { ApplicantDetails } from './extraction'
import { formatRupees } from './requirements'

/** Sector tags the main prototype's LokScore models, mapped to its business categories. */
const LOKSCORE_CATEGORY: Record<string, BusinessCategory> = {
  dairy: 'dairy',
  poultry: 'poultry',
  tailoring: 'textiles',
  textiles: 'textiles',
  food_processing: 'food',
  retail: 'retail',
}

export type FeasibilityInputKey =
  | 'applicant_name'
  | 'age'
  | 'gender'
  | 'social_category'
  | 'annual_income'
  | 'business_sector'
  | 'loan_amount'
  | 'district'
  | 'experience_years'

export interface FeasibilityMissing {
  key: FeasibilityInputKey
  label: string
  question: string
}

const MISSING_META: Record<FeasibilityInputKey, Omit<FeasibilityMissing, 'key'>> = {
  applicant_name: { label: 'Applicant name', question: 'What is your full name, as written on your Aadhaar?' },
  age: { label: 'Age', question: 'How old are you?' },
  gender: { label: 'Gender', question: 'May I record your gender?' },
  social_category: { label: 'Social category', question: 'Which social category do you belong to: SC, ST, OBC or General?' },
  annual_income: { label: 'Family income', question: "What is your family's yearly income, roughly?" },
  business_sector: { label: 'Business type', question: 'What kind of business is it, for example dairy, tailoring or a shop?' },
  loan_amount: { label: 'Loan or own contribution', question: 'How much loan do you need?' },
  district: { label: 'District', question: 'Which district is the business in? I use it for the local market check.' },
  experience_years: { label: 'Experience', question: 'How many years of experience do you have in this line of work?' },
}

export type MarginBasis = 'own_contribution' | 'project_cost' | 'loan_need'

const MARGIN_BASIS_LABEL: Record<MarginBasis, string> = {
  own_contribution: 'Your stated own contribution',
  project_cost: 'NSFDC 10% margin on your stated project cost',
  loan_need: 'NSFDC 10% margin implied by your loan need (loan is 90% of project cost)',
}

export interface FeasibilityInputs {
  profile: EntrepreneurProfile
  location: { mode: 'curated'; villageId: string } | { mode: 'live'; query: string }
  marginBasis: MarginBasis
  signature: string
}

export type FeasibilityReadiness =
  | { ready: true; inputs: FeasibilityInputs }
  | { ready: false; missing: FeasibilityMissing[]; unsupportedReason?: string }

const MODELLED = 'The LokScore market model covers dairy, poultry, tailoring and textiles, food processing and retail shops'

/**
 * The application data mapped onto the main prototype's EntrepreneurProfile.
 * Nothing is defaulted: a missing input is asked for, and a business type the
 * LokScore model does not cover is reported as such rather than scored.
 */
export function feasibilityReadiness(profile: UserProfile, details: ApplicantDetails): FeasibilityReadiness {
  const missing: FeasibilityInputKey[] = []
  if (!details.applicantName) missing.push('applicant_name')
  if (profile.age === undefined) missing.push('age')
  if (!profile.gender) missing.push('gender')
  if (!profile.socialCategory) missing.push('social_category')
  if (profile.annualIncome === undefined) missing.push('annual_income')
  if (!profile.businessSector) missing.push('business_sector')

  let availableMargin: number | undefined
  let marginBasis: MarginBasis | undefined
  const need = effectiveFinancingNeed(profile)
  if (profile.ownContribution !== undefined && profile.ownContribution > 0) {
    availableMargin = profile.ownContribution
    marginBasis = 'own_contribution'
  } else if (profile.investmentRequired !== undefined && profile.investmentRequired > 0) {
    availableMargin = Math.round(profile.investmentRequired * MARGIN_RATIO)
    marginBasis = 'project_cost'
  } else if (need !== undefined && need > 0) {
    availableMargin = Math.round((need * MARGIN_RATIO) / LOAN_RATIO)
    marginBasis = 'loan_need'
  } else missing.push('loan_amount')

  const village = details.curatedVillageId ? VILLAGES.find((v) => v.id === details.curatedVillageId) : undefined
  if (!village && !profile.district) missing.push('district')
  if (details.experienceYears === undefined) missing.push('experience_years')

  const category = profile.businessSector ? LOKSCORE_CATEGORY[profile.businessSector] : undefined
  const unsupportedReason =
    profile.businessSector && !category
      ? `${MODELLED}; ${normalizeSectorLabel(profile.businessSector)} is not modelled, so no LokScore is computed for it.`
      : undefined

  if (missing.length > 0 || unsupportedReason || !category || availableMargin === undefined || !marginBasis) {
    return { ready: false, missing: missing.map((key) => ({ key, ...MISSING_META[key] })), ...(unsupportedReason ? { unsupportedReason } : {}) }
  }

  const location: FeasibilityInputs['location'] = village
    ? { mode: 'curated', villageId: village.id }
    : { mode: 'live', query: [profile.district, profile.state].filter(Boolean).join(', ') }
  const entrepreneur: EntrepreneurProfile = {
    name: details.applicantName!,
    age: profile.age!,
    gender: profile.gender!,
    community: profile.socialCategory!,
    annualIncome: profile.annualIncome!,
    experienceYears: details.experienceYears!,
    villageId: village?.id ?? '',
    category,
    availableMargin,
    phone: details.mobile,
    locationMode: location.mode,
    ...(location.mode === 'live' ? { liveQuery: location.query } : {}),
    radiusKm: REACH_KM.default,
  }
  return {
    ready: true,
    inputs: { profile: entrepreneur, location, marginBasis, signature: JSON.stringify({ entrepreneur, location, marginBasis }) },
  }
}

export interface MatrixRow {
  id: 'demand' | 'competitionGap' | 'weather' | 'finance' | 'eligibility'
  label: string
  score: number
  weightPercent: number
  weighted: number
  basis: string[]
}

export interface FeasibilityReport {
  signature: string
  computedAt: string
  inputs: {
    name: string
    age: number
    gender: EntrepreneurProfile['gender']
    community: EntrepreneurProfile['community']
    annualIncome: number
    experienceYears: number
    category: BusinessCategory
    categoryLabel: string
    availableMargin: number
    marginBasis: MarginBasis
    marginBasisLabel: string
    locationRequested: string
  }
  location: {
    name: string
    district: string
    provenance: ResolvedLocation['provenance']
    provenanceLabel: string
    radiusKm: number
    lat: number
    lng: number
    competitorCount: number
    competitorQueryOk: boolean
    geocodeOk: boolean
    notes: string
  }
  weather: WeatherSignal
  mandi: MandiSignal | null
  plan: {
    schemeId: string
    schemeName: string
    projectCost: number
    loanAmount: number
    marginRequired: number
    interestRate: number
    tenureYears: number
    moratoriumMonths: number
    quarterlyEmi: number
    repaymentQuarters: number
  }
  lokScore: LokScoreBreakdown
  matrix: MatrixRow[]
  swot: { strengths: string[]; weaknesses: string[]; opportunities: string[]; threats: string[] }
  channels: string[]
  saturationLabel: string
  priceEmiNote: string | null
  reach: number | null
  failedSources: LiveSourceId[]
  dataStatus: 'complete' | 'incomplete'
  notes: string[]
}

export interface FeasibilityDeps {
  resolveCurated: (villageId: string, category: BusinessCategory, radiusKm: number) => Promise<ResolvedLocation>
  resolveLive: typeof resolveLiveLocation
  fetchWeather: (lat: number, lng: number) => Promise<WeatherSignal>
  fetchMandi: (location: ResolvedLocation, category: BusinessCategory) => Promise<MandiSignal | null>
  now: () => Date
}

export const DEFAULT_FEASIBILITY_DEPS: FeasibilityDeps = {
  resolveCurated: (villageId, category, radiusKm) => resolveCuratedVillage(villageId, category, radiusKm),
  resolveLive: resolveLiveLocation,
  fetchWeather,
  fetchMandi: fetchMandiSignal,
  now: () => new Date(),
}

const LABELS: Record<MatrixRow['id'], string> = {
  demand: 'Local demand',
  competitionGap: 'Competition gap',
  weather: 'Weather fit',
  finance: 'Financial fit (repayment)',
  eligibility: 'NSFDC mandate fit',
}

export type FeasibilityResult = { ok: true; report: FeasibilityReport } | { ok: false; reason: string }

/** Main's scan pipeline: location → weather → mandi → NSFDC plan → LokScore → feasibility. */
export async function computeFeasibilityReport(
  inputs: FeasibilityInputs,
  deps: FeasibilityDeps = DEFAULT_FEASIBILITY_DEPS,
): Promise<FeasibilityResult> {
  const { profile } = inputs
  let location: ResolvedLocation
  if (inputs.location.mode === 'curated') {
    location = await deps.resolveCurated(inputs.location.villageId, profile.category, profile.radiusKm)
  } else {
    const live = await deps.resolveLive({ query: inputs.location.query, category: profile.category, radiusKm: profile.radiusKm })
    if (!live.ok) return { ok: false, reason: `${live.error} Location searched: "${inputs.location.query}".` }
    location = live.location
  }

  let weather: WeatherSignal
  try {
    weather = await deps.fetchWeather(location.lat, location.lng)
  } catch {
    weather = unavailableWeather()
  }
  const mandi = await deps.fetchMandi(location, profile.category)
  const now = deps.now()
  const plan = buildSchemePlan(profile.availableMargin, now)
  const lokScore = computeLokScore({ profile, location, weather, mandi, plan })
  const feasibility = buildFeasibility({ profile, location, weather, mandi, plan, lang: 'en' })
  const failedSources = collectFailedSources(location, weather, false)
  const w = lokScore.weights

  const matrix: MatrixRow[] = [
    { id: 'demand', score: lokScore.demand, weight: w.demand, basis: [lokScore.rationale[0]] },
    { id: 'competitionGap', score: lokScore.competitionGap, weight: w.competitionGap, basis: [lokScore.rationale[1]] },
    { id: 'weather', score: lokScore.weatherFit, weight: w.weather, basis: [lokScore.rationale[2]] },
    { id: 'finance', score: lokScore.financialFit, weight: w.finance, basis: [lokScore.rationale[3]] },
    { id: 'eligibility', score: lokScore.eligibility, weight: w.eligibility, basis: scoreEligibility(profile).notes },
  ].map(({ id, score, weight, basis }) => ({
    id: id as MatrixRow['id'],
    label: LABELS[id as MatrixRow['id']],
    score,
    weightPercent: Math.round(weight * 100),
    weighted: Math.round(score * weight * 10) / 10,
    basis,
  }))

  const notes = [
    'LokScore is the main Ishaara prototype\'s feasibility score. It is separate from the government criteria report and does not decide scheme eligibility.',
    'Its eligibility component follows the NSFDC mandate (SC applicants, income up to ₹5 lakh), whichever scheme is being applied for.',
  ]
  if (inputs.marginBasis !== 'own_contribution') {
    notes.push(`Margin of ${formatRupees(profile.availableMargin)} is derived: ${MARGIN_BASIS_LABEL[inputs.marginBasis]}.`)
  }
  if (mandi?.source === 'seeded') notes.push('The mandi price signal is curated seed data for this village, not a live market feed.')
  if (location.purchasingPowerIndex == null) notes.push('Purchasing power for this location is unknown, so demand uses a neutral baseline.')

  return {
    ok: true,
    report: {
      signature: inputs.signature,
      computedAt: now.toISOString(),
      inputs: {
        name: profile.name,
        age: profile.age,
        gender: profile.gender,
        community: profile.community,
        annualIncome: profile.annualIncome,
        experienceYears: profile.experienceYears,
        category: profile.category,
        categoryLabel: BUSINESS_META[profile.category].label,
        availableMargin: profile.availableMargin,
        marginBasis: inputs.marginBasis,
        marginBasisLabel: MARGIN_BASIS_LABEL[inputs.marginBasis],
        locationRequested: inputs.location.mode === 'curated' ? location.name : inputs.location.query,
      },
      location: {
        name: location.name,
        district: location.district,
        provenance: location.provenance,
        provenanceLabel: location.provenanceLabelEn,
        radiusKm: location.radiusKm,
        lat: location.lat,
        lng: location.lng,
        competitorCount: location.competitors.length,
        competitorQueryOk: location.competitorQueryOk,
        geocodeOk: location.geocodeOk !== false,
        notes: location.notes,
      },
      weather,
      mandi,
      plan: {
        schemeId: plan.schemeId,
        schemeName: plan.schemeName,
        projectCost: plan.projectCost,
        loanAmount: plan.loanAmount,
        marginRequired: plan.marginRequired,
        interestRate: plan.interestRate,
        tenureYears: plan.tenureYears,
        moratoriumMonths: plan.moratoriumMonths,
        quarterlyEmi: plan.quarterlyEmi,
        repaymentQuarters: plan.repaymentQuarters,
      },
      lokScore,
      matrix,
      swot: {
        strengths: feasibility.strengths,
        weaknesses: feasibility.weaknesses,
        opportunities: feasibility.opportunities,
        threats: feasibility.threats,
      },
      channels: feasibility.channels,
      saturationLabel: feasibility.saturationLabel,
      priceEmiNote: feasibility.pricing.sourcedFromMandi ? feasibility.priceEmiNote : null,
      reach: feasibility.reach,
      failedSources,
      dataStatus: dataStatusFromFailures(failedSources),
      notes,
    },
  }
}

export type FeasibilityState =
  | { status: 'waiting'; missing: FeasibilityMissing[] }
  | { status: 'unsupported'; reason: string }
  | { status: 'disabled'; reason: string }
  | { status: 'computing' }
  | { status: 'ready'; report: FeasibilityReport }
  | { status: 'failed'; reason: string }
