import { describe, expect, it } from 'vitest'
import { WORKFLOW_STEPS, type WorkflowStep } from '../apply/types'
import { BackendError } from '../backend/errors'
import {
  CANONICAL_APPLICATION_STATUSES,
  assertCanonicalApplicationStatus,
  canonicalStatusForWorkflowStep,
  isCanonicalApplicationStatus,
} from './applicationStatus'

describe('canonicalStatusForWorkflowStep', () => {
  it('maps every existing WorkflowStep to exactly one canonical status', () => {
    for (const step of WORKFLOW_STEPS) {
      const status = canonicalStatusForWorkflowStep(step)
      expect(CANONICAL_APPLICATION_STATUSES).toContain(status)
    }
  })

  it('maps preparation steps to draft', () => {
    const prep: WorkflowStep[] = [
      'profile_and_scheme',
      'application_schema',
      'field_mapping',
      'missing_fields',
      'document_requirements',
      'validation',
      'generated_application',
      'user_review',
      'corrections',
    ]
    for (const step of prep) {
      expect(canonicalStatusForWorkflowStep(step)).toBe('draft')
    }
  })

  it('maps explicit_consent to awaiting_consent', () => {
    expect(canonicalStatusForWorkflowStep('explicit_consent')).toBe('awaiting_consent')
  })

  it('maps submission and application_id to submitted', () => {
    expect(canonicalStatusForWorkflowStep('submission')).toBe('submitted')
    expect(canonicalStatusForWorkflowStep('application_id')).toBe('submitted')
  })

  it('maps status_tracking to tracked', () => {
    expect(canonicalStatusForWorkflowStep('status_tracking')).toBe('tracked')
  })
})

describe('isCanonicalApplicationStatus / assertCanonicalApplicationStatus', () => {
  it('accepts exactly the 4 canonical values', () => {
    for (const status of CANONICAL_APPLICATION_STATUSES) {
      expect(isCanonicalApplicationStatus(status)).toBe(true)
      expect(assertCanonicalApplicationStatus(status)).toBe(status)
    }
  })

  it('rejects an invalid canonical status', () => {
    expect(isCanonicalApplicationStatus('approved')).toBe(false)
    expect(() => assertCanonicalApplicationStatus('approved')).toThrow(BackendError)
  })
})
