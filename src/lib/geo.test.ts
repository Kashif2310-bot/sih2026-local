import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  areaKm2,
  densityFromCount,
  distanceKm,
  fetchCompetitorsNearby,
  geocodeLocation,
  resetNominatimRateLimit,
  reverseGeocode,
} from './geo'
import { NOMINATIM_MIN_INTERVAL_MS } from './config'

/**
 * Pure-logic unit tests for geo.ts, mocking global.fetch — no real network
 * calls. Coverage of the actual live Nominatim/Overpass behavior remains
 * e2e-only (see e2e/demo-mode.spec.ts, e2e/network-timeout.spec.ts); these
 * tests cover the parsing, retry, and "never fabricate on failure" contracts
 * that don't need a real server to verify.
 */

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as Response
}

describe('geocodeLocation', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    resetNominatimRateLimit()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns null for an empty/whitespace query without ever calling fetch', async () => {
    expect(await geocodeLocation('   ')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('parses a real-shaped Nominatim response into a GeocodeHit', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse([
        {
          display_name: 'Mandya, Karnataka, India',
          lat: '12.5242',
          lon: '76.8958',
          address: { village: 'Dinka', state: 'Karnataka', state_district: 'Mandya' },
        },
      ]),
    )
    const hit = await geocodeLocation('Dinka, Mandya')
    expect(hit).toEqual({
      displayName: 'Mandya, Karnataka, India',
      lat: 12.5242,
      lng: 76.8958,
      village: 'Dinka',
      town: undefined,
      city: undefined,
      state: 'Karnataka',
      county: 'Mandya',
    })
  })

  it('retries exactly once and returns the successful retry result', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([])).mockResolvedValueOnce(
      jsonResponse([{ display_name: 'Hassan, Karnataka, India', lat: '13.0033', lon: '76.1004' }]),
    )
    const hit = await geocodeLocation('Hassan')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(hit?.displayName).toBe('Hassan, Karnataka, India')
  })

  it('never fabricates a result — returns null (not a retry loop, not a guess) when every attempt is empty', async () => {
    fetchMock.mockResolvedValue(jsonResponse([]))
    expect(await geocodeLocation('Nowhere Real')).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(2) // one attempt + one retry, per retryOnceIf
  })

  it('returns null, not a thrown error, on a non-ok HTTP response', async () => {
    fetchMock.mockResolvedValue(jsonResponse(null, false, 503))
    await expect(geocodeLocation('anything')).resolves.toBeNull()
  })

  it('returns null, not a thrown error, when fetch itself rejects (network failure)', async () => {
    fetchMock.mockRejectedValue(new Error('network down'))
    await expect(geocodeLocation('anything')).resolves.toBeNull()
  })
})

describe('reverseGeocode', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    resetNominatimRateLimit()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('parses a real-shaped reverse-geocode response', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        display_name: 'Kunigal, Tumakuru, Karnataka, India',
        lat: '13.0232',
        lon: '77.0252',
        address: { town: 'Kunigal', state: 'Karnataka', state_district: 'Tumakuru' },
      }),
    )
    const hit = await reverseGeocode(13.0232, 77.0252)
    expect(hit).toMatchObject({ lat: 13.0232, lng: 77.0252, town: 'Kunigal', county: 'Tumakuru' })
  })

  it('returns null (not a guessed location) when the response has no coordinates', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}))
    expect(await reverseGeocode(1, 1)).toBeNull()
  })
})

