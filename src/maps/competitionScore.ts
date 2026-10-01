import type {
  CompetitionAnalysisResult,
  CompetitionDataQuality,
  CompetitionScoreBreakdown,
  CompetitionThreatLevel,
  CompetitorPlace,
} from './types'
import type { BusinessCategory } from '../data/villages'

const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value))
const round1 = (value: number) => Math.round(value * 10) / 10

/**
 * Auditable competition threat formula (0–100):
 * - count, 50 points: saturates at 10 competitors;
 * - proximity, 30 points: a competitor at the selected point contributes 1,
 *   one at the radius edge contributes 0;
 * - rating strength, 20 points: average rating / 5, discounted until the
 *   returned competitors collectively have 50 ratings.
 *
 * Missing ratings contribute no rating-strength points. A successful empty
 * result is score 0, but its dataQuality is `no_results`, so the UI never
 * turns "Google returned no listings" into "there is no competition".
 */
export function computeCompetitionAnalysis(input: {
  businessType: BusinessCategory
  latitude: number
  longitude: number
  radiusKm: number
  competitors: CompetitorPlace[]
  analyzedAt?: string
}): CompetitionAnalysisResult {
  const { competitors, radiusKm } = input
  const countScore = clamp(competitors.length / 10, 0, 1) * 50
  const proximityScore = competitors.length
    ? (competitors.reduce((sum, item) => sum + clamp(1 - item.distanceKm / radiusKm, 0, 1), 0) /
        competitors.length) *
      30
    : 0

  const rated = competitors.filter(
    (item): item is CompetitorPlace & { rating: number } => typeof item.rating === 'number',
  )
  const averageRating = rated.length
    ? rated.reduce((sum, item) => sum + item.rating, 0) / rated.length
    : null
  const totalRatingCount = competitors.reduce((sum, item) => sum + (item.ratingCount ?? 0), 0)
  const ratingConfidence = clamp(totalRatingCount / 50, 0, 1)
  const ratingStrengthScore = averageRating == null ? 0 : (averageRating / 5) * ratingConfidence * 20

  const score = Math.round(clamp(countScore + proximityScore + ratingStrengthScore))
  const threatLevel: CompetitionThreatLevel = score < 35 ? 'low' : score < 65 ? 'moderate' : 'high'
  const averageDistanceKm = competitors.length
    ? competitors.reduce((sum, item) => sum + item.distanceKm, 0) / competitors.length
    : null
  const dataQuality: CompetitionDataQuality =
    competitors.length === 0 ? 'no_results' : competitors.length < 3 || rated.length === 0 ? 'sparse' : 'complete'
  const breakdown: CompetitionScoreBreakdown = {
    countScore: round1(countScore),
    proximityScore: round1(proximityScore),
    ratingStrengthScore: round1(ratingStrengthScore),
  }

  return {
    ...input,
    competitors,
    competitorCount: competitors.length,
    averageDistanceKm: averageDistanceKm == null ? null : round1(averageDistanceKm),
    averageRating: averageRating == null ? null : round1(averageRating),
    totalRatingCount,
    score,
    threatLevel,
    breakdown,
    dataQuality,
    analyzedAt: input.analyzedAt ?? new Date().toISOString(),
    source: 'google_places',
  }
}
