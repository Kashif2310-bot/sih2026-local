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
 * canonicalStatusForWorkflowStep() is the one deterministic mapping function,
 * and it is applied exactly once, at write time, by
 * src/backend/services/applicationStatus/withCanonicalStatusPersistence.ts
 * whenever an application is saved. The result is persisted (see migration
 * 202609170005_canonical_application_status.sql) and simply read back
 * thereafter — it is never recomputed from statusHistory on read. Reads
 * must go through ApplicationStatusStore.getStatus(), not this mapping
 * function.
 *
 * WorkflowStep keeps encoding fine-grained UI-facing preparation detail via
 * TrackedApplication.statusHistory — untouched, unchanged, still the
 * detailed workflow history. This is the small, stable set cross-service
 * consumers (documents/notifications/admin) key off instead.
 *
 * `submitted` means the submission attempt/application id was issued by
 * Adita's workflow — it does NOT mean government approval, acceptance, or
 * successful government filing. That only happens if/when an authoritative
 * government integration confirms it (see TrackedApplication.outcome /
 * filedWithGovernment, which remain the honest source for that fact and are
 * intentionally independent of this status).
 */

import type { WorkflowStep } from '../apply/types'
import { BackendError } from '../backend/errors'

export const CANONICAL_APPLICATION_STATUSES = ['draft', 'awaiting_consent', 'submitted', 'tracked'] as const

export type CanonicalApplicationStatus = (typeof CANONICAL_APPLICATION_STATUSES)[number]

/**
 * Every WorkflowStep (src/apply/types.ts WORKFLOW_STEPS) maps to exactly one
 * canonical status:
 *  - draft: every preparation step before the citizen has consented
 *    (profile_and_scheme .. corrections) — still editable, nothing final.
 *  - awaiting_consent: packet generated, waiting on the explicit consent step.
 *  - submitted: the submission attempt itself, and the application id being
 *    issued — the packet has been dispatched. Not a government confirmation.
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

export function isCanonicalApplicationStatus(value: string): value is CanonicalApplicationStatus {
  return (CANONICAL_APPLICATION_STATUSES as readonly string[]).includes(value)
}

export function assertCanonicalApplicationStatus(value: string): CanonicalApplicationStatus {
  if (!isCanonicalApplicationStatus(value)) {
    throw new BackendError(
      'VALIDATION',
      `Invalid canonical application status: ${value}. Must be one of ${CANONICAL_APPLICATION_STATUSES.join(', ')}`,
    )
  }
  return value
}
