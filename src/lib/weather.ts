import type { WeatherSignal } from './lokScore'
import { LIVE_CALL_TIMEOUT_MS } from './config'
import { retryOnce } from './retry'
import { readScanCache, scanCacheKey, writeScanCache } from './scanCache'

/** A weather signal, plus when it was actually fetched if it came from the scan cache instead of a live call. */
export type CachedWeatherSignal = WeatherSignal & { cachedAt?: number }

/** When this weather was actually fetched, if it was served from the scan cache; undefined when it is live. */
export function weatherCachedAt(weather: WeatherSignal): number | undefined {
  return (weather as CachedWeatherSignal).cachedAt
}

type WeekTemp = { date: string; max: number; min: number; rain: number }

/** Fetch with an abort timeout so a stalled connection fails fast instead of
 * hanging the UI indefinitely — critical for a live screen-share demo. */
async function fetchWithTimeout(url: string): Promise<Response> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), LIVE_CALL_TIMEOUT_MS)
  try {
    return await fetch(url, { signal: ctrl.signal })
  } finally {
    clearTimeout(t)
  }
}

const WMO: Record<number, { en: string; kn: string }> = {
  0: { en: 'Clear sky', kn: 'ಸ್ವಚ್ಛ ಆಕಾಶ' },
  1: { en: 'Mainly clear', kn: 'ಬಹುತೇಕ ಸ್ವಚ್ಛ' },
  2: { en: 'Partly cloudy', kn: 'ಭಾಗಶಃ ಮೋಡ' },
  3: { en: 'Overcast', kn: 'ಮೋಡ ಕವಿದ' },
  45: { en: 'Fog', kn: 'ಮಂಜು' },
  61: { en: 'Slight rain', kn: 'ಸ್ವಲ್ಪ ಮಳೆ' },
  63: { en: 'Moderate rain', kn: 'ಮಧ್ಯಮ ಮಳೆ' },
  65: { en: 'Heavy rain', kn: 'ಭಾರೀ ಮಳೆ' },
  80: { en: 'Rain showers', kn: 'ಮಳೆ ಸುರಿತ' },
  95: { en: 'Thunderstorm', kn: 'ಗುಡುಗು ಮಳೆ' },
}

export async function fetchWeather(lat: number, lng: number): Promise<CachedWeatherSignal> {
  const key = scanCacheKey.weather(lat, lng)
  const cached = readScanCache<WeatherSignal>(key)
  if (cached) return { ...cached.value, cachedAt: cached.fetchedAt }
  // retryOnce throws when both attempts fail, so only a successful live reading is cached.
  const weather = await retryOnce(() => fetchWeatherOnce(lat, lng))
  writeScanCache(key, weather)
  return weather
}

async function fetchWeatherOnce(lat: number, lng: number): Promise<WeatherSignal> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
    `&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max` +
    `&timezone=Asia%2FKolkata&forecast_days=7`

  const res = await fetchWithTimeout(url)
  if (!res.ok) throw new Error('Weather fetch failed')
  const data = await res.json()
  const code = Number(data.daily.weathercode?.[0] ?? 2)
  const label = WMO[code] ?? WMO[2]
  return {
    tempMax: Number(data.daily.temperature_2m_max[0]),
    tempMin: Number(data.daily.temperature_2m_min[0]),
    precipProb: Number(data.daily.precipitation_probability_max?.[0] ?? 20),
    precipMm: Number(data.daily.precipitation_sum?.[0] ?? 0),
    code,
    summary: label.en,
    summaryKn: label.kn,
    source: 'live',
  }
}

export async function fetchWeekTemps(lat: number, lng: number): Promise<WeekTemp[]> {
  const key = scanCacheKey.weekTemps(lat, lng)
  const cached = readScanCache<WeekTemp[]>(key)
  if (cached) return cached.value
  const week = await retryOnce(() => fetchWeekTempsOnce(lat, lng))
  writeScanCache(key, week)
  return week
}

async function fetchWeekTempsOnce(lat: number, lng: number): Promise<WeekTemp[]> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
    `&timezone=Asia%2FKolkata&forecast_days=7`
  const res = await fetchWithTimeout(url)
  if (!res.ok) throw new Error('Weather week failed')
  const data = await res.json()
  return (data.daily.time as string[]).map((date: string, i: number) => ({
    date,
    max: Number(data.daily.temperature_2m_max[i]),
    min: Number(data.daily.temperature_2m_min[i]),
    rain: Number(data.daily.precipitation_probability_max[i]),
  }))
}

export function unavailableWeather(): WeatherSignal {
  return {
    tempMax: 0,
    tempMin: 0,
    precipProb: 0,
    precipMm: 0,
    code: -1,
    summary: 'Live weather unavailable',
    summaryKn: 'ಲೈವ್ ಹವಾಮಾನ ಲಭ್ಯವಿಲ್ಲ',
    source: 'unavailable',
  }
}
