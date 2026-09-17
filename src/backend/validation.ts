/**
 * Input validation for backend service boundaries.
 */

import { BackendError } from './errors'
import type { Uuid } from '../contracts/common'
import type { AppLocale } from '../contracts/domain'
import type { ApplicationStatus, SubmissionMode } from '../contracts/application'
import type {
  CreateApplicationInput,
  SubmitApplicationInput,
  UpdateApplicationFieldsInput,
} from '../contracts/application'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function assertUuid(value: string, field = 'id'): asserts value is Uuid {
  if (!UUID_RE.test(value)) {
    throw new BackendError('VALIDATION', `Invalid UUID for ${field}`, { details: { field } })
  }
}

export function optionalUuid(value: string | null | undefined, field: string): Uuid | null {
  if (value == null || value === '') return null
  assertUuid(value, field)
  return value
}

const LOCALES: AppLocale[] = ['en', 'kn', 'mixed']

export function assertLocale(value: string | undefined): AppLocale {
  const v = value ?? 'en'
  if (!LOCALES.includes(v as AppLocale)) {
    throw new BackendError('VALIDATION', `Invalid locale: ${v}`, { details: { value: v } })
  }
  return v as AppLocale
}

const APP_STATUSES: ApplicationStatus[] = [
  'draft',
  'profile_incomplete',
  'recommended',
  'fields_pending',
  'documents_pending',
  'citizen_review',
  'consent_pending',
  'ready_to_submit',
  'submitted',
  'under_review',
  'approval_pending',
  'approved',
  'rejected',
  'disbursement_pending',
  'disbursed',
  'withdrawn',
]

export function assertApplicationStatus(value: string): ApplicationStatus {
  if (!APP_STATUSES.includes(value as ApplicationStatus)) {
    throw new BackendError('VALIDATION', `Invalid application status: ${value}`)
  }
  return value as ApplicationStatus
}

export function validateCreateApplicationInput(input: CreateApplicationInput): void {
  assertUuid(input.userId, 'userId')
  optionalUuid(input.applicantProfileId, 'applicantProfileId')
  optionalUuid(input.schemeId, 'schemeId')
  optionalUuid(input.schemeVersionId, 'schemeVersionId')
  if (input.initialFields) {
    for (const f of input.initialFields) {
      if (!f.key || typeof f.key !== 'string') {
        throw new BackendError('VALIDATION', 'Application field key is required')
      }
    }
  }
}

export function validateUpdateFieldsInput(input: UpdateApplicationFieldsInput): void {
  assertUuid(input.applicationId, 'applicationId')
  if (input.actorId) assertUuid(input.actorId, 'actorId')
  if (!input.fields?.length) {
    throw new BackendError('VALIDATION', 'At least one field is required')
  }
}

const SUBMISSION_MODES: SubmissionMode[] = ['authorized_api', 'assisted', 'none']

export function validateSubmitApplicationInput(input: SubmitApplicationInput): void {
  assertUuid(input.applicationId, 'applicationId')
  if (input.actorId) assertUuid(input.actorId, 'actorId')
  if (!SUBMISSION_MODES.includes(input.mode)) {
    throw new BackendError('VALIDATION', `Invalid submission mode: ${input.mode}`)
  }
  if (!input.idempotencyKey || typeof input.idempotencyKey !== 'string' || !input.idempotencyKey.trim()) {
    throw new BackendError('VALIDATION', 'idempotencyKey is required to submit an application')
  }
}
