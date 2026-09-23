import { describe, expect, it } from 'vitest'
import { BUSINESS_CATEGORIES, BUSINESS_META } from './villages'

describe('business categories', () => {
  it('lists the full set and aliases tailoring under textiles', () => {
    expect(BUSINESS_CATEGORIES).toEqual([
      'dairy',
      'retail',
      'food',
      'textiles',
      'poultry',
      'agri_processing',
    ])
    expect(BUSINESS_META.textiles.label).toMatch(/Tailoring/)
    expect(BUSINESS_META.textiles.labelKn).toMatch(/ಟೈಲರಿಂಗ್/)
  })
})
