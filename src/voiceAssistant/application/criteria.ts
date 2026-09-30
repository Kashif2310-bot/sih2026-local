import { evaluateEligibility } from '../../assistant/eligibility'
import { normalizeSectorLabel } from '../../assistant/lexicon'
import { effectiveFinancingNeed } from '../../assistant/missingFields'
import type { EligibilityResult, GovernmentScheme, SocialCategory, UserProfile } from '../../assistant/types'
import { formatRupees } from './requirements'

/**
 * satisfied / not_met / needs_information mirror the main eligibility
 * engine's pass, hard mismatch and missing data. needs_verification is the
 * engine's soft mismatch (it lowers the score but does not rule the applicant
 * out); informational rows are stated by the scheme but not evaluated.
 */
export type CriterionStatus = 'satisfied' | 'not_met' | 'needs_information' | 'needs_verification' | 'informational'

export const CRITERION_LABEL: Record<CriterionStatus, string> = {
  satisfied: 'Meets',
  not_met: 'Does not meet',
  needs_information: 'Needs information',
  needs_verification: 'Needs verification',
  informational: 'For reference',
}

export interface CriterionRow {
  id: string
  label: string
  requirement: string
  applicantValue: string | null
  status: CriterionStatus
  note?: string
}

export interface CriteriaReport {
  schemeId: string
  schemeName: string
  ministry: string
  scope: GovernmentScheme['scope']
  criteria: CriterionRow[]
  counts: Record<CriterionStatus, number>
  schemeNotes: string[]
  benefits: { loan?: string; subsidy?: string; interest?: string }
  documentsListed: string[]
  eligibility: Pick<EligibilityResult, 'status' | 'score' | 'confidence'>
  source: { name: string; url: string; lastVerifiedDate: string; dataStatus: string }
}

const CATEGORY: Record<SocialCategory, string> = { sc: 'SC', st: 'ST', obc: 'OBC', general: 'General' }
const cap = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

function row(
  id: string,
  label: string,
  requirement: string,
  applicantValue: string | null | undefined,
  status: CriterionStatus,
  note?: string,
): CriterionRow {
  return { id, label, requirement, applicantValue: applicantValue ?? null, status, ...(note ? { note } : {}) }
}

function demographicRows(profile: UserProfile, scheme: GovernmentScheme): CriterionRow[] {
  const { genders, socialCategories, eligibleIfAny } = scheme.eligibility
  const rows: CriterionRow[] = []
  const applicant = [profile.gender ? cap(profile.gender) : null, profile.socialCategory ? CATEGORY[profile.socialCategory] : null]
    .filter(Boolean)
    .join(', ')

  if (eligibleIfAny && eligibleIfAny.length > 0) {
    const describe = eligibleIfAny
      .map((group) =>
        [group.genders?.map((g) => (g === 'female' ? 'a woman' : g)).join(' or '), group.socialCategories?.map((c) => CATEGORY[c]).join('/')]
          .filter(Boolean)
          .join(' and '),
      )
      .join(', or ')
    const results = eligibleIfAny.map((group) => {
      const parts: Array<boolean | undefined> = []
      if (group.genders) parts.push(profile.gender === undefined ? undefined : group.genders.includes(profile.gender))
      if (group.socialCategories) parts.push(profile.socialCategory === undefined ? undefined : group.socialCategories.includes(profile.socialCategory))
      if (parts.includes(false)) return false
      return parts.length > 0 && parts.every((p) => p === true) ? true : undefined
    })
    const status: CriterionStatus = results.includes(true) ? 'satisfied' : results.every((r) => r === false) ? 'not_met' : 'needs_information'
    rows.push(row('demographic_any', 'Who can apply', `Applicant must be ${describe}`, applicant || null, status))
    return rows
  }

  if (genders) {
    rows.push(
      row(
        'gender',
        'Gender',
        `Open to ${genders.map((g) => (g === 'female' ? 'women' : g)).join(' / ')}`,
        profile.gender ? cap(profile.gender) : null,
        profile.gender === undefined ? 'needs_information' : genders.includes(profile.gender) ? 'satisfied' : 'not_met',
      ),
    )
  }
  if (socialCategories) {
    rows.push(
      row(
        'social_category',
        'Social category',
        `For ${socialCategories.map((c) => CATEGORY[c]).join(' / ')} applicants`,
        profile.socialCategory ? CATEGORY[profile.socialCategory] : null,
        profile.socialCategory === undefined ? 'needs_information' : socialCategories.includes(profile.socialCategory) ? 'satisfied' : 'not_met',
      ),
    )
  }
  return rows
}

