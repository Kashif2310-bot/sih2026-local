import { describe, expect, it } from 'vitest'
import type { NormalizedGovernmentRecord } from './types'
import { deduplicateRecords } from './dedup'

function record(overrides: Partial<NormalizedGovernmentRecord> = {}): NormalizedGovernmentRecord {
  return {
    sourceRecordId: 'rec-1',
    sourceId: 'data-gov-in',
    sourceName: 'data.gov.in',
    sourceType: 'open_data_api',
    sourceUrl: 'https://api.data.gov.in/resource/abc123',
    retrievedAt: '2026-01-01T00:00:00.000Z',
    summary: '1,204 units sanctioned in Karnataka in FY2023-24.',
    state: 'Karnataka',
    ...overrides,
  }
}

describe('deduplicateRecords', () => {
  it('collapses records sharing the same stable sourceRecordId', () => {
    const { records, duplicatesRemoved } = deduplicateRecords([record(), record({ retrievedAt: '2026-01-02T00:00:00.000Z' })])
    expect(records).toHaveLength(1)
    expect(duplicatesRemoved).toBe(1)
  })

  it('collapses records sharing the same canonical URL when no sourceRecordId is given', () => {
    const a = record({ sourceRecordId: '', sourceUrl: 'https://api.data.gov.in/resource/abc' })
    const b = record({ sourceRecordId: '', sourceUrl: 'https://API.DATA.GOV.IN/resource/abc/' })
    const { records } = deduplicateRecords([a, b])
    expect(records).toHaveLength(1)
  })

  it('prefers the officialApplicationUrl over sourceUrl for canonical identity when both are present', () => {
    const a = record({ sourceRecordId: '', officialApplicationUrl: 'https://www.kviconline.gov.in/pmegp/' })
    const b = record({
      sourceRecordId: '',
      sourceUrl: 'https://api.data.gov.in/resource/different',
      officialApplicationUrl: 'https://www.kviconline.gov.in/pmegp/',
    })
    const { records } = deduplicateRecords([a, b])
    expect(records).toHaveLength(1)
  })

  it('NEVER merges records across different states, even with identical summaries', () => {
    const karnataka = record({ sourceRecordId: '', sourceUrl: '', state: 'Karnataka', summary: 'same stat' })
    const kerala = record({ sourceRecordId: '', sourceUrl: '', state: 'Kerala', summary: 'same stat' })
    const { records, duplicatesRemoved } = deduplicateRecords([karnataka, kerala])
    expect(records).toHaveLength(2)
    expect(duplicatesRemoved).toBe(0)
  })

  it('falls back to a composite identity (source + state + sector + summary) when no id or URL is available', () => {
    const a = record({ sourceRecordId: '', sourceUrl: '', sector: 'dairy', summary: 'x' })
    const b = record({ sourceRecordId: '', sourceUrl: '', sector: 'dairy', summary: 'x', retrievedAt: '2026-01-05T00:00:00.000Z' })
    const c = record({ sourceRecordId: '', sourceUrl: '', sector: 'poultry', summary: 'x' })
    const { records } = deduplicateRecords([a, b, c])
    expect(records).toHaveLength(2) // a/b collapse (same composite), c stays distinct (different sector)
  })

  it('keeps the record with the most recently reported update, not merely the last one seen', () => {
    const older = record({ updatedAt: '2026-01-01T00:00:00.000Z', summary: 'stale' })
    const newer = record({ updatedAt: '2026-03-01T00:00:00.000Z', summary: 'fresh' })
    const { records } = deduplicateRecords([newer, older])
    expect(records).toHaveLength(1)
    expect(records[0].summary).toBe('fresh')
  })

  it('returns an empty result for an empty input without throwing', () => {
    expect(deduplicateRecords([])).toEqual({ records: [], duplicatesRemoved: 0 })
  })
})
