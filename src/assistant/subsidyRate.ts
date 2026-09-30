import type { SchemeSubsidyInfo, UserProfile } from './types'

export type ApplicableSubsidyRate =
  | { kind: 'decided'; ratePercent: number; label: string }
  /** Which still-unknown profile facts would decide the rate. */
  | { kind: 'undetermined'; decidedBy: Array<'socialCategory' | 'gender'> }

/**
 * The subsidy rate that applies to this applicant, for a scheme whose rate
 * depends on who they are (SchemeSubsidyInfo.applicantTiers). Decided only
 * from what the applicant actually stated, never assumed: a General-category
 * applicant whose gender is unknown could still be a woman, so their rate
 * stays undetermined. Returns null for a scheme whose rate is the same for
 * everyone.
 */
export function applicableSubsidyRate(
  subsidy: SchemeSubsidyInfo | undefined,
  profile: Pick<UserProfile, 'socialCategory' | 'gender'>,
): ApplicableSubsidyRate | null {
  const tiers = subsidy?.applicantTiers
  if (!tiers) return null
  const { socialCategories = [], genders = [] } = tiers.higherRateFor

  const inHigherCategory = profile.socialCategory !== undefined && socialCategories.includes(profile.socialCategory)
  const ofHigherGender = profile.gender !== undefined && genders.includes(profile.gender)
  if (inHigherCategory || ofHigherGender) {
    return { kind: 'decided', ratePercent: tiers.higherRatePercent, label: tiers.higherRateLabel }
  }

  // The standard rate applies only once every fact that could raise it is known and doesn't.
  const categoryPending = socialCategories.length > 0 && profile.socialCategory === undefined
  const genderPending = genders.length > 0 && profile.gender === undefined
  if (!categoryPending && !genderPending) {
    return { kind: 'decided', ratePercent: tiers.standardRatePercent, label: tiers.standardRateLabel }
  }
  return {
    kind: 'undetermined',
    decidedBy: [...(categoryPending ? (['socialCategory'] as const) : []), ...(genderPending ? (['gender'] as const) : [])],
  }
}

/**
 * The subsidy line to show this applicant: just their own rate when it is
 * decided, otherwise the scheme's full description with every rate.
 */
export function describeApplicableSubsidy(
  subsidy: SchemeSubsidyInfo,
  profile: Pick<UserProfile, 'socialCategory' | 'gender'>,
): string {
  const rate = applicableSubsidyRate(subsidy, profile)
  if (rate?.kind !== 'decided') return subsidy.description
  return `${rate.ratePercent}% of the ${subsidy.applicantTiers!.rateOf} — the ${rate.label} rate, which applies to you.`
}
