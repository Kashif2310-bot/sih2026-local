/**
 * Bridges the existing text-extraction pipeline's output into the shared
 * ApplicantProfile contract (src/shared/applicantProfile.ts), one turn's
 * worth of newly-learned facts at a time.
 *
 * Does NOT re-implement extraction — it reuses the field-name mapping
 * already written for this exact purpose in
 * src/shared/applicantProfile.ts's applicantProfileFromUserProfile(). That
 * function normally projects a WHOLE UserProfile; called here on just this
 * turn's `updatedFields` delta, it produces exactly the provenance-tagged
 * slice this turn actually taught us, which withApplicantFields() then
 * folds into the running ApplicantProfile.
 *
 * Provenance rule: src/assistant/profileExtraction.ts is deterministic
 * regex/keyword extraction over the citizen's OWN words — no LLM guess is
 * involved — so a field it sets is recorded as 'user_provided', never
 * 'ai_extracted' (which is reserved for values an LLM actually inferred)
 * and never silently upgraded to 'government_verified' or 'confirmed'
 * confidence, which this module never assigns.
 */

import { withApplicantFields, applicantProfileFromUserProfile, type ApplicantProfile } from '../../shared/applicantProfile'
import type { UserProfile } from '../types'

/**
 * Folds `updatedFields` (as produced by profileExtraction.ts's
 * extractAndMerge) from `nextUserProfile` into `applicantProfile`,
 * recording every touched field as 'user_provided' at `capturedAt`. Fields
 * not in `updatedFields` are left untouched — this is an incremental merge,
 * not a full re-projection, so it never regresses a field's existing
 * provenance from a previous turn.
 */
export function mergeExtractedFactsIntoApplicantProfile(
  applicantProfile: ApplicantProfile,
  nextUserProfile: UserProfile,
  updatedFields: Array<keyof UserProfile>,
  capturedAt: string = new Date().toISOString(),
): ApplicantProfile {
  if (updatedFields.length === 0) return applicantProfile

  const delta: UserProfile = { rawNotes: [] }
  for (const field of updatedFields) {
    if (field === 'rawNotes') continue
    const value = nextUserProfile[field]
    if (value === undefined) continue
    Object.assign(delta, { [field]: value })
  }

  const deltaAsApplicantProfile = applicantProfileFromUserProfile(delta, { source: 'user_provided', now: capturedAt })
  if (Object.keys(deltaAsApplicantProfile.fieldProvenance).length === 0) return applicantProfile

  return withApplicantFields(applicantProfile, deltaAsApplicantProfile.data, { source: 'user_provided', capturedAt })
}
