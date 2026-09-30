import type { BusinessCategory } from '../data/villages'
import { NOMINATIM_MIN_INTERVAL_MS, NOMINATIM_TIMEOUT_MS, OVERPASS_TIMEOUT_MS, REACH_KM } from './config'
import { retryOnceIf, wait } from './retry'

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

// Nominatim usage policy (operations.osmfoundation.org/policies/nominatim):
// at most 1 request per second, and a valid HTTP Referer or User-Agent
// identifying the application. Every Nominatim request — retries included —
// waits for its slot here. The slot is reserved before awaiting, so
// concurrent callers queue up rather than firing together.
let nominatimNextSlotAt = 0

async function waitForNominatimSlot(): Promise<void> {
  const now = Date.now()
  const slotAt = Math.max(now, nominatimNextSlotAt)
  nominatimNextSlotAt = slotAt + NOMINATIM_MIN_INTERVAL_MS
  if (slotAt > now) await wait(slotAt - now)
}

/** Clears the request spacing — for tests only, so one test's calls don't delay the next test's. */
export function resetNominatimRateLimit(): void {
  nominatimNextSlotAt = 0
}

// Browsers don't let page scripts set User-Agent (Chrome drops it), so the
// app identifies itself the way the policy allows for web pages: the
// Referer. Set explicitly so a page-wide referrer policy added later can't
// silently strip it.
const NOMINATIM_FETCH_INIT: RequestInit = {
  headers: { Accept: 'application/json' },
  referrerPolicy: 'strict-origin-when-cross-origin',
}

/**
 * Why a live lookup produced no usable data. Kept distinct rather than
 * collapsed into one "failed", so the UI can say what actually happened:
 *   rate_limited - the service answered HTTP 429 (asked us to slow down)
 *   timed_out    - HTTP 504, our own request timeout, or an Overpass
 *                  "runtime error" remark (the query ran out of time/memory)
 *   unreachable  - a network error, or any other bad response
 *   no_match     - the service answered and found nothing for the query
 */
export type LiveFailureKind = 'rate_limited' | 'timed_out' | 'unreachable' | 'no_match'

export type GeocodeResult = { hit: GeocodeHit; failure?: undefined } | { hit: null; failure: LiveFailureKind }

/**
 * Only a transient failure is worth the one quick retry. Not a 429:
 * Overpass asks clients to "pause for 30 seconds", and Nominatim blocks
 * clients that keep hammering it. Not a "no match" either: Nominatim's
 * policy warns that "clients sending repeatedly the same query may be
 * classified as faulty and blocked".
 */
function isTransient(failure: LiveFailureKind | undefined): boolean {
  return failure === 'timed_out' || failure === 'unreachable'
}

function failureFromStatus(status: number): LiveFailureKind {
  if (status === 429) return 'rate_limited'
  if (status === 504) return 'timed_out'
  return 'unreachable'
}

export async function geocodeLocation(query: string): Promise<GeocodeHit | null> {
  const q = query.trim()
  if (!q) return null
  return (await geocodeLocationDetailed(q)).hit
}

/** Like geocodeLocation, but says why when there is no hit. */
export async function geocodeLocationDetailed(query: string): Promise<GeocodeResult> {
  const q = query.trim()
  if (!q) return { hit: null, failure: 'no_match' }
  return retryOnceIf(() => geocodeLocationOnce(q), (r) => r.hit == null && isTransient(r.failure))
}

async function geocodeLocationOnce(q: string): Promise<GeocodeResult> {
  const url =
    `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=1&countrycodes=in&q=` +
    encodeURIComponent(q)
  await waitForNominatimSlot()
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), NOMINATIM_TIMEOUT_MS)
  try {
    const res = await fetch(url, { ...NOMINATIM_FETCH_INIT, signal: ctrl.signal })
    if (!res.ok) return { hit: null, failure: failureFromStatus(res.status) }
    const data = (await res.json()) as Array<{
      display_name: string
      lat: string
      lon: string
      address?: Record<string, string>
    }>
    if (!data?.length) return { hit: null, failure: 'no_match' }
    const hit = data[0]
    const a = hit.address ?? {}
    return {
      hit: {
        displayName: hit.display_name,
        lat: Number(hit.lat),
        lng: Number(hit.lon),
        village: a.village ?? a.hamlet,
        town: a.town,
        city: a.city,
        state: a.state,
        county: a.county ?? a.state_district,
      },
    }
  } catch {
    return { hit: null, failure: ctrl.signal.aborted ? 'timed_out' : 'unreachable' }
  } finally {
    clearTimeout(t)
  }
}

