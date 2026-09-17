/**
 * Canonical, finite, persisted application lifecycle status (Option A / LP-APP-*).
 *
 * Distinct from two other things with a similar name in this codebase:
 *  - contracts/application.ts `ApplicationStatus` — legacy Phase 1/2 UUID
 *    application model, compat-only, not used by TrackedApplication.
 *  - apply/application.ts `ApplicationStatus` — an internal enum defined
 *    there but not wired to TrackedApplication or referenced anywhere else;
 *    left untouched (Adita's file).
 *
 * This is the single cross-service lifecycle status for LP-APP-* applications.
 * It is derived deterministically from Adita's WorkflowStep — the workflow
 * engine's own persisted progress — so it can never drift out of sync with
 * TrackedApplication.statusHistory. It intentionally does not encode
 * WorkflowStep's fine-grained preparation detail (that stays available via
 * statusHistory for anything that needs it); this is the small, stable set
 * documents/notifications/other cross-service consumers key off instead of
 * raw, UI-oriented step names.
 */

import type { TrackedApplication, WorkflowStep } from '../apply/types'

export const CANONICAL_APPLICATION_STATUSES = ['draft', 'awaiting_consent', 'submitted', 'tracked'] as const

export type CanonicalApplicationStatus = (typeof CANONICAL_APPLICATION_STATUSES)[number]

/**
 * Every WorkflowStep (src/apply/types.ts WORKFLOW_STEPS) maps to exactly one
 * canonical status:
 *  - draft: every preparation step before the citizen has consented
 *    (profile_and_scheme .. corrections) — still editable, nothing final.
 *  - awaiting_consent: packet generated, waiting on the explicit consent step.
 *  - submitted: the submission attempt itself, and the application id being
 *    issued — the packet has been dispatched.
 *  - tracked: the terminal workflow step — the application is now under
 *    post-submission status tracking (approval/disbursement progress lives
 *    in Jordan's approval_cases / Adita's application_events, not here).
 */
const WORKFLOW_STEP_STATUS: Record<WorkflowStep, CanonicalApplicationStatus> = {
  profile_and_scheme: 'draft',
  application_schema: 'draft',
  field_mapping: 'draft',
  missing_fields: 'draft',
  document_requirements: 'draft',
  validation: 'draft',
  generated_application: 'draft',
  user_review: 'draft',
  corrections: 'draft',
  explicit_consent: 'awaiting_consent',
  submission: 'submitted',
  application_id: 'submitted',
  status_tracking: 'tracked',
}

export function canonicalStatusForWorkflowStep(step: WorkflowStep): CanonicalApplicationStatus {
  return WORKFLOW_STEP_STATUS[step]
}

/** Derives the canonical status from a TrackedApplication's own persisted statusHistory. */
export function canonicalStatusForTrackedApplication(
  app: Pick<TrackedApplication, 'statusHistory'>,
): CanonicalApplicationStatus {
  const lastStep = app.statusHistory.at(-1)?.step
  return lastStep ? canonicalStatusForWorkflowStep(lastStep) : 'draft'
}
