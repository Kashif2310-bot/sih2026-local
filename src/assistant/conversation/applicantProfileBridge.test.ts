import { describe, expect, it } from 'vitest'
import { createEmptyApplicantProfile, withApplicantField } from '../../shared/applicantProfile'
import type { UserProfile } from '../types'
import { mergeExtractedFactsIntoApplicantProfile } from './applicantProfileBridge'

describe('mergeExtractedFactsIntoApplicantProfile', () => {
  it('folds only the updated fields, tagged user_provided, at the given timestamp', () => {
    const applicant = createEmptyApplicantProfile()
    const nextUserProfile: UserProfile = { businessSector: 'dairy', state: 'Karnataka', age: 28, rawNotes: [] }
    const merged = mergeExtractedFactsIntoApplicantProfile(
      applicant,
      nextUserProfile,
      ['businessSector', 'age'], // state deliberately NOT in updatedFields — should not be folded in yet
      '2026-01-01T00:00:00.000Z',
    )

    expect(merged.data.businessSector).toBe('dairy')
    expect(merged.data.age).toBe(28)
    expect(merged.data.state).toBeUndefined()
    expect(merged.fieldProvenance.businessSector).toEqual({ source: 'user_provided', capturedAt: '2026-01-01T00:00:00.000Z' })
    expect(merged.fieldProvenance.age).toEqual({ source: 'user_provided', capturedAt: '2026-01-01T00:00:00.000Z' })
    expect(merged.fieldProvenance.state).toBeUndefined()
  })

  it('is a no-op when updatedFields is empty', () => {
    const applicant = createEmptyApplicantProfile()
    const nextUserProfile: UserProfile = { businessSector: 'dairy', rawNotes: [] }
    const merged = mergeExtractedFactsIntoApplicantProfile(applicant, nextUserProfile, [])
    expect(merged).toBe(applicant)
  })

  it('does not regress an existing field\'s provenance when a later turn updates a different field', () => {
    let applicant = createEmptyApplicantProfile()
    applicant = withApplicantField(applicant, 'age', 28, { source: 'government_verified', confidence: 'confirmed', capturedAt: '2026-01-01T00:00:00.000Z' })

    const nextUserProfile: UserProfile = { age: 28, state: 'Karnataka', rawNotes: [] }
    const merged = mergeExtractedFactsIntoApplicantProfile(applicant, nextUserProfile, ['state'], '2026-02-01T00:00:00.000Z')

    // age's provenance from the earlier, more authoritative source is untouched.
    expect(merged.fieldProvenance.age).toEqual({ source: 'government_verified', confidence: 'confirmed', capturedAt: '2026-01-01T00:00:00.000Z' })
    expect(merged.fieldProvenance.state).toEqual({ source: 'user_provided', capturedAt: '2026-02-01T00:00:00.000Z' })
  })

  it('accumulates across multiple turns without losing earlier facts', () => {
    let applicant = createEmptyApplicantProfile()
    const turn1: UserProfile = { businessSector: 'dairy', rawNotes: [] }
    applicant = mergeExtractedFactsIntoApplicantProfile(applicant, turn1, ['businessSector'], '2026-01-01T00:00:00.000Z')

    const turn2: UserProfile = { businessSector: 'dairy', state: 'Karnataka', rawNotes: [] }
    applicant = mergeExtractedFactsIntoApplicantProfile(applicant, turn2, ['state'], '2026-01-01T00:05:00.000Z')

    expect(applicant.data).toMatchObject({ businessSector: 'dairy', state: 'Karnataka' })
  })

  it('never fabricates a value for a field not present in updatedFields, even if nextUserProfile happens to have one', () => {
    const applicant = createEmptyApplicantProfile()
    const nextUserProfile: UserProfile = { businessSector: 'dairy', annualIncome: 200_000, rawNotes: [] }
    const merged = mergeExtractedFactsIntoApplicantProfile(applicant, nextUserProfile, ['businessSector'])
    expect(merged.data.annualIncome).toBeUndefined()
  })
})
