import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SCAN_CACHE_TTL_MS } from './config'
import { clearScanCache, readScanCache, scanCacheKey, writeScanCache } from './scanCache'

const STORAGE_PREFIX = 'lokpulse.scanCache.v1:'

describe('scanCache', () => {
  beforeEach(() => {
    clearScanCache()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('misses when nothing was written', () => {
    expect(readScanCache('weather:12.524,76.896')).toBeNull()
  })

  it('hits with the stored value and the time it was fetched', () => {
    writeScanCache('weather:12.524,76.896', { tempMax: 31 }, 1_000)
    expect(readScanCache('weather:12.524,76.896', 2_000)).toEqual({ value: { tempMax: 31 }, fetchedAt: 1_000 })
  })

  it('still hits just inside the TTL, and expires (and forgets the entry) once the TTL has passed', () => {
    writeScanCache('k', 'v', 0)
    expect(readScanCache('k', SCAN_CACHE_TTL_MS - 1)).not.toBeNull()
    expect(readScanCache('k', SCAN_CACHE_TTL_MS)).toBeNull()
    expect(localStorage.getItem(`${STORAGE_PREFIX}k`)).toBeNull()
  })

  it('keeps a 3-hour TTL — a demo lifetime', () => {
    expect(SCAN_CACHE_TTL_MS).toBe(3 * 60 * 60 * 1000)
  })

  it('writes through to localStorage, and reads an entry from there (e.g. after a reload)', () => {
    writeScanCache('k', [1, 2, 3], 5_000)
    expect(JSON.parse(localStorage.getItem(`${STORAGE_PREFIX}k`)!)).toEqual({ value: [1, 2, 3], fetchedAt: 5_000 })

    localStorage.setItem(`${STORAGE_PREFIX}fromStorage`, JSON.stringify({ value: 'saved', fetchedAt: 7_000 }))
    expect(readScanCache('fromStorage', 8_000)).toEqual({ value: 'saved', fetchedAt: 7_000 })
  })

  it('treats a corrupt stored entry as a miss rather than throwing', () => {
    localStorage.setItem(`${STORAGE_PREFIX}bad`, '{not json')
    expect(readScanCache('bad')).toBeNull()
  })

  it('keeps working in memory when localStorage is unavailable', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
      removeItem: () => {
        throw new Error('blocked')
      },
    })
    writeScanCache('k', 'v', 0)
    expect(readScanCache('k', 1)).toEqual({ value: 'v', fetchedAt: 0 })
  })

  it('clearScanCache drops entries from memory and localStorage, leaving other storage keys alone', () => {
    localStorage.setItem('someone-elses-key', 'keep')
    writeScanCache('k', 'v', 0)
    clearScanCache()
    expect(readScanCache('k', 1)).toBeNull()
    expect(localStorage.getItem(`${STORAGE_PREFIX}k`)).toBeNull()
    expect(localStorage.getItem('someone-elses-key')).toBe('keep')
    localStorage.removeItem('someone-elses-key')
  })
})

describe('scanCacheKey', () => {
  it('shares an entry for points about 50 m apart, and separates points about 200 m apart', () => {
    // 0.0004° of latitude is ~45 m; 0.002° is ~220 m.
    expect(scanCacheKey.weather(12.5242, 76.8958)).toBe(scanCacheKey.weather(12.5238, 76.8958))
    expect(scanCacheKey.weather(12.5242, 76.8958)).not.toBe(scanCacheKey.weather(12.5262, 76.8958))
  })

  it('keys competitor lookups by rounded coordinates, business category and radius', () => {
    const base = scanCacheKey.competitors(12.5242, 76.8958, 'dairy', 7)
    expect(base).toBe('competitors:12.524,76.896:dairy:7km')
    expect(scanCacheKey.competitors(12.5242, 76.8958, 'retail', 7)).not.toBe(base)
    expect(scanCacheKey.competitors(12.5242, 76.8958, 'dairy', 10)).not.toBe(base)
  })

  it('keys place searches by the normalised query text', () => {
    expect(scanCacheKey.geocode('  Mandya   Karnataka ')).toBe(scanCacheKey.geocode('mandya karnataka'))
  })
})
