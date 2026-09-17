import { describe, expect, it } from 'vitest'
import { WORKFLOW_STEPS, type WorkflowStep } from '../apply/types'
import {
  CANONICAL_APPLICATION_STATUSES,
  canonicalStatusForTrackedApplication,
  canonicalStatusForWorkflowStep,
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

describe('canonicalStatusForTrackedApplication', () => {
  it('defaults to draft when statusHistory is empty', () => {
    expect(canonicalStatusForTrackedApplication({ statusHistory: [] })).toBe('draft')
  })

  it('derives from the most recent statusHistory entry', () => {
    const app = {
      statusHistory: [
        { at: '2026-01-01T00:00:00.000Z', step: 'profile_and_scheme' as WorkflowStep, note: 'started' },
        { at: '2026-01-02T00:00:00.000Z', step: 'explicit_consent' as WorkflowStep, note: 'consented' },
      ],
    }
    expect(canonicalStatusForTrackedApplication(app)).toBe('awaiting_consent')
  })
})
