import { describe, expect, it } from 'vitest'
import { SCHEMES } from '../data/schemes'
import type { NormalizedGovernmentRecord } from './types'
import { bindNormalizedRecords, evaluateSchemeBinding, reclassifyLiveEvidence } from './schemeBinding'
import type { LiveEvidenceItem } from '../types'

function schemeById(id: string) {
  const s = SCHEMES.find((x) => x.id === id)
  if (!s) throw new Error(`fixture not found: ${id}`)
  return s
}

function lookupScheme(id: string) {
  return SCHEMES.find((s) => s.id === id)
}

function baseRecord(overrides: Partial<NormalizedGovernmentRecord> = {}): NormalizedGovernmentRecord {
  return {
    sourceRecordId: 'rec-1',
    sourceId: 'data-gov-in',
    sourceName: 'data.gov.in',
    sourceType: 'open_data_api',
    sourceUrl: 'https://api.data.gov.in/resource/abc123',
    retrievedAt: new Date().toISOString(),
    summary: '1,204 units sanctioned in Karnataka in FY2023-24.',
    ...overrides,
  }
}

describe('evaluateSchemeBinding — deterministic scheme-specific binding (Prompt 8 Step 4)', () => {
  it('binds when the record explicitly declares the scheme id', () => {
    const scheme = schemeById('pmegp')
    const decision = evaluateSchemeBinding({ explicitSchemeId: 'pmegp' }, scheme)
    expect(decision.bound).toBe(true)
    expect(decision.method).toBe('explicit_scheme_id')
  })

  it('binds when the record cites the same canonical official application URL', () => {
    const scheme = schemeById('pmegp')
    const decision = evaluateSchemeBinding({ officialApplicationUrl: scheme.officialApplicationUrl }, scheme)
    expect(decision.bound).toBe(true)
    expect(decision.method).toBe('canonical_url_match')
  })

  it('treats a trailing-slash/host-case difference in the URL as the same canonical URL', () => {
    const scheme = schemeById('pmegp')
    const decision = evaluateSchemeBinding(
      { officialApplicationUrl: scheme.officialApplicationUrl.toUpperCase().replace(/\/$/, '') },
      scheme,
    )
    expect(decision.bound).toBe(true)
  })

  it('REFUSES to bind on request/membership alone — no explicit id, no matching URL', () => {
    const scheme = schemeById('pmegp')
    const decision = evaluateSchemeBinding({}, scheme)
    expect(decision.bound).toBe(false)
    expect(decision.method).toBe('unbound')
  })

  it('REFUSES to bind when the explicit scheme id belongs to a DIFFERENT scheme', () => {
    const scheme = schemeById('pmegp')
    const decision = evaluateSchemeBinding({ explicitSchemeId: 'pm-mudra-yojana' }, scheme)
    expect(decision.bound).toBe(false)
  })

  it('REFUSES to bind when the cited URL belongs to a different scheme entirely', () => {
    const scheme = schemeById('pmegp')
    const decision = evaluateSchemeBinding({ officialApplicationUrl: 'https://www.nsfdc.nic.in/' }, scheme)
    expect(decision.bound).toBe(false)
  })

  it('REFUSES to bind when there is no local scheme record for the id at all', () => {
    const decision = evaluateSchemeBinding({ explicitSchemeId: 'pmegp' }, undefined)
    expect(decision.bound).toBe(false)
    expect(decision.reason).toMatch(/no local scheme record/)
  })
})

