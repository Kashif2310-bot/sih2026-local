/**
 * Deterministic recommendation-readiness assessment.
 *
 * Deliberately NOT "all profile fields filled = ready". Readiness is
 * graduated from the EXISTING deterministic eligibility engine's own
 * output (RankedScheme[].eligibility.status/.confidence, from
 * eligibility.ts, unmodified) plus how many HIGH-materiality fields
 * (questionPolicy.ts's FIELD_MATERIALITY) remain unknown — never a raw
 * "how many fields are set" count. A citizen can be 'actionable' without
 * ever stating their education level, because education never affects
 * eligibility.ts's output at all.
 */

import { FIELD_MATERIALITY } from './questionPolicy'
import type { MissingFieldInfo } from '../missingFields'
import type { RankedScheme, UserProfile } from '../types'

export type RecommendationReadiness = 'exploratory' | 'preliminary' | 'actionable' | 'application_ready'

export interface ReadinessAssessment {
  status: RecommendationReadiness
  rationale: string[]
  /** High-materiality fields still unknown, in missingFields.ts priority order — informational; questionPolicy.ts (not this module) decides what to actually ask next. */
  materialGapsRemaining: Array<keyof UserProfile>
}

function highMaterialityGaps(missingFields: MissingFieldInfo[]): Array<keyof UserProfile> {
  return missingFields.filter((m) => (FIELD_MATERIALITY[m.field] ?? 'medium') === 'high').map((m) => m.field)
}

export interface AssessReadinessInput {
  userProfile: UserProfile
  ranked: RankedScheme[]
  missingFields: MissingFieldInfo[]
}

export function assessReadiness(input: AssessReadinessInput): ReadinessAssessment {
  const { userProfile, ranked, missingFields } = input
  const gaps = highMaterialityGaps(missingFields)
  const hasBusinessIntent = Boolean(userProfile.businessSector || userProfile.proposedBusiness)

  if (!hasBusinessIntent || ranked.length === 0) {
    return {
      status: 'exploratory',
      rationale: ['No business intent captured yet, so no schemes have been matched.'],
      materialGapsRemaining: gaps,
    }
  }

  const top = ranked[0]
  const topIsPromising = top.eligibility.status === 'likely_eligible' || top.eligibility.status === 'possibly_eligible'

  if (!topIsPromising || gaps.length >= 2) {
    return {
      status: 'preliminary',
      rationale: [
        !topIsPromising
          ? `Top match (${top.scheme.name}) status is "${top.eligibility.status}" — not yet a confident match.`
          : `${gaps.length} high-impact fields are still unknown (${gaps.join(', ')}).`,
      ],
      materialGapsRemaining: gaps,
    }
  }

  const topIsHighConfidenceEligible = top.eligibility.status === 'likely_eligible' && top.eligibility.confidence === 'high'

  if (topIsHighConfidenceEligible && gaps.length === 0) {
    return {
      status: 'application_ready',
      rationale: [`Top match (${top.scheme.name}) is likely eligible with high confidence and no high-impact fields remain unknown.`],
      materialGapsRemaining: [],
    }
  }

  return {
    status: 'actionable',
    rationale: [`Top match (${top.scheme.name}) is a ${top.eligibility.status.replace(/_/g, ' ')} with at most one high-impact field still unknown.`],
    materialGapsRemaining: gaps,
  }
}
