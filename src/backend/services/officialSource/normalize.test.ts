import { describe, expect, it } from 'vitest'
import { computeFreshnessScore, dedupCandidates, normalizeRawRecord, toSchemeSource } from './normalize'
import type { NormalizedSchemeCandidate, RawOfficialRecord } from './types'

describe('normalizeRawRecord', () => {
  it('returns null when the row has no recognizable scheme name', () => {
    const record: RawOfficialRecord = {
      sourceAdapterId: 'test',
      sourceType: 'official_dataset',
      raw: { foo: 'bar' },
      fetchedAt: new Date().toISOString(),
    }
    expect(normalizeRawRecord(record)).toBeNull()
  })

  it('extracts known fields and marks generic rows live_unverified', () => {
    const record: RawOfficialRecord = {
      sourceAdapterId: 'data_gov_in',
      sourceType: 'official_dataset',
      raw: {
        scheme_name: 'PM Test Scheme',
        ministry: 'Ministry of Testing',
        url: 'https://example.gov.in/pm-test',
        state: 'KA',
        loan_cap: 500000,
        interest_rate: 7.5,
      },
      fetchedAt: new Date().toISOString(),
    }
    const candidate = normalizeRawRecord(record)
    expect(candidate).not.toBeNull()
    expect(candidate?.nameEn).toBe('PM Test Scheme')
    expect(candidate?.ministryNameEn).toBe('Ministry of Testing')
    expect(candidate?.jurisdiction).toBe('state')
    expect(candidate?.verificationState).toBe('live_unverified')
    expect(candidate?.financialSupport?.loanCapRupees).toBe(500000)
  })

  it('never claims a value it cannot find', () => {
    const record: RawOfficialRecord = {
      sourceAdapterId: 'data_gov_in',
      sourceType: 'official_dataset',
      raw: { scheme_name: 'Minimal Scheme' },
      fetchedAt: new Date().toISOString(),
    }
    const candidate = normalizeRawRecord(record)
    expect(candidate?.officialUrl).toBeNull()
    expect(candidate?.financialSupport).toBeNull()
    expect(candidate?.geography.stateCode).toBeNull()
    expect(candidate?.geography.nationwide).toBe(true)
  })
})

describe('computeFreshnessScore', () => {
  it('scores a just-updated record near 1', () => {
    const now = new Date().toISOString()
    expect(computeFreshnessScore(null, now, now)).toBeGreaterThan(0.99)
  })

  it('decays for old records', () => {
    const old = new Date(Date.now() - 400 * 86_400_000).toISOString()
    const score = computeFreshnessScore(old, null, old)
    expect(score).toBeGreaterThan(0)
    expect(score).toBeLessThan(0.2)
  })

  it('scores unknown dates as 0 rather than guessing', () => {
    expect(computeFreshnessScore(null, null, 'not-a-date')).toBe(0)
  })
})

function candidate(overrides: Partial<NormalizedSchemeCandidate>): NormalizedSchemeCandidate {
  return {
    dedupKey: 'code:x',
    code: 'X',
    nameEn: 'X Scheme',
    nameKn: null,
    jurisdiction: 'central',
    ministryNameEn: null,
    departmentNameEn: null,
    officialUrl: null,
    geography: { stateCode: null, nationwide: true },
    beneficiaryInfo: null,
    eligibilitySummaryEn: null,
    financialSupport: null,
    benefits: [],
    documents: [],
    publishedAt: null,
    updatedAt: null,
    retrievedAt: new Date().toISOString(),
    freshnessScore: 0.5,
    verificationState: 'live_unverified',
    sourceAdapterId: 'test',
    sourceType: 'official_dataset',
    confidence: 0.5,
    ...overrides,
  }
}

describe('dedupCandidates', () => {
  it('keeps the higher-verification-state candidate for the same dedup key', () => {
    const weak = candidate({ verificationState: 'live_unverified', confidence: 0.5 })
    const strong = candidate({ verificationState: 'verified_local', confidence: 1 })
    const result = dedupCandidates([weak, strong])
    expect(result).toHaveLength(1)
    expect(result[0]?.verificationState).toBe('verified_local')
  })

  it('breaks ties on freshness when verification state matches', () => {
    const older = candidate({ freshnessScore: 0.2, retrievedAt: '2020-01-01T00:00:00.000Z' })
    const newer = candidate({ freshnessScore: 0.9, retrievedAt: '2026-01-01T00:00:00.000Z' })
    const result = dedupCandidates([older, newer])
    expect(result).toHaveLength(1)
    expect(result[0]?.freshnessScore).toBe(0.9)
  })

  it('keeps distinct dedup keys separate', () => {
    const a = candidate({ dedupKey: 'code:a' })
    const b = candidate({ dedupKey: 'code:b' })
    expect(dedupCandidates([a, b])).toHaveLength(2)
  })
})

describe('toSchemeSource', () => {
  it('returns null for unavailable candidates', () => {
    const c = candidate({ verificationState: 'unavailable' })
    expect(toSchemeSource(c, 'src-1')).toBeNull()
  })

  it('maps live_official and verified_local to verified status', () => {
    const official = toSchemeSource(candidate({ verificationState: 'live_official' }), 'src-1')
    const local = toSchemeSource(candidate({ verificationState: 'verified_local' }), 'src-2')
    expect(official?.status).toBe('verified')
    expect(local?.status).toBe('verified')
  })

  it('maps live_unverified to unverified status', () => {
    const unverified = toSchemeSource(candidate({ verificationState: 'live_unverified' }), 'src-3')
    expect(unverified?.status).toBe('unverified')
  })
})
