import { VILLAGES, type BusinessCategory, type Village } from '../data/villages'
import { REACH_KM } from './config'
import {
  densityFromCount,
  fetchCompetitorsNearby,
  geocodeLocationDetailed,
  reverseGeocodeDetailed,
  type CompetitorPoi,
  type GeocodeHit,
  type LiveFailureKind,
} from './geo'

export type DataProvenance = 'curated_seed' | 'live_lookup' | 'partial'

/** Which service the competitor lookup used, so a failure names the service that actually failed. */
export type CompetitorSource = 'overpass' | 'google_places'

export interface ResolvedLocation {
  id: string
  name: string
  nameKn: string
  district: string
  districtKn: string
  block: string
  lat: number
  lng: number
  population: number | null
  households: number | null
  nearbyMandi: string
  competitorDensity: Record<BusinessCategory, number>
  purchasingPowerIndex: number | null
  milkCoopPresence: boolean
  notes: string
  notesKn: string
  provenance: DataProvenance
  provenanceLabelEn: string
  provenanceLabelKn: string
  competitors: CompetitorPoi[]
  competitorQueryOk: boolean
  competitorError?: string
  /** Why the competitor lookup failed, when competitorQueryOk is false. */
  competitorFailure?: LiveFailureKind
  /** The service the competitor lookup used; absent means OpenStreetMap Overpass. */
  competitorSource?: CompetitorSource
  /** When the competitor POIs were actually fetched, if they came from the scan cache (epoch ms). */
  competitorsCachedAt?: number
  radiusKm: number
  /** False when Nominatim geocoding/reverse-geocoding was attempted and failed. */
  geocodeOk?: boolean
  /** Why reverse geocoding failed, when geocodeOk is false. */
  geocodeFailure?: LiveFailureKind
  /** When the geocode result was actually fetched, if it came from the scan cache (epoch ms). */
  geocodeCachedAt?: number
  /** True when festivals/mandi curated packs apply */
  hasCuratedSignals: boolean
}

export type LocationMode = 'curated' | 'live'

export function curatedLocationFromVillage(v: Village, radiusKm: number): ResolvedLocation {
  return {
    id: v.id,
    name: v.name,
    nameKn: v.nameKn,
    district: v.district,
    districtKn: v.districtKn,
    block: v.block,
    lat: v.lat,
    lng: v.lng,
    population: v.population,
    households: v.households,
    nearbyMandi: v.nearbyMandi,
    competitorDensity: { ...v.competitorDensity },
    purchasingPowerIndex: v.purchasingPowerIndex,
    milkCoopPresence: v.milkCoopPresence,
    notes: v.notes,
    notesKn: v.notesKn,
    provenance: 'curated_seed',
    provenanceLabelEn: `Curated local data for ${v.name}`,
    provenanceLabelKn: `${v.nameKn} ಗೆ ಕ್ಯುರೇಟೆಡ್ ಸ್ಥಳೀಯ ಡೇಟಾ`,
    competitors: [],
    competitorQueryOk: true,
    geocodeOk: true,
    radiusKm,
    hasCuratedSignals: true,
  }
}

function hitName(hit: GeocodeHit): string {
  return hit.village ?? hit.town ?? hit.city ?? hit.displayName.split(',')[0] ?? 'Location'
}

export async function resolveCuratedVillage(
  villageId: string,
  category: BusinessCategory,
  radiusKm: number = REACH_KM.default,
  demoMode = false,
): Promise<ResolvedLocation> {
  const v = VILLAGES.find((x) => x.id === villageId) ?? VILLAGES[0]
  const base = curatedLocationFromVillage(v, radiusKm)
  // Demo Mode: zero network calls, seeded data only — no Overpass enrichment attempt at all.
  if (demoMode) return base
  // Enrich curated map with live POIs when possible; keep seeded density as source of truth for score
  const live = await fetchCompetitorsNearby({
    lat: v.lat,
    lng: v.lng,
    category,
    radiusKm,
  })
  if (live.ok) {
    const cached = live.cachedAt != null
    return {
      ...base,
      competitors: live.pois,
      competitorQueryOk: true,
      competitorsCachedAt: live.cachedAt,
      provenanceLabelEn: `Curated local data for ${v.name} (map POIs from OpenStreetMap${cached ? ', cached' : ''})`,
      provenanceLabelKn: `${v.nameKn} ಕ್ಯುರೇಟೆಡ್ ಡೇಟಾ (ನಕ್ಷೆ POI: OpenStreetMap${cached ? ', ಸಂಗ್ರಹದಿಂದ' : ''})`,
    }
  }
  return {
    ...base,
    competitorQueryOk: false,
    competitorError: live.error,
    competitorFailure: live.failure,
    provenanceLabelEn: `Curated local data for ${v.name} (live map POIs unavailable)`,
    provenanceLabelKn: `${v.nameKn} ಕ್ಯುರೇಟೆಡ್ ಡೇಟಾ (ಲೈವ್ ನಕ್ಷೆ POI ಲಭ್ಯವಿಲ್ಲ)`,
  }
}

