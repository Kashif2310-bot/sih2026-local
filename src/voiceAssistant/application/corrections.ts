import { INDIAN_STATES, SECTOR_KEYWORDS } from '../../assistant/lexicon'
import type { UserProfile } from '../../assistant/types'
import { normalizeNumbers, type ApplicantDetails } from './extraction'

export type CorrectionResult =
  | { ok: true; profile: UserProfile; details: ApplicantDetails }
  | { ok: false; error: string }

/** "2.5 lakh", "₹3,00,000", "three lakh" → rupees. */
export function parseRupees(raw: string): number | undefined {
  const match = normalizeNumbers(raw)
    .toLowerCase()
    .match(/^\s*(?:₹|rs\.?|inr)?\s*(\d[\d,]*(?:\.\d+)?)\s*(lakhs?|lacs?|crores?|thousand|k)?\s*(?:rupees?)?\s*$/)
  if (!match) return undefined
  const value = Number(match[1].replace(/,/g, ''))
  if (!Number.isFinite(value)) return undefined
  const unit = match[2] ?? ''
  const multiplier = unit.startsWith('lakh') || unit.startsWith('lac') ? 100_000 : unit.startsWith('crore') ? 10_000_000 : unit === 'thousand' || unit === 'k' ? 1_000 : 1
  return Math.round(value * multiplier)
}

const titleCase = (text: string) => text.replace(/\S+/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())

function sectorTag(raw: string): string | undefined {
  const lower = raw.trim().toLowerCase().replace(/\s+/g, '_')
  if (lower in SECTOR_KEYWORDS) return lower
  const spaced = raw.trim().toLowerCase()
  return Object.entries(SECTOR_KEYWORDS).find(([, keywords]) => keywords.some((kw) => spaced.includes(kw)))?.[0]
}

type Setter = (value: string, profile: UserProfile, details: ApplicantDetails) => { profile?: Partial<UserProfile>; details?: Partial<ApplicantDetails> } | string

const money = (field: 'annualIncome' | 'financingRequired' | 'ownContribution', label: string): Setter => (value) => {
  const rupees = parseRupees(value)
  return rupees === undefined ? `${label}: enter an amount such as 250000 or 2.5 lakh.` : { profile: { [field]: rupees } }
}

