import { describe, expect, it } from 'vitest'
import { EMPTY_PROFILE, type UserProfile } from '../types'
import {
  checkEvidenceInvalidation,
  detectFinancingIntentSignal,
  snapshotDecisionCriticalFields,
} from './evidenceInvalidation'

describe('checkEvidenceInvalidation', () => {
  it('never refetches with no business intent known yet', () => {
    const result = checkEvidenceInvalidation(null, EMPTY_PROFILE)
    expect(result.shouldRefetch).toBe(false)
  })

  it('refetches on the first attempt once enough is known', () => {
    const profile: UserProfile = { businessSector: 'dairy', rawNotes: [] }
    const result = checkEvidenceInvalidation(null, profile)
    expect(result.shouldRefetch).toBe(true)
    expect(result.reasons[0]).toMatch(/no evidence has been fetched yet/)
  })

  it('does not refetch again when nothing decision-critical changed', () => {
    const profile: UserProfile = { businessSector: 'dairy', state: 'Karnataka', rawNotes: [] }
    const snapshot = snapshotDecisionCriticalFields(profile)
    const result = checkEvidenceInvalidation(snapshot, profile)
    expect(result.shouldRefetch).toBe(false)
    expect(result.reasons).toEqual([])
  })

  it('"Actually I\'m switching from poultry to dairy" — business-sector change invalidates', () => {
    const before: UserProfile = { businessSector: 'poultry', state: 'Karnataka', rawNotes: [] }
    const snapshot = snapshotDecisionCriticalFields(before)
    const after: UserProfile = { ...before, businessSector: 'dairy' }
    const result = checkEvidenceInvalidation(snapshot, after)
    expect(result.shouldRefetch).toBe(true)
    expect(result.reasons.some((r) => r.includes('businessSector'))).toBe(true)
  })

  it('"I\'ll start in Kerala instead of Karnataka" — state change invalidates', () => {
    const before: UserProfile = { businessSector: 'dairy', state: 'Karnataka', rawNotes: [] }
    const snapshot = snapshotDecisionCriticalFields(before)
    const after: UserProfile = { ...before, state: 'Kerala' }
    const result = checkEvidenceInvalidation(snapshot, after)
    expect(result.shouldRefetch).toBe(true)
    expect(result.reasons.some((r) => r.includes('state'))).toBe(true)
  })

  it('a financing amount change invalidates', () => {
    const before: UserProfile = { businessSector: 'dairy', financingRequired: 100_000, rawNotes: [] }
    const snapshot = snapshotDecisionCriticalFields(before)
    const after: UserProfile = { ...before, financingRequired: 400_000 }
    const result = checkEvidenceInvalidation(snapshot, after)
    expect(result.shouldRefetch).toBe(true)
    expect(result.reasons.some((r) => r.includes('financingRequired'))).toBe(true)
  })

  it('a non-decision-critical field changing (e.g. education) does not invalidate', () => {
    const before: UserProfile = { businessSector: 'dairy', rawNotes: [] }
    const snapshot = snapshotDecisionCriticalFields(before)
    const after: UserProfile = { ...before, education: '10th' }
    const result = checkEvidenceInvalidation(snapshot, after)
    expect(result.shouldRefetch).toBe(false)
  })

  it('an explicit extra signal always forces a refetch even with no field change', () => {
    const before: UserProfile = { businessSector: 'dairy', rawNotes: [] }
    const snapshot = snapshotDecisionCriticalFields(before)
    const result = checkEvidenceInvalidation(snapshot, before, 'financing intent changed (subsidy_only)')
    expect(result.shouldRefetch).toBe(true)
    expect(result.reasons).toContain('financing intent changed (subsidy_only)')
  })
})

describe('detectFinancingIntentSignal', () => {
  it('"I only need a subsidy, no loan" -> subsidy_only', () => {
    expect(detectFinancingIntentSignal('I only need a subsidy, no loan')).toBe('subsidy_only')
  })

  it('detects "no loan" and "don\'t want a loan" variants', () => {
    expect(detectFinancingIntentSignal('I have no loan requirement')).toBe('subsidy_only')
    expect(detectFinancingIntentSignal("I don't want a loan, just the subsidy")).toBe('subsidy_only')
  })

  it('detects a loan-only preference', () => {
    expect(detectFinancingIntentSignal('I just want a loan, no subsidy needed')).toBe('loan_only')
  })

  it('returns null for ordinary financing statements', () => {
    expect(detectFinancingIntentSignal('I need about 3 lakh in financing')).toBeNull()
    expect(detectFinancingIntentSignal('I want to start a dairy business')).toBeNull()
  })
})

describe('snapshotDecisionCriticalFields', () => {
  it('only captures the decision-critical fields, not the whole profile', () => {
    const profile: UserProfile = {
      businessSector: 'dairy',
      education: '10th',
      landOrAssets: '2 acres',
      rawNotes: ['note'],
    }
    const snapshot = snapshotDecisionCriticalFields(profile)
    expect(snapshot).toEqual({
      businessSector: 'dairy',
      state: undefined,
      financingRequired: undefined,
      socialCategory: undefined,
      businessStage: undefined,
      annualIncome: undefined,
    })
  })
})