/**
 * The scheme's own eligibility rules, row by row, against what the applicant
 * told Ishaara. Built from the curated scheme record the matcher uses, so the
 * report and the match can never disagree.
 */
export function buildCriteriaReport(profile: UserProfile, scheme: GovernmentScheme): CriteriaReport {
  const e = scheme.eligibility
  const criteria: CriterionRow[] = []

  if (scheme.scope === 'state') {
    criteria.push(
      row(
        'state',
        'State',
        `Resident of ${scheme.state}`,
        profile.state,
        !profile.state ? 'needs_information' : scheme.state && profile.state.toLowerCase() === scheme.state.toLowerCase() ? 'satisfied' : 'not_met',
      ),
    )
  } else if (e.states && e.states.length > 0) {
    criteria.push(
      row(
        'state',
        'State',
        `Available in ${e.states.join(', ')}`,
        profile.state,
        !profile.state ? 'needs_information' : e.states.some((s) => s.toLowerCase() === profile.state!.toLowerCase()) ? 'satisfied' : 'not_met',
      ),
    )
  } else {
    criteria.push(row('state', 'State', 'Central scheme, available in every state', profile.state, 'informational'))
  }

  if (e.areaTypes) {
    criteria.push(
      row(
        'area_type',
        'Area',
        `For ${e.areaTypes.join(' / ')} applicants`,
        profile.areaType ? cap(profile.areaType) : null,
        !profile.areaType ? 'needs_information' : e.areaTypes.includes(profile.areaType) ? 'satisfied' : 'not_met',
      ),
    )
  }

  if (e.minAge !== undefined || e.maxAge !== undefined) {
    const min = e.minAge ?? 0
    const max = e.maxAge ?? 200
    const label = e.maxAge !== undefined ? `${min} to ${max} years` : `${min} years or older`
    criteria.push(
      row(
        'age',
        'Age',
        label,
        profile.age !== undefined ? `${profile.age} years` : null,
        profile.age === undefined ? 'needs_information' : profile.age >= min && profile.age <= max ? 'satisfied' : 'not_met',
      ),
    )
  }

  criteria.push(...demographicRows(profile, scheme))

  if (e.maxAnnualIncome !== undefined) {
    criteria.push(
      row(
        'income',
        'Family income',
        `At most ${formatRupees(e.maxAnnualIncome)} a year`,
        profile.annualIncome !== undefined ? `${formatRupees(profile.annualIncome)} a year` : null,
        profile.annualIncome === undefined ? 'needs_information' : profile.annualIncome <= e.maxAnnualIncome ? 'satisfied' : 'not_met',
      ),
    )
  }

  const sector = profile.businessSector ? cap(normalizeSectorLabel(profile.businessSector)) : null
  if (e.businessSectors && !e.businessSectors.includes('any')) {
    const listed = e.businessSectors.map((s) => normalizeSectorLabel(s)).join(', ')
    let status: CriterionStatus = 'needs_information'
    let note: string | undefined
    if (profile.businessSector) {
      if (e.excludedBusinessSectors?.includes(profile.businessSector)) status = 'not_met'
      else if (e.businessSectors.includes(profile.businessSector)) status = 'satisfied'
      else {
        status = 'needs_verification'
        note = 'Not in the documented sector list. It may still qualify; the implementing agency decides.'
      }
    }
    criteria.push(row('sector', 'Business sector', `Documented sectors: ${listed}`, sector, status, note))
  } else if (e.excludedBusinessSectors && e.excludedBusinessSectors.length > 0) {
    criteria.push(
      row(
        'sector',
        'Business sector',
        `Any activity except: ${e.excludedBusinessSectors.map((s) => normalizeSectorLabel(s)).join(', ')}`,
        sector,
        !profile.businessSector ? 'needs_information' : e.excludedBusinessSectors.includes(profile.businessSector) ? 'not_met' : 'satisfied',
      ),
    )
  }

  if (e.businessStages) {
    const stages = e.businessStages.map((s) => (s === 'existing_expansion' ? 'expansion of an existing business' : s === 'idea' ? 'idea stage' : 'new business'))
    criteria.push(
      row(
        'stage',
        'Business stage',
        e.requiresGreenfield ? 'A new (greenfield) enterprise only' : `For: ${stages.join(', ')}`,
        profile.businessStage ? (profile.businessStage === 'existing_expansion' ? 'Expanding existing' : profile.businessStage === 'idea' ? 'Idea stage' : 'New business') : null,
        !profile.businessStage ? 'needs_information' : e.businessStages.includes(profile.businessStage) ? 'satisfied' : 'not_met',
      ),
    )
  }

  const need = effectiveFinancingNeed(profile)
  const loan = scheme.loanAmount
  if (loan?.maxRupees !== undefined || loan?.minRupees !== undefined) {
    const range =
      loan.minRupees !== undefined && loan.maxRupees !== undefined
        ? `${formatRupees(loan.minRupees)} to ${formatRupees(loan.maxRupees)}`
        : loan.maxRupees !== undefined
          ? `Up to ${formatRupees(loan.maxRupees)}`
          : `From ${formatRupees(loan.minRupees!)}`
    let status: CriterionStatus = 'informational'
    let note: string | undefined
    if (need === undefined) {
      if (loan.maxRupees !== undefined) status = 'needs_information'
    } else if (loan.maxRupees !== undefined && need > loan.maxRupees * 1.15) {
      status = 'needs_verification'
      note = 'Above the documented ceiling; the rest may need another source of finance.'
    } else if (loan.minRupees !== undefined && need < loan.minRupees) {
      status = 'needs_verification'
      note = 'Below the documented minimum loan size.'
    } else if (loan.maxRupees !== undefined) {
      status = 'satisfied'
    }
    criteria.push(row('loan', 'Loan amount', range, need !== undefined ? formatRupees(need) : null, status, note ?? loan.notes))
  }

  if (e.minEducationNote) {
    criteria.push(
      row('education', 'Education', e.minEducationNote, profile.education ? cap(profile.education) : null, 'informational', 'Stated by the scheme; checked by the implementing agency.'),
    )
  }

  const counts: Record<CriterionStatus, number> = { satisfied: 0, not_met: 0, needs_information: 0, needs_verification: 0, informational: 0 }
  for (const criterion of criteria) counts[criterion.status] += 1

  const result = evaluateEligibility(profile, scheme)
  return {
    schemeId: scheme.id,
    schemeName: scheme.name,
    ministry: scheme.ministry,
    scope: scheme.scope,
    criteria,
    counts,
    schemeNotes: e.notes ? [e.notes] : [],
    benefits: {
      ...(loan?.notes || loan?.maxRupees !== undefined ? { loan: loan?.notes ?? `Up to ${formatRupees(loan!.maxRupees!)}` } : {}),
      ...(scheme.subsidy ? { subsidy: scheme.subsidy.description } : {}),
      ...(scheme.interest?.notes ? { interest: scheme.interest.notes } : {}),
    },
    documentsListed: scheme.documents,
    eligibility: { status: result.status, score: result.score, confidence: result.confidence },
    source: {
      name: scheme.source,
      url: scheme.sourceUrl,
      lastVerifiedDate: scheme.lastVerifiedDate,
      dataStatus: 'Curated reference data from public scheme guidelines, not a live government feed',
    },
  }
}
