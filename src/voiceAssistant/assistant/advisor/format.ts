import { DOCUMENT_KIND_LABEL, type DocumentDeclarations, type DocumentKind } from '../../application/documents'
import type { ApplicantDetails } from '../../application/extraction'
import { formatRupees } from '../../application/requirements'
import type { RecommendationReadiness } from '../../../assistant/conversation/readiness'
import { normalizeSectorLabel } from '../../../assistant/lexicon'
import type { EligibilityStatus, UserProfile } from '../../../assistant/types'

export { formatRupees }

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

const CATEGORY: Record<string, string> = { sc: 'SC', st: 'ST', obc: 'OBC', general: 'General' }
const STAGE: Record<string, string> = { idea: 'Idea stage', new: 'New business', existing_expansion: 'Expanding existing' }

export const STATUS_LABEL: Record<EligibilityStatus, string> = {
  likely_eligible: 'Likely eligible',
  possibly_eligible: 'Possibly eligible',
  insufficient_data: 'Needs more details',
  likely_ineligible: 'Not eligible',
}

export const READINESS_LABEL: Record<RecommendationReadiness, string> = {
  exploratory: 'Exploring',
  preliminary: 'Preliminary match',
  actionable: 'Ready to act',
  application_ready: 'Ready to apply',
}

export interface ProfileFact {
  key: string
  label: string
  value: string
}

/**
 * Every fact on file, in the order an advisor would read them back.
 * existingLoans is left out: eligibility never uses it, and it is recorded
 * only for a loan the citizen already has.
 */
export function profileFacts(profile: UserProfile, details: ApplicantDetails, documents: DocumentDeclarations = {}): ProfileFact[] {
  const facts: ProfileFact[] = []
  const add = (key: string, label: string, value: string | undefined) => {
    if (value) facts.push({ key, label, value })
  }
  add('applicantName', 'Name', details.applicantName)
  add('mobile', 'Mobile', details.mobile)
  add('age', 'Age', profile.age !== undefined ? `${profile.age} years` : undefined)
  add('gender', 'Gender', profile.gender ? capitalize(profile.gender) : undefined)
  add('state', 'State', profile.state)
  add('district', 'District', profile.district)
  add('areaType', 'Area', profile.areaType ? capitalize(profile.areaType) : undefined)
  add('socialCategory', 'Category', profile.socialCategory ? CATEGORY[profile.socialCategory] : undefined)
  add('annualIncome', 'Family income', profile.annualIncome !== undefined ? `${formatRupees(profile.annualIncome)} / year` : undefined)
  add('businessSector', 'Sector', profile.businessSector ? capitalize(normalizeSectorLabel(profile.businessSector)) : undefined)
  add('proposedBusiness', 'Business idea', profile.proposedBusiness ? capitalize(profile.proposedBusiness) : undefined)
  add('businessStage', 'Stage', profile.businessStage ? STAGE[profile.businessStage] : undefined)
  add('financingRequired', 'Loan needed', profile.financingRequired !== undefined ? formatRupees(profile.financingRequired) : undefined)
  add('investmentRequired', 'Project cost', profile.investmentRequired !== undefined ? formatRupees(profile.investmentRequired) : undefined)
  add('ownContribution', 'Own contribution', profile.ownContribution !== undefined ? formatRupees(profile.ownContribution) : undefined)
  add('education', 'Education', profile.education ? capitalize(profile.education) : undefined)
  add('experienceYears', 'Experience', details.experienceYears !== undefined ? `${details.experienceYears} years` : undefined)
  add('nhgMembership', 'NHG membership', details.nhgMembership)
  add('landOrAssets', 'Land / assets', profile.landOrAssets)
  for (const [kind, declaration] of Object.entries(documents)) {
    add(`document:${kind}`, DOCUMENT_KIND_LABEL[kind as DocumentKind], declaration === 'missing' ? 'Does not have it yet' : 'Has it')
  }
  return facts
}