/** A specific reason a place search failed — a missing place and a busy or unreachable service need different next steps. */
function placeSearchError(failure: LiveFailureKind, query: string): { error: string; errorKn: string } {
  switch (failure) {
    case 'no_match':
      return {
        error: `No place called "${query}" was found in India. Check the spelling, or add the district or state.`,
        errorKn: `ಭಾರತದಲ್ಲಿ "${query}" ಎಂಬ ಸ್ಥಳ ಕಂಡುಬಂದಿಲ್ಲ. ಕಾಗುಣಿತ ಪರಿಶೀಲಿಸಿ, ಅಥವಾ ಜಿಲ್ಲೆ ಅಥವಾ ರಾಜ್ಯವನ್ನು ಸೇರಿಸಿ.`,
      }
    case 'rate_limited':
      return {
        error: 'The place-search service (OpenStreetMap Nominatim) is limiting requests right now. Wait a minute, then try again.',
        errorKn:
          'ಸ್ಥಳ ಹುಡುಕಾಟ ಸೇವೆ (OpenStreetMap Nominatim) ಈಗ ವಿನಂತಿಗಳನ್ನು ಮಿತಿಗೊಳಿಸುತ್ತಿದೆ. ಒಂದು ನಿಮಿಷ ಕಾಯಿರಿ, ನಂತರ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.',
      }
    case 'timed_out':
      return {
        error: 'The place-search service (OpenStreetMap Nominatim) took too long to answer — the connection may be slow. Try again.',
        errorKn:
          'ಸ್ಥಳ ಹುಡುಕಾಟ ಸೇವೆ (OpenStreetMap Nominatim) ಉತ್ತರಿಸಲು ತುಂಬಾ ಸಮಯ ತೆಗೆದುಕೊಂಡಿತು — ಸಂಪರ್ಕ ನಿಧಾನವಾಗಿರಬಹುದು. ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.',
      }
    case 'unreachable':
      return {
        error: "Couldn't reach the place-search service (OpenStreetMap Nominatim). Check the internet connection, then try again.",
        errorKn:
          'ಸ್ಥಳ ಹುಡುಕಾಟ ಸೇವೆಯನ್ನು (OpenStreetMap Nominatim) ತಲುಪಲಾಗಲಿಲ್ಲ. ಇಂಟರ್ನೆಟ್ ಸಂಪರ್ಕ ಪರಿಶೀಲಿಸಿ, ನಂತರ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.',
      }
  }
}

