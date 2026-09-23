import type { BusinessCategory } from '../data/villages'
import { NOMINATIM_TIMEOUT_MS, OVERPASS_TIMEOUT_MS, REACH_KM } from './config'
import { retryOnceIf } from './retry'

export interface GeocodeHit {
  displayName: string
  lat: number
  lng: number
  village?: string
  town?: string
  city?: string
  state?: string
  county?: string
}

export interface CompetitorPoi {
  id: string
  name: string
  lat: number
  lng: number
  tags: Record<string, string>
}

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
]

function categoryOverpassFilter(category: BusinessCategory): string {
  switch (category) {
    case 'dairy':
      return `node["shop"="dairy"](around:{r},{lat},{lng});node["shop"="cheese"](around:{r},{lat},{lng});node["craft"="dairy"](around:{r},{lat},{lng});`
    case 'retail':
      return `node["shop"="convenience"](around:{r},{lat},{lng});node["shop"="supermarket"](around:{r},{lat},{lng});node["shop"="general"](around:{r},{lat},{lng});`
    case 'food':
      return `node["amenity"="restaurant"](around:{r},{lat},{lng});node["amenity"="fast_food"](around:{r},{lat},{lng});node["amenity"="cafe"](around:{r},{lat},{lng});`
    case 'textiles':
      return `node["shop"="clothes"](around:{r},{lat},{lng});node["shop"="fabric"](around:{r},{lat},{lng});node["shop"="textile"](around:{r},{lat},{lng});`
    case 'poultry':
      return `node["shop"="butcher"](around:{r},{lat},{lng});node["shop"="poultry"](around:{r},{lat},{lng});`
    case 'agri_processing':
      return `node["craft"="winery"](around:{r},{lat},{lng});node["industrial"="food_processing"](around:{r},{lat},{lng});node["shop"="farm"](around:{r},{lat},{lng});`
    default:
      return `node["shop"](around:{r},{lat},{lng});`
  }
}

export async function geocodeLocation(query: string): Promise<GeocodeHit | null> {
  const q = query.trim()
  if (!q) return null
  return retryOnceIf(() => geocodeLocationOnce(q), (hit) => hit == null)
}

async function geocodeLocationOnce(q: string): Promise<GeocodeHit | null> {
  const url =
    `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=1&countrycodes=in&q=` +
    encodeURIComponent(q)
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), NOMINATIM_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) return null
    const data = (await res.json()) as Array<{
      display_name: string
      lat: string
      lon: string
      address?: Record<string, string>
    }>
    if (!data?.length) return null
    const hit = data[0]
    const a = hit.address ?? {}
    return {
      displayName: hit.display_name,
      lat: Number(hit.lat),
      lng: Number(hit.lon),
      village: a.village ?? a.hamlet,
      town: a.town,
      city: a.city,
      state: a.state,
      county: a.county ?? a.state_district,
    }
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}

export async function reverseGeocode(lat: number, lng: number): Promise<GeocodeHit | null> {
  return retryOnceIf(() => reverseGeocodeOnce(lat, lng), (hit) => hit == null)
}

async function reverseGeocodeOnce(lat: number, lng: number): Promise<GeocodeHit | null> {
  const url =
    `https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&lat=${lat}&lon=${lng}`
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), NOMINATIM_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) return null
    const hit = (await res.json()) as {
      display_name?: string
      lat?: string
      lon?: string
      address?: Record<string, string>
    }
    if (!hit?.lat || !hit?.lon) return null
    const a = hit.address ?? {}
    return {
      displayName: hit.display_name ?? `${lat}, ${lng}`,
      lat: Number(hit.lat),
      lng: Number(hit.lon),
      village: a.village ?? a.hamlet,
      town: a.town,
      city: a.city,
      state: a.state,
      county: a.county ?? a.state_district,
    }
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}

async function queryOverpassEndpoint(
  endpoint: string,
  query: string,
): Promise<CompetitorPoi[]> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), OVERPASS_TIMEOUT_MS)
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(query)}`,
    })
    if (!res.ok) throw new Error(`Overpass endpoint returned ${res.status}`)
    const data = (await res.json()) as {
      elements?: Array<{
        id: number
        lat?: number
        lon?: number
        center?: { lat: number; lon: number }
        tags?: Record<string, string>
      }>
    }
    return (data.elements ?? [])
      .map((el) => {
        const lat = el.lat ?? el.center?.lat
        const lng = el.lon ?? el.center?.lon
        if (lat == null || lng == null) return null
        return {
          id: String(el.id),
          name: el.tags?.name ?? el.tags?.shop ?? el.tags?.amenity ?? 'Unnamed',
          lat,
          lng,
          tags: el.tags ?? {},
        }
      })
      .filter((x): x is CompetitorPoi => x != null)
  } finally {
    clearTimeout(t)
  }
}

export async function fetchCompetitorsNearby(input: {
  lat: number
  lng: number
  category: BusinessCategory
  radiusKm?: number
}): Promise<{ ok: boolean; pois: CompetitorPoi[]; error?: string }> {
  return retryOnceIf(() => fetchCompetitorsNearbyOnce(input), (r) => !r.ok)
}

async function fetchCompetitorsNearbyOnce(input: {
  lat: number
  lng: number
  category: BusinessCategory
  radiusKm?: number
}): Promise<{ ok: boolean; pois: CompetitorPoi[]; error?: string }> {
  const radiusM = Math.round((input.radiusKm ?? REACH_KM.default) * 1000)
  const filter = categoryOverpassFilter(input.category)
    .replaceAll('{r}', String(radiusM))
    .replaceAll('{lat}', String(input.lat))
    .replaceAll('{lng}', String(input.lng))
  const query = `[out:json][timeout:25];(${filter});out center 80;`

  // Race both mirrors in parallel (not sequential try-then-fallback) so a
  // dead/slow endpoint never doubles the wait — worst case stays bounded to
  // one OVERPASS_TIMEOUT_MS, not one per endpoint. Critical for a live demo.
  try {
    const pois = await Promise.any(
      OVERPASS_ENDPOINTS.map((endpoint) => queryOverpassEndpoint(endpoint, query)),
    )
    return { ok: true, pois }
  } catch {
    return { ok: false, pois: [], error: 'Overpass unreachable or returned no data' }
  }
}

/** Density 0–1 from POI count within radius (saturating at ~12 competitors). */
export function densityFromCount(count: number): number {
  return Math.max(0, Math.min(1, count / 12))
}

export function areaKm2(radiusKm: number): number {
  return Math.PI * radiusKm * radiusKm
}

/** Great-circle distance between two lat/lng points, in km (haversine). */
export function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
}
