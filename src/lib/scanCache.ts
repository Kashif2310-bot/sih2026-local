import type { BusinessCategory } from '../data/villages'
import { SCAN_CACHE_TTL_MS } from './config'

/**
 * Cache for the hyperlocal scan's live lookups — geocoding, competitor
 * counts and weather — so a flaky venue connection or a public API's rate
 * limit can't break a scan that already worked once. It also covers
 * Nominatim's usage policy: "Results must be cached on your side."
 *
 * Two layers: an in-memory Map (this tab), backed by localStorage (survives
 * a reload). Only successful results are ever written; a failure is never
 * cached, so the next scan tries live again. Every entry keeps the time it
 * was actually fetched, so callers can say the data is cached and from when,
 * never pass it off as fresh.
 */

export interface ScanCacheEntry<T> {
  value: T
  /** When the value was actually fetched from the live source (epoch ms). */
  fetchedAt: number
}

const STORAGE_PREFIX = 'lokpulse.scanCache.v1:'
const memory = new Map<string, ScanCacheEntry<unknown>>()

/** localStorage when the browser allows it; null in private modes or when storage throws. */
function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function isFresh(entry: ScanCacheEntry<unknown>, now: number): boolean {
  return now - entry.fetchedAt < SCAN_CACHE_TTL_MS
}

export function readScanCache<T>(key: string, now = Date.now()): ScanCacheEntry<T> | null {
  const inMemory = memory.get(key)
  if (inMemory) {
    if (isFresh(inMemory, now)) return inMemory as ScanCacheEntry<T>
    forget(key)
    return null
  }
  const store = storage()
  try {
    const raw = store?.getItem(STORAGE_PREFIX + key)
    if (!raw) return null
    const stored = JSON.parse(raw) as ScanCacheEntry<T>
    if (typeof stored?.fetchedAt !== 'number' || !isFresh(stored, now)) {
      forget(key)
      return null
    }
    memory.set(key, stored)
    return stored
  } catch {
    return null
  }
}

export function writeScanCache<T>(key: string, value: T, now = Date.now()): void {
  const entry: ScanCacheEntry<T> = { value, fetchedAt: now }
  memory.set(key, entry)
  try {
    storage()?.setItem(STORAGE_PREFIX + key, JSON.stringify(entry))
  } catch {
    // Storage full or blocked: the in-memory layer still serves this tab.
  }
}

function forget(key: string): void {
  memory.delete(key)
  try {
    storage()?.removeItem(STORAGE_PREFIX + key)
  } catch {
    // Nothing to clean up if storage is unavailable.
  }
}

/** Drops every cached scan lookup, in memory and in localStorage. */
export function clearScanCache(): void {
  memory.clear()
  const store = storage()
  if (!store) return
  try {
    const keys: string[] = []
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i)
      if (k?.startsWith(STORAGE_PREFIX)) keys.push(k)
    }
    for (const k of keys) store.removeItem(k)
  } catch {
    // Storage unavailable: memory is already clear.
  }
}

/** Three decimal places of latitude/longitude — about 110 m, so re-scans of the same spot share an entry. */
function roundCoord(n: number): string {
  return n.toFixed(3)
}

export const scanCacheKey = {
  geocode: (query: string) => `geocode:${query.trim().toLowerCase().replace(/\s+/g, ' ')}`,
  reverseGeocode: (lat: number, lng: number) => `reverse:${roundCoord(lat)},${roundCoord(lng)}`,
  competitors: (lat: number, lng: number, category: BusinessCategory, radiusKm: number) =>
    `competitors:${roundCoord(lat)},${roundCoord(lng)}:${category}:${radiusKm}km`,
  weather: (lat: number, lng: number) => `weather:${roundCoord(lat)},${roundCoord(lng)}`,
  weekTemps: (lat: number, lng: number) => `weekTemps:${roundCoord(lat)},${roundCoord(lng)}`,
}
