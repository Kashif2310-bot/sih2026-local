import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearScanCache } from './scanCache'
import { fetchWeather, fetchWeekTemps, weatherCachedAt } from './weather'

/** Mocks global.fetch, like geo.test.ts — no real Open-Meteo calls. */

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: () => Promise.resolve(body) } as Response
}

const FORECAST = {
  daily: {
    time: ['2026-09-30', '2026-10-01'],
    weathercode: [1, 2],
    temperature_2m_max: [31, 30],
    temperature_2m_min: [21, 20],
    precipitation_sum: [0, 2],
    precipitation_probability_max: [10, 40],
  },
}

describe('weather — scan cache', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    clearScanCache()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fetches live on a miss (no cache marker), then serves the same point from the cache with its fetch time', async () => {
    fetchMock.mockResolvedValue(jsonResponse(FORECAST))
    const live = await fetchWeather(12.5242, 76.8958)
    expect(live.source).toBe('live')
    expect(weatherCachedAt(live)).toBeUndefined()

    const cached = await fetchWeather(12.5243, 76.8959) // ~15 m away: same cache entry
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(cached.tempMax).toBe(live.tempMax)
    expect(typeof weatherCachedAt(cached)).toBe('number')
  })

  it('never caches a failure — the next call goes live again', async () => {
    fetchMock.mockResolvedValue(jsonResponse(null, false, 503))
    await expect(fetchWeather(12.5242, 76.8958)).rejects.toThrow()
    fetchMock.mockReset()
    fetchMock.mockResolvedValue(jsonResponse(FORECAST))
    await expect(fetchWeather(12.5242, 76.8958)).resolves.toMatchObject({ source: 'live' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('caches the 7-day temperatures too', async () => {
    fetchMock.mockResolvedValue(jsonResponse(FORECAST))
    const first = await fetchWeekTemps(12.5242, 76.8958)
    const second = await fetchWeekTemps(12.5242, 76.8958)
    expect(second).toEqual(first)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
