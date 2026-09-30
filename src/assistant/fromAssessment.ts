import { INDIAN_STATES } from './lexicon'
import type { UserProfile } from './types'
import { BUSINESS_META, type BusinessCategory } from '../data/villages'
import type { SchemePlan } from '../lib/finance'
import type { EntrepreneurProfile, LokScoreBreakdown } from '../lib/lokScore'
import type { ResolvedLocation } from '../lib/resolveLocation'

const SECTOR_BY_CATEGORY: Record<BusinessCategory, string> = {
  dairy: 'dairy',
  retail: 'retail',
  food: 'food_processing',
  // The scan's "Textiles / Tailoring" category. A profile carries one sector
  // tag, and 'tailoring' is the one PM Vishwakarma lists (Tailor/Darzi is one
  // of its 18 trades), so a tailor who came through /scan still reaches it.
  textiles: 'tailoring',
  poultry: 'poultry',
  agri_processing: 'food_processing',
}

const DISTRICT_STATE: Record<string, string> = {
  Mandya: 'Karnataka',
  Dharwad: 'Karnataka',
  Belagavi: 'Karnataka',
  Hassan: 'Karnataka',
  Tumakuru: 'Karnataka',
  Nashik: 'Maharashtra',
}

function inferState(district: string): string | undefined {
  if ((INDIAN_STATES as readonly string[]).includes(district)) return district
  return DISTRICT_STATE[district]
}

/** Seed the scheme assistant from a LokPulse scan — not a general chatbot. */
export function profileFromAssessment(input: {
  profile: EntrepreneurProfile
  location: ResolvedLocation
  plan: SchemePlan
  score: LokScoreBreakdown
}): UserProfile {
  const p = input.profile
  const loc = input.location
  const meta = BUSINESS_META[p.category]
  return {
    age: p.age,
    gender: p.gender,
    socialCategory: p.community,
    annualIncome: p.annualIncome,
    proposedBusiness: meta.label,
    businessSector: SECTOR_BY_CATEGORY[p.category],
    businessStatus: 'idea',
    businessStage: 'new',
    ownContribution: p.availableMargin,
    investmentRequired: input.plan.projectCost,
    financingRequired: input.plan.loanAmount,
    district: loc.district,
    state: inferState(loc.district),
    areaType: 'rural',
    occupation: meta.label,
    rawNotes: [
      `Ishara scan for ${p.name} in ${loc.name}, ${loc.district}: ${meta.label}, LokScore ${input.score.total}/${input.score.grade}, ${input.plan.schemeName}.`,
    ],
  }
}
