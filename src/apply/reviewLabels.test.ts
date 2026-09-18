import { describe, expect, it } from 'vitest'
import { humanizeSchemaKey, reviewFieldLabel } from './reviewLabels'

describe('Apply review field labels', () => {
  it('converts stored schema keys into human-readable labels without changing the key', () => {
    expect(humanizeSchemaKey('applicant_name')).toBe('Applicant Name')
    expect(humanizeSchemaKey('AREA_TYPE')).toBe('Area Type')
    expect(humanizeSchemaKey('LOAN_AMOUNT_REQUESTED')).toBe('Loan Amount Requested')
  })

  it('prefers the catalog mapped label when present', () => {
    expect(reviewFieldLabel('applicant_name', 'Applicant full name')).toBe('Applicant full name')
    expect(reviewFieldLabel('area_type')).toBe('Area Type')
  })
})