export async function reverseGeocode(lat: number, lng: number): Promise<GeocodeHit | null> {
  return (await reverseGeocodeDetailed(lat, lng)).hit
}

/** Like reverseGeocode, but says why when there is no hit. */
export async function reverseGeocodeDetailed(lat: number, lng: number): Promise<GeocodeResult> {
  return retryOnceIf(() => reverseGeocodeOnce(lat, lng), (r) => r.hit == null && isTransient(r.failure))
}

async function reverseGeocodeOnce(lat: number, lng: number): Promise<GeocodeResult> {
  const url =
    `https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&lat=${lat}&lon=${lng}`
  await waitForNominatimSlot()
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), NOMINATIM_TIMEOUT_MS)
  try {
    const res = await fetch(url, { ...NOMINATIM_FETCH_INIT, signal: ctrl.signal })
    if (!res.ok) return { hit: null, failure: failureFromStatus(res.status) }
    const hit = (await res.json()) as {
      display_name?: string
      lat?: string
      lon?: string
      address?: Record<string, string>
    }
    if (!hit?.lat || !hit?.lon) return { hit: null, failure: 'no_match' }
    const a = hit.address ?? {}
    return {
      hit: {
        displayName: hit.display_name ?? `${lat}, ${lng}`,
        lat: Number(hit.lat),
        lng: Number(hit.lon),
        village: a.village ?? a.hamlet,
        town: a.town,
        city: a.city,
        state: a.state,
        county: a.county ?? a.state_district,
      },
    }
  } catch {
    return { hit: null, failure: ctrl.signal.aborted ? 'timed_out' : 'unreachable' }
  } finally {
    clearTimeout(t)
  }
}

/** One Overpass mirror's reason for giving no answer — thrown so Promise.any can race the mirrors. */
class OverpassFailure extends Error {
  readonly failure: LiveFailureKind

  constructor(failure: LiveFailureKind, message: string) {
    super(message)
    this.failure = failure
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
    if (!res.ok) throw new OverpassFailure(failureFromStatus(res.status), `Overpass endpoint returned ${res.status}`)
    const data = (await res.json()) as {
      remark?: string
      elements?: Array<{
        id: number
        lat?: number
        lon?: number
        center?: { lat: number; lon: number }
        tags?: Record<string, string>
      }>
    }
    // An overloaded Overpass can answer 200 with a "runtime error" remark
    // (the query timed out or ran out of memory) and partial or no elements.
    // That is a failed lookup, not "no competitors here".
    if (data.remark?.includes('runtime error')) throw new OverpassFailure('timed_out', data.remark)
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
  } catch (err) {
    if (err instanceof OverpassFailure) throw err
    throw new OverpassFailure(ctrl.signal.aborted ? 'timed_out' : 'unreachable', String(err))
  } finally {
    clearTimeout(t)
  }
}

export interface CompetitorLookup {
  ok: boolean
  pois: CompetitorPoi[]
  error?: string
  /** Why the lookup failed, when ok is false. Finding 0 competitors is ok: true — a real result, not a failure. */
  failure?: LiveFailureKind
}

export async function fetchCompetitorsNearby(input: {
  lat: number
  lng: number
  category: BusinessCategory
  radiusKm?: number
}): Promise<CompetitorLookup> {
  return retryOnceIf(() => fetchCompetitorsNearbyOnce(input), (r) => !r.ok && isTransient(r.failure))
}

const OVERPASS_FAILURE_MESSAGES: Record<LiveFailureKind, string> = {
  rate_limited: 'Overpass rate-limited this request (HTTP 429)',
  timed_out: 'Overpass timed out',
  unreachable: 'Overpass unreachable',
  no_match: 'Overpass returned no data',
}

// When both mirrors fail, report the most actionable reason: a rate limit
// (retrying now makes it worse), then a timeout (servers busy), then unreachable.
const OVERPASS_FAILURE_PRIORITY: LiveFailureKind[] = ['rate_limited', 'timed_out', 'unreachable']

async function fetchCompetitorsNearbyOnce(input: {
  lat: number
  lng: number
  category: BusinessCategory
  radiusKm?: number
}): Promise<CompetitorLookup> {
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
  } catch (err) {
    const reasons = err instanceof AggregateError ? err.errors : []
    const failures = reasons.map((e): LiveFailureKind => (e instanceof OverpassFailure ? e.failure : 'unreachable'))
    const failure = OVERPASS_FAILURE_PRIORITY.find((f) => failures.includes(f)) ?? 'unreachable'
    return { ok: false, pois: [], error: OVERPASS_FAILURE_MESSAGES[failure], failure }
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
