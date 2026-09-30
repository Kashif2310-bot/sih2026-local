import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VILLAGES } from '../data/villages'
import type { CompetitorPoi, GeocodeHit, LiveFailureKind } from './geo'

/**
 * Pure-logic unit tests for resolveLocation.ts, mocking ./geo entirely (no
 * real network, and no re-testing of geo.ts's own HTTP/parsing behavior —
 * see geo.test.ts for that). These cover resolveLocation.ts's own job:
 * orchestrating geocode/reverse-geocode/competitor results into a
 * ResolvedLocation without ever fabricating a value the sources didn't
 * provide.
 */

const fetchCompetitorsNearby = vi.fn()
const geocodeLocationDetailed = vi.fn()
const reverseGeocodeDetailed = vi.fn()

vi.mock('./geo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./geo')>()
  return {
    ...actual,
    fetchCompetitorsNearby: (...args: unknown[]) => fetchCompetitorsNearby(...args),
    geocodeLocationDetailed: (...args: unknown[]) => geocodeLocationDetailed(...args),
    reverseGeocodeDetailed: (...args: unknown[]) => reverseGeocodeDetailed(...args),
  }
})

const { curatedLocationFromVillage, resolveCuratedVillage, resolveLiveLocation, asVillageView } = await import(
  './resolveLocation'
)

const DINKA = VILLAGES.find((v) => v.id === 'dinka-mandya')!

function poi(id: string, lat: number, lng: number): CompetitorPoi {
  return { id, name: `POI ${id}`, lat, lng, tags: {} }
}

describe('curatedLocationFromVillage', () => {
  it('maps every field from the Village fixture and marks it a real curated seed', () => {
    const loc = curatedLocationFromVillage(DINKA, 7)
    expect(loc.id).toBe(DINKA.id)
    expect(loc.district).toBe(DINKA.district)
    expect(loc.provenance).toBe('curated_seed')
    expect(loc.competitorQueryOk).toBe(true)
    expect(loc.geocodeOk).toBe(true)
    expect(loc.hasCuratedSignals).toBe(true)
    expect(loc.radiusKm).toBe(7)
  })

  it('copies competitorDensity rather than aliasing the source village record', () => {
    const loc = curatedLocationFromVillage(DINKA, 7)
    loc.competitorDensity.dairy = 0.99
    expect(DINKA.competitorDensity.dairy).not.toBe(0.99)
  })
})

describe('resolveCuratedVillage', () => {
  beforeEach(() => {
    fetchCompetitorsNearby.mockReset()
  })

  it('demo mode makes zero network calls and returns the seeded curated location as-is', async () => {
    const loc = await resolveCuratedVillage('dinka-mandya', 'dairy', 7, true)
    expect(fetchCompetitorsNearby).not.toHaveBeenCalled()
    expect(loc.provenance).toBe('curated_seed')
    expect(loc.id).toBe('dinka-mandya')
  })

  it('merges live competitor POIs into the curated seed when Overpass succeeds', async () => {
    fetchCompetitorsNearby.mockResolvedValue({ ok: true, pois: [poi('1', 1, 1)] })
    const loc = await resolveCuratedVillage('dinka-mandya', 'dairy', 7, false)
    expect(loc.competitors).toHaveLength(1)
    expect(loc.competitorQueryOk).toBe(true)
    expect(loc.provenanceLabelEn).toContain('OpenStreetMap')
    // Seeded density stays the source of truth for scoring even when live POIs are merged in.
    expect(loc.competitorDensity).toEqual(DINKA.competitorDensity)
  })

  it('keeps the curated seed but marks competitors unavailable, with the real error, when Overpass fails', async () => {
    fetchCompetitorsNearby.mockResolvedValue({ ok: false, pois: [], error: 'Overpass rate-limited this request (HTTP 429)', failure: 'rate_limited' })
    const loc = await resolveCuratedVillage('dinka-mandya', 'dairy', 7, false)
    expect(loc.competitorQueryOk).toBe(false)
    expect(loc.competitorError).toBe('Overpass rate-limited this request (HTTP 429)')
    expect(loc.competitorFailure).toBe('rate_limited')
    expect(loc.provenanceLabelEn).toContain('unavailable')
    // Never silently loses the seeded density just because the live enrichment failed.
    expect(loc.competitorDensity).toEqual(DINKA.competitorDensity)
  })

  it('falls back to the first village for an unknown villageId, rather than throwing', async () => {
    fetchCompetitorsNearby.mockResolvedValue({ ok: true, pois: [] })
    const loc = await resolveCuratedVillage('no-such-village', 'dairy', 7, false)
    expect(loc.id).toBe(VILLAGES[0].id)
  })
})

