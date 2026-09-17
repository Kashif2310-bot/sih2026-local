/**
 * Deterministic decision of WHEN the conversation should attempt a fresh
 * live-evidence fetch (src/assistant/liveRetrieval.ts, via
 * orchestrator.ts's attemptLiveRetrieval, reused unchanged). Does not touch
 * liveRetrieval.ts itself — this module only decides timing, never how
 * retrieval works.
 *
 * Local, synchronous re-ranking (ranking.ts's rankSchemes) is cheap and is
 * still recomputed every single turn, exactly as the existing text
 * orchestrator already does — nothing here changes that. What this module
 * gates is the comparatively expensive/rate-sensitive live-evidence network
 * call, which must not fire on every sentence when nothing decision-relevant
 * changed.
 */

import type { UserProfile } from '../types'

/**
 * The fields whose change can plausibly shift which schemes are relevant or
 * how they're evaluated — deliberately the same "high materiality" set
 * questionPolicy.ts uses (see FIELD_MATERIALITY there), so "worth asking
 * about" and "worth re-checking evidence for" stay in sync by construction
 * rather than two independently-maintained lists.
 */
export const DECISION_CRITICAL_FIELDS: Array<keyof UserProfile> = [
  'businessSector',
  'state',
  'financingRequired',
  'socialCategory',
  'businessStage',
  'annualIncome',
]

export function snapshotDecisionCriticalFields(profile: UserProfile): Partial<UserProfile> {
  const snapshot: Partial<UserProfile> = {}
  for (const field of DECISION_CRITICAL_FIELDS) {
    Object.assign(snapshot, { [field]: profile[field] })
  }
  return snapshot
}

export interface EvidenceInvalidationResult {
  shouldRefetch: boolean
  reasons: string[]
}

/**
 * `extraSignal`, when given, is an additional free-text reason to refetch
 * that doesn't correspond to a structured field change — e.g. a detected
 * "I only need a subsidy, no loan" statement (see detectFinancingIntentSignal
 * below), which the current UserProfile type has no dedicated field for.
 */
export function checkEvidenceInvalidation(
  lastFetchedSnapshot: Partial<UserProfile> | null,
  currentProfile: UserProfile,
  extraSignal?: string,
): EvidenceInvalidationResult {
  const reasons: string[] = []
  if (extraSignal) reasons.push(extraSignal)

  const hasBusinessIntent = Boolean(currentProfile.businessSector || currentProfile.proposedBusiness)
  if (!hasBusinessIntent) {
    return { shouldRefetch: false, reasons: reasons.length > 0 ? reasons : ['no business intent known yet'] }
  }

  if (!lastFetchedSnapshot) {
    reasons.push('no evidence has been fetched yet and enough is now known to make a first attempt')
    return { shouldRefetch: true, reasons }
  }

  for (const field of DECISION_CRITICAL_FIELDS) {
    if (currentProfile[field] !== lastFetchedSnapshot[field]) {
      reasons.push(`${String(field)} changed since the last evidence fetch (was ${JSON.stringify(lastFetchedSnapshot[field])}, now ${JSON.stringify(currentProfile[field])})`)
    }
  }

  return { shouldRefetch: reasons.length > 0, reasons }
}

export type FinancingIntentSignal = 'subsidy_only' | 'loan_only'

const SUBSIDY_ONLY_PATTERN = /\b(no\s+loan|only\s+(a\s+)?subsidy|don'?t\s+want\s+a\s+loan|not\s+looking\s+for\s+a\s+loan)\b/i
const LOAN_ONLY_PATTERN = /\b(no\s+subsidy|only\s+(a\s+|the\s+)?loan|just\s+(a\s+|the\s+)?loan)\b/i

/**
 * Detects a financing-TYPE preference change (loan vs. subsidy) that the
 * current UserProfile has no structured field for — financingRequired/
 * investmentRequired only capture AMOUNT, not TYPE. Rather than inventing a
 * new profile field (out of scope for this phase — see
 * docs/applicant-profile.md's "what does not belong" list, which excludes
 * anything not already a real field), a detected signal is recorded as a
 * free-text rawNote (the existing, correct place for an unstructured
 * fragment) and used purely as an evidence-invalidation trigger.
 */
export function detectFinancingIntentSignal(text: string): FinancingIntentSignal | null {
  if (SUBSIDY_ONLY_PATTERN.test(text)) return 'subsidy_only'
  if (LOAN_ONLY_PATTERN.test(text)) return 'loan_only'
  return null
}
