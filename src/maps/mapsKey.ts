/**
 * The Google Maps browser key, or '' when it is unset or blank. Without a key the app keeps its
 * keyless paths: OpenStreetMap Overpass for competitors and the village list on /apply.
 */
export function mapsApiKey(): string {
  return import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim() ?? ''
}

export function mapsKeyConfigured(): boolean {
  return mapsApiKey() !== ''
}