const SETTERS: Record<string, { clear: { profile?: Array<keyof UserProfile>; details?: Array<keyof ApplicantDetails> }; set: Setter }> = {
  applicant_name: {
    clear: { details: ['applicantName'] },
    set: (value) => (value.trim().length < 2 ? 'Name is too short.' : { details: { applicantName: titleCase(value.trim()) } }),
  },
  mobile: {
    clear: { details: ['mobile'] },
    set: (value) => {
      const digits = value.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '')
      return /^[6-9]\d{9}$/.test(digits) ? { details: { mobile: digits } } : 'Mobile number must be 10 digits starting with 6, 7, 8 or 9.'
    },
  },
  nhg_membership: { clear: { details: ['nhgMembership'] }, set: (value) => ({ details: { nhgMembership: value.trim() } }) },
  experience_years: {
    clear: { details: ['experienceYears'] },
    set: (value) => {
      const years = Number(normalizeNumbers(value).replace(/years?/i, '').trim())
      return Number.isFinite(years) && years >= 0 && years < 70 ? { details: { experienceYears: years } } : 'Experience must be a number of years.'
    },
  },
  age: {
    clear: { profile: ['age'] },
    set: (value) => {
      const age = Number(normalizeNumbers(value).trim())
      return Number.isInteger(age) && age > 0 && age < 120 ? { profile: { age } } : 'Age must be a whole number of years.'
    },
  },
  gender: {
    clear: { profile: ['gender'] },
    set: (value) => {
      const v = value.trim().toLowerCase()
      if (/^(f|female|woman|women)$/.test(v)) return { profile: { gender: 'female' } }
      if (/^(m|male|man|men)$/.test(v)) return { profile: { gender: 'male' } }
      if (/^other$/.test(v)) return { profile: { gender: 'other' } }
      return 'Gender: enter female, male or other.'
    },
  },
  social_category: {
    clear: { profile: ['socialCategory'] },
    set: (value) => {
      const v = value.trim().toLowerCase()
      return v === 'sc' || v === 'st' || v === 'obc' || v === 'general' ? { profile: { socialCategory: v } } : 'Category: enter SC, ST, OBC or General.'
    },
  },
  annual_income: { clear: { profile: ['annualIncome'] }, set: money('annualIncome', 'Family income') },
  loan_amount_requested: { clear: { profile: ['financingRequired'] }, set: money('financingRequired', 'Loan amount') },
  own_contribution: { clear: { profile: ['ownContribution'] }, set: money('ownContribution', 'Own contribution') },
  business_sector: {
    clear: { profile: ['businessSector'] },
    set: (value) => {
      const tag = sectorTag(value)
      return tag ? { profile: { businessSector: tag } } : `Business sector: use one of ${Object.keys(SECTOR_KEYWORDS).join(', ').replace(/_/g, ' ')}.`
    },
  },
  proposed_business: { clear: { profile: ['proposedBusiness'] }, set: (value) => ({ profile: { proposedBusiness: value.trim() } }) },
  business_stage: {
    clear: { profile: ['businessStage', 'businessStatus'] },
    set: (value) => {
      const v = value.trim().toLowerCase()
      if (/idea/.test(v)) return { profile: { businessStage: 'idea', businessStatus: 'idea' } }
      if (/expan|existing/.test(v)) return { profile: { businessStage: 'existing_expansion', businessStatus: 'existing' } }
      if (/new/.test(v)) return { profile: { businessStage: 'new', businessStatus: 'idea' } }
      return 'Business stage: enter new, idea or expanding.'
    },
  },
  education: { clear: { profile: ['education'] }, set: (value) => ({ profile: { education: value.trim().toLowerCase() } }) },
  state: {
    clear: { profile: ['state'], details: ['stateInferredFromDistrict'] },
    set: (value) => {
      const state = INDIAN_STATES.find((s) => s.toLowerCase() === value.trim().toLowerCase())
      return state ? { profile: { state }, details: { stateInferredFromDistrict: undefined } } : 'State: enter the full name of an Indian state.'
    },
  },
  district: { clear: { profile: ['district'] }, set: (value) => ({ profile: { district: titleCase(value.trim()) } }) },
  area_type: {
    clear: { profile: ['areaType'] },
    set: (value) => {
      const v = value.trim().toLowerCase()
      if (/rural|village/.test(v)) return { profile: { areaType: 'rural' } }
      if (/urban|city|town/.test(v)) return { profile: { areaType: 'urban' } }
      return 'Area: enter rural or urban.'
    },
  },
}

export const CORRECTABLE_FIELDS = Object.keys(SETTERS)

/** A correction from the review screen, written into the same profile and details that speech updates. */
export function applyCorrection(profile: UserProfile, details: ApplicantDetails, key: string, raw: string): CorrectionResult {
  const setter = SETTERS[key]
  if (!setter) return { ok: false, error: `"${key}" cannot be edited here.` }

  if (!raw.trim()) {
    const nextProfile = { ...profile }
    const nextDetails = { ...details }
    for (const field of setter.clear.profile ?? []) delete nextProfile[field]
    for (const field of setter.clear.details ?? []) delete nextDetails[field]
    return { ok: true, profile: nextProfile, details: nextDetails }
  }

  const result = setter.set(raw, profile, details)
  if (typeof result === 'string') return { ok: false, error: result }
  const nextDetails: ApplicantDetails = { ...details, ...result.details }
  for (const [field, value] of Object.entries(nextDetails)) {
    if (value === undefined) delete nextDetails[field as keyof ApplicantDetails]
  }
  return { ok: true, profile: { ...profile, ...result.profile }, details: nextDetails }
}
