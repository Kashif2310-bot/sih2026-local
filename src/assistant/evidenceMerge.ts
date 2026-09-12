/**
 * Merges live evidence into the deterministically-ranked local schemes.
 *
 * Deliberately narrow: live evidence only ever ATTACHES to a scheme that
 * already exists in the curated local dataset (matched by id) — it never
 * creates a new, thin "scheme" record out of live data alone. The data
 * actually available from data.gov.in (see README) is statistical/
 * performance context (e.g. units sanctioned in a state), not eligibility
 * rules, loan amounts, or application steps, so it would be dishonest to
 * present it as a full scheme entry. This is the "deduplicate by scheme,
 * preserve the verified local record" rule from the target architecture.
 *
 * Live evidence never touches eligibility.score (the deterministic engine
 * stays profile-vs-scheme-criteria only, per eligibility.ts) — it only
 * gets a small relevance bump, on the theory that a scheme with fresh,
 * verifiable real-world activity in the user's state is modestly more
 * worth surfacing prominently, never that it changes whether the user
 * qualifies.
 */

import { compareRanked } from './ranking'
import type { LiveEvidenceItem, RankedScheme } from './types'

export const LIVE_EVIDENCE_RELEVANCE_BONUS = 6

export function mergeLiveEvidence(ranked: RankedScheme[], liveEvidence: LiveEvidenceItem[]): RankedScheme[] {
  if (liveEvidence.length === 0) return ranked

  const bySchemeId = new Map<string, LiveEvidenceItem[]>()
  for (const item of liveEvidence) {
    const list = bySchemeId.get(item.schemeId)
    if (list) list.push(item)
    else bySchemeId.set(item.schemeId, [item])
  }

  return ranked
    .map((r) => {
      const evidence = bySchemeId.get(r.scheme.id)
      if (!evidence || evidence.length === 0) return r
      return {
        ...r,
        liveEvidence: evidence,
        relevance: Math.min(100, r.relevance + LIVE_EVIDENCE_RELEVANCE_BONUS),
        rankScore: Math.min(100, r.rankScore + LIVE_EVIDENCE_RELEVANCE_BONUS),
      }
    })
    .sort(compareRanked)
}