describe('bindNormalizedRecords — the actual union/bind step used by the evidence orchestrator', () => {
  it('binds a record with explicit scheme id proof to exactly that requested scheme', () => {
    const record = baseRecord({ explicitSchemeId: 'pmegp' })
    const { bound, contextual } = bindNormalizedRecords({
      records: [record],
      requestedSchemeIds: ['pmegp', 'pm-mudra-yojana'],
      lookupScheme,
    })
    expect(bound).toHaveLength(1)
    expect(bound[0].schemeId).toBe('pmegp')
    expect(bound[0].verificationStatus).toBe('live_official')
    expect(bound[0].bindingMethod).toBe('explicit_scheme_id')
    expect(contextual).toHaveLength(0)
  })

  it('CORE BUG FIX: a generic record with no binding proof is classified as contextual, not attached to every requested scheme', () => {
    const record = baseRecord() // no explicitSchemeId, no officialApplicationUrl
    const { bound, contextual } = bindNormalizedRecords({
      records: [record],
      requestedSchemeIds: ['pmegp', 'pm-mudra-yojana', 'nsfdc-term-loan'],
      lookupScheme,
    })
    expect(bound).toHaveLength(0)
    expect(contextual).toHaveLength(1)
    expect(contextual[0].verificationStatus).toBe('live_contextual')
    expect(contextual[0].requestedSchemeIds).toEqual(['pmegp', 'pm-mudra-yojana', 'nsfdc-term-loan'])
  })

  it('never binds a record to more than the one scheme it explicitly identifies, even when several were requested', () => {
    const record = baseRecord({ explicitSchemeId: 'pmegp' })
    const { bound } = bindNormalizedRecords({
      records: [record],
      requestedSchemeIds: ['pmegp', 'pm-mudra-yojana', 'nsfdc-term-loan'],
      lookupScheme,
    })
    expect(bound).toHaveLength(1)
    expect(bound.map((b) => b.schemeId)).toEqual(['pmegp'])
  })

  it('preserves provenance/freshness fields through binding', () => {
    const record = baseRecord({
      explicitSchemeId: 'pmegp',
      publishedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-02-01T00:00:00.000Z',
      version: 'v3',
      etag: 'W/"abc"',
      contentHash: 'sha256:deadbeef',
      sourceRecordId: 'stable-id-42',
    })
    const { bound } = bindNormalizedRecords({ records: [record], requestedSchemeIds: ['pmegp'], lookupScheme })
    expect(bound[0]).toMatchObject({
      sourceRecordId: 'stable-id-42',
      publishedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-02-01T00:00:00.000Z',
      version: 'v3',
      etag: 'W/"abc"',
      contentHash: 'sha256:deadbeef',
    })
  })

  it('a record for a requested scheme id with no matching local scheme is contextual, not silently dropped or bound', () => {
    const record = baseRecord({ explicitSchemeId: 'totally-unknown-scheme' })
    const { bound, contextual } = bindNormalizedRecords({
      records: [record],
      requestedSchemeIds: ['totally-unknown-scheme'],
      lookupScheme,
    })
    expect(bound).toHaveLength(0)
    expect(contextual).toHaveLength(1)
  })
})

describe('reclassifyLiveEvidence — safety net over already-shaped LiveEvidenceItem[]', () => {
  function item(overrides: Partial<LiveEvidenceItem> = {}): LiveEvidenceItem {
    return {
      schemeId: 'pmegp',
      sourceName: 'data.gov.in',
      sourceUrl: 'https://api.data.gov.in/resource/abc123',
      sourceType: 'official_open_data',
      verificationStatus: 'live_official',
      retrievedAt: new Date().toISOString(),
      summary: 'generic statistic',
      ...overrides,
    }
  }

  it('keeps evidence bound when it carries explicit binding proof', () => {
    const { bound, contextual } = reclassifyLiveEvidence([item({ explicitSchemeId: 'pmegp' })], lookupScheme)
    expect(bound).toHaveLength(1)
    expect(contextual).toHaveLength(0)
  })

  it('demotes evidence with no binding proof to contextual even though it already claims live_official', () => {
    const { bound, contextual } = reclassifyLiveEvidence([item()], lookupScheme)
    expect(bound).toHaveLength(0)
    expect(contextual).toHaveLength(1)
    expect(contextual[0].requestedSchemeIds).toEqual(['pmegp'])
  })
})
