import { describe, expect, it } from 'vitest'
import { computeCompetitionAnalysis } from './competitionScore'
import { fallbackNarrative, validateNarrative } from './competitionNarrator'

const empty = computeCompetitionAnalysis({
  businessType: 'dairy', latitude: 15, longitude: 75, radiusKm: 3, competitors: [],
})

describe('competition narration guard', () => {
  it('warns that zero listings are not proof of zero competition', () => {
    expect(fallbackNarrative(empty)).toMatch(/not proof/i)
  })

  it('rejects an invented no-competition conclusion', () => {
    expect(validateNarrative('There is no competition in this area.', empty)).toBe(false)
  })

  it('rejects numbers that were not present in deterministic evidence', () => {
    expect(validateNarrative('The threat score is 99.', empty)).toBe(false)
  })
})
