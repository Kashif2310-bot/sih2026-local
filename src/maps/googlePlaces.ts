import type { BusinessCategory } from '../data/villages'
import { distanceKm } from '../lib/geo'
import { BUSINESS_TYPE_PLACES_CONFIG } from './businessTypeConfig'
import { computeCompetitionAnalysis } from './competitionScore'
import type { CompetitionAnalysisResult, CompetitorPlace } from './types'

const PLACE_FIELDS = [
  'id',
  'displayName',
  'location',
  'formattedAddress',
  'rating',
  'userRatingCount',
] as const

function toCompetitor(
  place: google.maps.places.Place,
  origin: { latitude: number; longitude: number },
): CompetitorPlace | null {
  if (!place.location) return null
  const latitude = place.location.lat()
  const longitude = place.location.lng()
  return {
    placeId: place.id,
    name: place.displayName || 'Unnamed business',
    latitude,
    longitude,
    distanceKm: Math.round(distanceKm(origin.latitude, origin.longitude, latitude, longitude) * 10) / 10,
    ...(typeof place.rating === 'number' ? { rating: place.rating } : {}),
    ...(typeof place.userRatingCount === 'number' ? { ratingCount: place.userRatingCount } : {}),
    ...(place.formattedAddress ? { address: place.formattedAddress } : {}),
  }
}

function boundsAround(latitude: number, longitude: number, radiusKm: number): google.maps.LatLngBoundsLiteral {
  const latDelta = radiusKm / 111
  const lngDelta = radiusKm / (111 * Math.max(0.2, Math.cos((latitude * Math.PI) / 180)))
  return {
    north: latitude + latDelta,
    south: latitude - latDelta,
    east: longitude + lngDelta,
    west: longitude - lngDelta,
  }
}

export async function searchNearbyCompetition(input: {
  latitude: number
  longitude: number
  businessType: BusinessCategory
  radiusKm: number
}): Promise<CompetitionAnalysisResult> {
  if (!globalThis.google?.maps?.importLibrary) {
    throw new Error('Google Maps is not ready yet.')
  }
  const { Place, SearchNearbyRankPreference, SearchByTextRankPreference } =
    (await google.maps.importLibrary('places')) as google.maps.PlacesLibrary
  const mapping = BUSINESS_TYPE_PLACES_CONFIG[input.businessType]
  let places: google.maps.places.Place[] = []

  if (mapping.includedPrimaryTypes.length > 0) {
    const response = await Place.searchNearby({
      fields: [...PLACE_FIELDS],
      locationRestriction: {
        center: { lat: input.latitude, lng: input.longitude },
        radius: input.radiusKm * 1000,
      },
      includedPrimaryTypes: mapping.includedPrimaryTypes,
      maxResultCount: 20,
      rankPreference: SearchNearbyRankPreference.POPULARITY,
      language: 'en',
      region: 'IN',
    })
    places = response.places
  } else {
    const response = await Place.searchByText({
      fields: [...PLACE_FIELDS],
      textQuery: mapping.fallbackKeywords.join(' or '),
      locationRestriction: boundsAround(input.latitude, input.longitude, input.radiusKm),
      maxResultCount: 20,
      rankPreference: SearchByTextRankPreference.RELEVANCE,
      language: 'en',
      region: 'IN',
    })
    places = response.places
  }

  const byId = new Map<string, CompetitorPlace>()
  for (const place of places) {
    const competitor = toCompetitor(place, input)
    if (competitor && competitor.distanceKm <= input.radiusKm) byId.set(competitor.placeId, competitor)
  }

  return computeCompetitionAnalysis({
    ...input,
    competitors: [...byId.values()].sort((a, b) => a.distanceKm - b.distanceKm),
  })
}
