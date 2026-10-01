import { describe, expect, it } from 'vitest'
import { computeCompetitionAnalysis } from './competitionScore'
import type { CompetitorPlace } from './types'

const place = (distanceKm: number, rating?: number, ratingCount?: number): CompetitorPlace => ({
  placeId: `p-${distanceKm}`,
  name: 'Returned business',
  latitude: 15,
  longitude: 75,
  distanceKm,
  rating,
  ratingCount,
})

describe('computeCompetitionAnalysis', () => {
  it('keeps successful zero-result data honest and auditable', () => {
    const result = computeCompetitionAnalysis({
      businessType: 'dairy', latitude: 15, longitude: 75, radiusKm: 3, competitors: [],
    })
    expect(result).toMatchObject({ score: 0, threatLevel: 'low', dataQuality: 'no_results', competitorCount: 0 })
  })

  it('increases threat for many close, strongly rated competitors', () => {
    const competitors = Array.from({ length: 10 }, (_, index) =>
      place(0.2 + index * 0.1, 4.5, 20),
    )
    const result = computeCompetitionAnalysis({
      businessType: 'retail', latitude: 15, longitude: 75, radiusKm: 3, competitors,
    })
    expect(result.threatLevel).toBe('high')
    expect(result.score).toBeGreaterThanOrEqual(65)
    expect(result.breakdown.countScore).toBe(50)
  })

  it('does not invent rating strength when ratings are missing', () => {
    const result = computeCompetitionAnalysis({
      businessType: 'textiles', latitude: 15, longitude: 75, radiusKm: 3,
      competitors: [place(1), place(2)],
    })
    expect(result.averageRating).toBeNull()
    expect(result.breakdown.ratingStrengthScore).toBe(0)
    expect(result.dataQuality).toBe('sparse')
  })
})
