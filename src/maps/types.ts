import type { BusinessCategory } from '../data/villages'

export interface SelectedLocation {
  latitude: number
  longitude: number
  formattedAddress: string
  placeId: string
}

export interface CompetitorPlace {
  placeId: string
  name: string
  latitude: number
  longitude: number
  distanceKm: number
  rating?: number
  ratingCount?: number
  address?: string
}

export type CompetitionThreatLevel = 'low' | 'moderate' | 'high'
export type CompetitionDataQuality = 'complete' | 'sparse' | 'no_results'

export interface CompetitionScoreBreakdown {
  countScore: number
  proximityScore: number
  ratingStrengthScore: number
}

export interface CompetitionAnalysisResult {
  businessType: BusinessCategory
  latitude: number
  longitude: number
  radiusKm: number
  competitors: CompetitorPlace[]
  competitorCount: number
  averageDistanceKm: number | null
  averageRating: number | null
  totalRatingCount: number
  score: number
  threatLevel: CompetitionThreatLevel
  breakdown: CompetitionScoreBreakdown
  dataQuality: CompetitionDataQuality
  analyzedAt: string
  source: 'google_places'
}

export type CompetitionLookupState =
  | { status: 'idle' | 'loading' }
  | { status: 'success'; result: CompetitionAnalysisResult }
  | { status: 'error'; message: string }