export async function resolveLiveLocation(input: {
  query?: string
  lat?: number
  lng?: number
  category: BusinessCategory
  radiusKm?: number
  competitorLookup?: typeof fetchCompetitorsNearby
  /** Which service competitorLookup calls; defaults to OpenStreetMap Overpass. */
  competitorSource?: CompetitorSource
}): Promise<{ ok: true; location: ResolvedLocation } | { ok: false; error: string; errorKn: string }> {
  const radiusKm = input.radiusKm ?? REACH_KM.default
  const competitorSource = input.competitorSource ?? 'overpass'
  const competitorService = competitorSource === 'google_places' ? 'Google Places' : 'Overpass'
  let hit: GeocodeHit | null = null
  let geocodeOk = true
  let geocodeFailure: LiveFailureKind | undefined
  let geocodeCachedAt: number | undefined

  if (input.lat != null && input.lng != null) {
    const reverse = await reverseGeocodeDetailed(input.lat, input.lng)
    hit = reverse.hit
    geocodeCachedAt = reverse.cachedAt
    if (!hit) {
      geocodeOk = false
      geocodeFailure = reverse.failure
      hit = {
        displayName: `${input.lat.toFixed(4)}, ${input.lng.toFixed(4)}`,
        lat: input.lat,
        lng: input.lng,
      }
    }
  } else if (input.query?.trim()) {
    const query = input.query.trim()
    const found = await geocodeLocationDetailed(query)
    if (!found.hit) return { ok: false, ...placeSearchError(found.failure ?? 'unreachable', query) }
    hit = found.hit
    geocodeCachedAt = found.cachedAt
  } else {
    return {
      ok: false,
      error: 'Enter a place name or use your location.',
      errorKn: 'ಸ್ಥಳದ ಹೆಸರು ನಮೂದಿಸಿ ಅಥವಾ ನಿಮ್ಮ ಸ್ಥಳವನ್ನು ಬಳಸಿ.',
    }
  }

  const name = hitName(hit)
  const district = hit.county ?? hit.state ?? 'Unknown district'
  const live = await (input.competitorLookup ?? fetchCompetitorsNearby)({
    lat: hit.lat,
    lng: hit.lng,
    category: input.category,
    radiusKm,
  })

  const density = densityFromCount(live.pois.length)
  const emptyDensity = {
    dairy: 0.5,
    retail: 0.5,
    food: 0.5,
    textiles: 0.5,
    poultry: 0.5,
    agri_processing: 0.5,
  } as Record<BusinessCategory, number>

  // Only fill the selected category from live count; others marked mid/unknown via 0.5
  // Spec: do not invent — if Overpass fails, mark density unavailable via competitorQueryOk
  const competitorDensity = { ...emptyDensity }
  if (live.ok) {
    competitorDensity[input.category] = density
  }

  const location: ResolvedLocation = {
    id: `live:${hit.lat.toFixed(4)},${hit.lng.toFixed(4)}`,
    name,
    nameKn: name,
    district,
    districtKn: district,
    block: hit.town ?? hit.city ?? name,
    lat: hit.lat,
    lng: hit.lng,
    population: null,
    households: null,
    nearbyMandi: live.ok ? `Nearest markets near ${name} (OSM)` : 'Mandi signal unavailable',
    competitorDensity,
    purchasingPowerIndex: null,
    milkCoopPresence: false,
    notes: live.ok
      ? `Live lookup: ${live.pois.length} similar POIs within ${radiusKm} km (${competitorSource === 'google_places' ? 'Google Places' : 'OpenStreetMap Overpass'}). Population/PPI not available — not fabricated.`
      : `Live geocode ok, but competitor ${competitorService} failed: ${live.error}. Density not fabricated.`,
    notesKn: live.ok
      ? `ಲೈವ್ ಹುಡುಕಾಟ: ${radiusKm} ಕಿ.ಮೀ. ಒಳಗೆ ${live.pois.length} POI. ಜನಸಂಖ್ಯೆ/PPI ಲಭ್ಯವಿಲ್ಲ — ಕಲ್ಪಿತವಲ್ಲ.`
      : `ಜಿಯೋಕೋಡ್ ಸರಿ; ${competitorService} ವಿಫಲ: ಸಾಂದ್ರತೆ ಕಲ್ಪಿಸಲಾಗಿಲ್ಲ.`,
    provenance: live.ok ? 'live_lookup' : 'partial',
    provenanceLabelEn: live.ok
      ? `Live lookup for ${name}${live.cachedAt != null ? ' (cached)' : ''}`
      : `Partial live lookup for ${name} (competitors unavailable)`,
    provenanceLabelKn: live.ok
      ? `${name} ಗೆ ಲೈವ್ ಹುಡುಕಾಟ${live.cachedAt != null ? ' (ಸಂಗ್ರಹದಿಂದ)' : ''}`
      : `${name} ಭಾಗಶಃ ಲೈವ್ (ಸ್ಪರ್ಧಿಗಳು ಲಭ್ಯವಿಲ್ಲ)`,
    competitors: live.pois,
    competitorQueryOk: live.ok,
    competitorError: live.error,
    competitorFailure: live.failure,
    competitorSource,
    competitorsCachedAt: live.cachedAt,
    geocodeOk,
    geocodeFailure,
    geocodeCachedAt,
    radiusKm,
    hasCuratedSignals: false,
  }

  return { ok: true, location }
}

/** Adapter so existing Village-typed APIs can consume ResolvedLocation. */
export function asVillageView(loc: ResolvedLocation): Village {
  return {
    id: loc.id,
    name: loc.name,
    nameKn: loc.nameKn,
    district: loc.district,
    districtKn: loc.districtKn,
    block: loc.block,
    lat: loc.lat,
    lng: loc.lng,
    population: loc.population ?? 0,
    households: loc.households ?? 0,
    nearbyMandi: loc.nearbyMandi,
    competitorDensity: loc.competitorDensity,
    purchasingPowerIndex: loc.purchasingPowerIndex ?? 0.55,
    milkCoopPresence: loc.milkCoopPresence,
    notes: loc.notes,
    notesKn: loc.notesKn,
  }
}