describe('resolveLiveLocation', () => {
  beforeEach(() => {
    fetchCompetitorsNearby.mockReset()
    geocodeLocationDetailed.mockReset()
    reverseGeocodeDetailed.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('rejects with a clear message when neither a query nor coordinates are given, without calling any geo function', async () => {
    const result = await resolveLiveLocation({ category: 'dairy' })
    expect(result.ok).toBe(false)
    expect(geocodeLocationDetailed).not.toHaveBeenCalled()
    expect(reverseGeocodeDetailed).not.toHaveBeenCalled()
  })

  it('reports a clear failure, not a fabricated location, when forward geocoding fails entirely', async () => {
    geocodeLocationDetailed.mockResolvedValue({ hit: null, failure: 'no_match' })
    const result = await resolveLiveLocation({ query: 'Nowhere Real', category: 'dairy' })
    expect(result.ok).toBe(false)
    expect(fetchCompetitorsNearby).not.toHaveBeenCalled()
  })

  it('gives a different, specific message for each way a place search can fail', async () => {
    const expected: Array<[LiveFailureKind, string]> = [
      ['no_match', 'No place called "Nowhere Real" was found in India'],
      ['rate_limited', 'is limiting requests right now'],
      ['timed_out', 'took too long to answer'],
      ['unreachable', "Couldn't reach the place-search service"],
    ]
    const messages = new Set<string>()
    const messagesKn = new Set<string>()
    for (const [failure, text] of expected) {
      geocodeLocationDetailed.mockResolvedValue({ hit: null, failure })
      const result = await resolveLiveLocation({ query: 'Nowhere Real', category: 'dairy' })
      expect(result.ok).toBe(false)
      if (result.ok) continue
      expect(result.error).toContain(text)
      expect(result.errorKn.length).toBeGreaterThan(0)
      messages.add(result.error)
      messagesKn.add(result.errorKn)
    }
    expect(messages.size).toBe(4)
    expect(messagesKn.size).toBe(4)
  })

  it('never tells a rate-limited citizen that their place does not exist', async () => {
    geocodeLocationDetailed.mockResolvedValue({ hit: null, failure: 'rate_limited' })
    const result = await resolveLiveLocation({ query: 'Mandya', category: 'dairy' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).not.toContain('No place called')
  })

  it('on a successful geocode + successful Overpass, fills only the selected category from the real count and marks others 0.5 (never fabricated)', async () => {
    const hit: GeocodeHit = { displayName: 'Hassan, Karnataka, India', lat: 13.0033, lng: 76.1004, county: 'Hassan' }
    geocodeLocationDetailed.mockResolvedValue({ hit })
    fetchCompetitorsNearby.mockResolvedValue({ ok: true, pois: [poi('1', 13, 76), poi('2', 13, 76)] })

    const result = await resolveLiveLocation({ query: 'Hassan', category: 'poultry' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.location.provenance).toBe('live_lookup')
    expect(result.location.district).toBe('Hassan')
    expect(result.location.competitorDensity.poultry).toBeCloseTo(2 / 12)
    expect(result.location.competitorDensity.dairy).toBe(0.5) // untouched category stays neutral, not guessed
    expect(result.location.population).toBeNull() // never fabricated
    expect(result.location.competitorQueryOk).toBe(true)
  })

  it('on a successful geocode but a failed Overpass, marks partial provenance and leaves ALL densities neutral, including the selected category', async () => {
    const hit: GeocodeHit = { displayName: 'Somewhere, India', lat: 20, lng: 78 }
    geocodeLocationDetailed.mockResolvedValue({ hit })
    fetchCompetitorsNearby.mockResolvedValue({ ok: false, pois: [], error: 'Overpass timed out', failure: 'timed_out' })

    const result = await resolveLiveLocation({ query: 'Somewhere', category: 'textiles' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.location.provenance).toBe('partial')
    expect(result.location.competitorQueryOk).toBe(false)
    expect(result.location.competitorFailure).toBe('timed_out')
    expect(result.location.competitorDensity.textiles).toBe(0.5)
    expect(result.location.notes).toContain('not fabricated')
  })

  it('when given coordinates and reverse-geocoding succeeds, uses the real place name/district', async () => {
    reverseGeocodeDetailed.mockResolvedValue({
      hit: { displayName: 'Kunigal, Tumakuru', lat: 13.02, lng: 77.02, town: 'Kunigal', county: 'Tumakuru' } satisfies GeocodeHit,
    })
    fetchCompetitorsNearby.mockResolvedValue({ ok: true, pois: [] })

    const result = await resolveLiveLocation({ lat: 13.02, lng: 77.02, category: 'dairy' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.location.name).toBe('Kunigal')
    expect(result.location.district).toBe('Tumakuru')
    expect(result.location.geocodeOk).toBe(true)
  })

  it('when given coordinates and reverse-geocoding fails, still proceeds using the raw coordinates (geocodeOk: false) rather than bailing out entirely', async () => {
    reverseGeocodeDetailed.mockResolvedValue({ hit: null, failure: 'rate_limited' })
    fetchCompetitorsNearby.mockResolvedValue({ ok: true, pois: [] })

    const result = await resolveLiveLocation({ lat: 15.5, lng: 80.1, category: 'dairy' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // Unlike a failed forward geocode (which has nothing to fall back to), a
    // failed reverse geocode still has the coordinates themselves to work with.
    expect(result.location.geocodeOk).toBe(false)
    expect(result.location.geocodeFailure).toBe('rate_limited')
    expect(result.location.lat).toBe(15.5)
    expect(result.location.lng).toBe(80.1)
  })
})

describe('asVillageView', () => {
  it('substitutes honest defaults for fields a live location never has (population/households/PPI)', () => {
    const view = asVillageView({
      id: 'live:1,1',
      name: 'X',
      nameKn: 'X',
      district: 'Y',
      districtKn: 'Y',
      block: 'X',
      lat: 1,
      lng: 1,
      population: null,
      households: null,
      nearbyMandi: 'n/a',
      competitorDensity: { dairy: 0.5, retail: 0.5, food: 0.5, textiles: 0.5, poultry: 0.5, agri_processing: 0.5 },
      purchasingPowerIndex: null,
      milkCoopPresence: false,
      notes: '',
      notesKn: '',
      provenance: 'live_lookup',
      provenanceLabelEn: '',
      provenanceLabelKn: '',
      competitors: [],
      competitorQueryOk: true,
      radiusKm: 7,
      hasCuratedSignals: false,
    })
    expect(view.population).toBe(0)
    expect(view.households).toBe(0)
    expect(view.purchasingPowerIndex).toBe(0.55)
  })
})
