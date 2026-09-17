import { evaluateEligibility } from './eligibility'
import { defaultRetriever, type RetrievalQuery, type SchemeRetriever } from './retrieval'
import type { EligibilityStatus, RankedScheme, UserProfile } from './types'

export const STATUS_WEIGHT: Record<EligibilityStatus, number> = {
  likely_eligible: 3,
  possibly_eligible: 2,
  insufficient_data: 1,
  likely_ineligible: 0,
}

/** The single sort rule for any ranked list: status tier first (an ineligible scheme never outranks an uncertain-but-plausible one), rankScore as the tiebreaker within a tier. Shared so re-sorting after a merge (see evidenceMerge.ts) can't accidentally drop the status-first invariant. */
export function compareRanked(a: RankedScheme, b: RankedScheme): number {
  const statusDiff = STATUS_WEIGHT[b.eligibility.status] - STATUS_WEIGHT[a.eligibility.status]
  if (statusDiff !== 0) return statusDiff
  return b.rankScore - a.rankScore
}

/**
 * Combines retrieval relevance with the deterministic eligibility score into
 * one ranking. Eligibility dominates (70%) — a scheme that is a poor
 * eligibility match should not outrank a strong one just because it shares
 * more keywords with the query. Status is the primary sort key so a clearly
 * ineligible scheme never outranks an uncertain-but-plausible one.
 */
export function rankSchemes(
  profile: UserProfile,
  queryText?: string,
  retriever: SchemeRetriever = defaultRetriever,
): RankedScheme[] {
  const query: RetrievalQuery = { profile, queryText }
  const retrieved = retriever.retrieve(query)

  const ranked: RankedScheme[] = retrieved.map((r) => {
    const eligibility = evaluateEligibility(profile, r.scheme)
    const rankScore = Math.round(eligibility.score * 0.7 + r.relevance * 0.3)
    return { scheme: r.scheme, eligibility, relevance: r.relevance, rankScore }
  })

  return ranked.sort(compareRanked)
}