describe('Nominatim usage policy', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  const fetchTimes: number[] = []
  const HIT = [{ display_name: 'Mandya, Karnataka, India', lat: '12.5242', lon: '76.8958' }]
  const REVERSE_HIT = { display_name: 'Mandya, Karnataka, India', lat: '12.5242', lon: '76.8958' }
  const answer = (url: unknown) => jsonResponse(String(url).includes('/reverse') ? REVERSE_HIT : HIT)
  const gaps = () => fetchTimes.slice(1).map((t, i) => t - fetchTimes[i]!)

  beforeEach(() => {
    vi.useFakeTimers()
    fetchTimes.length = 0
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    resetNominatimRateLimit()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('spaces concurrent requests at least 1 second apart (policy: max 1 request/second)', async () => {
    fetchMock.mockImplementation((url: unknown) => {
      fetchTimes.push(Date.now())
      return Promise.resolve(answer(url))
    })
    const both = Promise.all([geocodeLocation('Mandya'), reverseGeocode(12.52, 76.9)])
    await vi.advanceTimersByTimeAsync(5_000)
    await both
    expect(fetchTimes).toHaveLength(2)
    for (const gap of gaps()) expect(gap).toBeGreaterThanOrEqual(NOMINATIM_MIN_INTERVAL_MS)
  })

  it('makes the retry wait for its slot too, not just the backoff', async () => {
    fetchMock.mockImplementation(() => {
      fetchTimes.push(Date.now())
      return Promise.resolve(jsonResponse(fetchTimes.length === 1 ? [] : HIT))
    })
    const result = geocodeLocation('Mandya')
    await vi.advanceTimersByTimeAsync(5_000)
    expect(await result).not.toBeNull()
    expect(fetchTimes).toHaveLength(2)
    for (const gap of gaps()) expect(gap).toBeGreaterThanOrEqual(NOMINATIM_MIN_INTERVAL_MS)
  })

  it('always sends a Referer policy that identifies the app (browsers cannot set User-Agent)', async () => {
    fetchMock.mockImplementation((url: unknown) => Promise.resolve(answer(url)))
    const both = Promise.all([geocodeLocation('Mandya'), reverseGeocode(12.52, 76.9)])
    await vi.advanceTimersByTimeAsync(5_000)
    await both
    expect(fetchMock).toHaveBeenCalledTimes(2)
    for (const [, init] of fetchMock.mock.calls as Array<[string, RequestInit]>) {
      expect(init.referrerPolicy).toBe('strict-origin-when-cross-origin')
    }
  })
})

describe('fetchCompetitorsNearby', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('parses Overpass elements, preferring lat/lon then falling back to center, and the name-tag fallback chain', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        elements: [
          { id: 1, lat: 12.1, lon: 77.1, tags: { name: 'Shivaji Dairy', shop: 'dairy' } },
          { id: 2, center: { lat: 12.2, lon: 77.2 }, tags: { shop: 'dairy' } }, // no name -> falls back to shop
          { id: 3, tags: { amenity: 'cafe' } }, // no lat/lon/center at all -> dropped
        ],
      }),
    )
    const result = await fetchCompetitorsNearby({ lat: 12.15, lng: 77.15, category: 'dairy' })
    expect(result.ok).toBe(true)
    expect(result.pois).toHaveLength(2)
    expect(result.pois[0]).toMatchObject({ id: '1', name: 'Shivaji Dairy', lat: 12.1, lng: 77.1 })
    expect(result.pois[1]).toMatchObject({ id: '2', name: 'dairy', lat: 12.2, lng: 77.2 })
  })

  it('succeeds if only one of the two mirror endpoints responds (Promise.any race)', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('kumi.systems')) return Promise.reject(new Error('mirror down'))
      return Promise.resolve(jsonResponse({ elements: [{ id: 9, lat: 1, lon: 1, tags: {} }] }))
    })
    const result = await fetchCompetitorsNearby({ lat: 1, lng: 1, category: 'retail' })
    expect(result.ok).toBe(true)
    expect(result.pois).toHaveLength(1)
  })

  it('reports ok:false with an honest error, never a fabricated empty-success, when both endpoints fail', async () => {
    fetchMock.mockRejectedValue(new Error('all mirrors down'))
    const result = await fetchCompetitorsNearby({ lat: 1, lng: 1, category: 'poultry' })
    expect(result).toEqual({ ok: false, pois: [], error: 'Overpass unreachable or returned no data' })
  })

  it('retries once on failure and returns the successful retry', async () => {
    let call = 0
    fetchMock.mockImplementation(() => {
      call += 1
      if (call <= 2) return Promise.reject(new Error('first attempt fails on both mirrors'))
      return Promise.resolve(jsonResponse({ elements: [] }))
    })
    const result = await fetchCompetitorsNearby({ lat: 1, lng: 1, category: 'food' })
    expect(result.ok).toBe(true)
    expect(call).toBeGreaterThan(2) // first attempt (both mirrors) failed, retry succeeded
  })
})

describe('densityFromCount', () => {
  it('is 0 at 0 competitors and saturates at 1 by ~12', () => {
    expect(densityFromCount(0)).toBe(0)
    expect(densityFromCount(6)).toBeCloseTo(0.5)
    expect(densityFromCount(12)).toBe(1)
    expect(densityFromCount(50)).toBe(1) // never exceeds 1 even with many more
  })

  it('never goes negative', () => {
    expect(densityFromCount(-5)).toBe(0)
  })
})

describe('areaKm2', () => {
  it('computes circle area from radius', () => {
    expect(areaKm2(1)).toBeCloseTo(Math.PI, 5)
    expect(areaKm2(7)).toBeCloseTo(Math.PI * 49, 5)
  })
})

describe('distanceKm', () => {
  it('is 0 for the same point', () => {
    expect(distanceKm(12.5, 76.9, 12.5, 76.9)).toBeCloseTo(0, 6)
  })

  it('matches the known great-circle distance between two real Karnataka towns (Mandya <-> Hassan, ~90km)', () => {
    const d = distanceKm(12.5242, 76.8958, 13.0033, 76.1004)
    expect(d).toBeGreaterThan(80)
    expect(d).toBeLessThan(110)
  })
})
