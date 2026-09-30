import { describe, expect, it } from 'vitest'
import type { UserProfile } from '../../assistant/types'
import { applyCorrection, parseRupees } from './corrections'

const BASE: UserProfile = { rawNotes: [], age: 30, state: 'Karnataka', annualIncome: 200_000 }

describe('review-screen corrections', () => {
  it('parses rupee amounts written the way people write them', () => {
    expect(parseRupees('2.5 lakh')).toBe(250_000)
    expect(parseRupees('₹3,00,000')).toBe(300_000)
    expect(parseRupees('twelve lakh')).toBe(1_200_000)
    expect(parseRupees('50k')).toBe(50_000)
    expect(parseRupees('lots')).toBeUndefined()
  })

  it('writes into the same profile and details that speech fills', () => {
    const result = applyCorrection(BASE, {}, 'loan_amount_requested', '12 lakh')
    expect(result).toMatchObject({ ok: true, profile: { financingRequired: 1_200_000, age: 30 } })
    const name = applyCorrection(BASE, {}, 'applicant_name', 'lakshmi devi')
    expect(name).toMatchObject({ ok: true, details: { applicantName: 'Lakshmi Devi' } })
  })

  it('rejects invalid values with a message and leaves nothing changed', () => {
    expect(applyCorrection(BASE, {}, 'mobile', '12345')).toMatchObject({ ok: false })
    expect(applyCorrection(BASE, {}, 'age', 'thirty-ish')).toMatchObject({ ok: false })
    expect(applyCorrection(BASE, {}, 'social_category', 'rich')).toMatchObject({ ok: false })
    expect(applyCorrection(BASE, {}, 'not_a_field', 'x')).toMatchObject({ ok: false })
  })

  it('an empty value clears the field', () => {
    const result = applyCorrection(BASE, { experienceYears: 3 }, 'age', '  ')
    expect(result.ok && result.profile.age).toBeUndefined()
    const cleared = applyCorrection(BASE, { experienceYears: 3 }, 'experience_years', '')
    expect(cleared.ok && cleared.details.experienceYears).toBeUndefined()
  })

  it('confirming the state removes the "taken from district" flag', () => {
    const result = applyCorrection(BASE, { stateInferredFromDistrict: 'Karnataka' }, 'state', 'karnataka')
    expect(result.ok && result.details.stateInferredFromDistrict).toBeUndefined()
    expect(result.ok && result.profile.state).toBe('Karnataka')
  })

  it('normalizes category, gender, sector and stage', () => {
    const r1 = applyCorrection(BASE, {}, 'social_category', 'SC')
    expect(r1.ok && r1.profile.socialCategory).toBe('sc')
    const r2 = applyCorrection(BASE, {}, 'gender', 'Woman')
    expect(r2.ok && r2.profile.gender).toBe('female')
    const r3 = applyCorrection(BASE, {}, 'business_sector', 'milk dairy')
    expect(r3.ok && r3.profile.businessSector).toBe('dairy')
    const r4 = applyCorrection(BASE, {}, 'business_stage', 'expanding')
    expect(r4.ok && r4.profile.businessStage).toBe('existing_expansion')
  })
})
