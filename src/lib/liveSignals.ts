import type { WeatherSignal } from './lokScore'
import type { ResolvedLocation } from './resolveLocation'

export type LiveSourceId = 'geocoding' | 'overpass' | 'google_places' | 'weather'

export function collectFailedSources(
  location: ResolvedLocation,
  weather: WeatherSignal,
  weatherSkipped: boolean,
): LiveSourceId[] {
  const failed: LiveSourceId[] = []
  if (location.geocodeOk === false) failed.push('geocoding')
  if (!location.competitorQueryOk) failed.push(location.competitorSource === 'google_places' ? 'google_places' : 'overpass')
  if (!weatherSkipped && weather.source === 'unavailable') failed.push('weather')
  return failed
}

export function dataStatusFromFailures(failed: LiveSourceId[]): 'complete' | 'incomplete' {
  return failed.length === 0 ? 'complete' : 'incomplete'
}
