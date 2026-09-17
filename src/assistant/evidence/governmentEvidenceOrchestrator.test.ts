import { describe, expect, it } from 'vitest'
import { evaluateEligibility } from '../eligibility'
import { SCHEMES } from '../data/schemes'
import { EMPTY_PROFILE, type RankedScheme } from '../types'
import type { ConnectorQuery, GovernmentSourceConnector, GovernmentSourceDescriptor, NormalizedGovernmentRecord } from './types'
import { runGovernmentEvidenceRetrieval, isWellFormedRecord, DEFAULT_DISCOVERY_PASSES, FULL_DISCOVERY_PASSES } from './governmentEvidenceOrchestrator'

function schemeById(id: string) {
  const s = SCHEMES.find((x) => x.id === id)
  if (!s) throw new Error(`fixture not found: ${id}`)
  return s
}

function rankedFor(id: string): RankedScheme {
  const scheme = schemeById(id)
  return { scheme, eligibility: evaluateEligibility(EMPTY_PROFILE, scheme), relevance: 50, rankScore: 50 }
}

function lookupScheme(id: string) {
  return SCHEMES.find((s) => s.id === id)
}

function record(overrides: Partial<NormalizedGovernmentRecord> = {}): NormalizedGovernmentRecord {
  return {
    sourceRecordId: 'rec-1',
    sourceId: 'fake-source',
    sourceName: 'Fake Source',
    sourceType: 'open_data_api',
    sourceUrl: 'https://api.data.gov.in/resource/abc',
    retrievedAt: new Date().toISOString(),
    summary: 'a fact',
    ...overrides,
  }
}

function stubConnector(opts: {
  id?: string
  scope?: GovernmentSourceDescriptor['scope']
  available?: boolean
  records?: NormalizedGovernmentRecord[]
  error?: Error
}): GovernmentSourceConnector {
  const descriptor: GovernmentSourceDescriptor = {
    id: opts.id ?? 'fake-source',
    name: 'Fake Source',
    sourceType: 'open_data_api',
    officialDomain: 'api.data.gov.in',
    scope: opts.scope ?? 'central',
  }
  return {
    descriptor,
    isAvailable: () => Promise.resolve(opts.available ?? true),
    fetchNormalized: (_query: ConnectorQuery) => {
      if (opts.error) return Promise.reject(opts.error)
      return Promise.resolve(opts.records ?? [])
    },
  }
}

describe('runGovernmentEvidenceRetrieval — orchestration (Prompt 8 Steps 9/10)', () => {
  it('aggregates evidence from multiple connectors and binds deterministically', async () => {
    const result = await runGovernmentEvidenceRetrieval({
      connectors: [
        stubConnector({ id: 'a', records: [record({ sourceRecordId: 'a1', explicitSchemeId: 'pmegp' })] }),
        stubConnector({ id: 'b', scope: 'state', records: [record({ sourceRecordId: 'b1' })] }),
      ],
      schemeIds: ['pmegp'],
      lookupScheme,
      ranked: [rankedFor('pmegp')],
    })
    expect(result.boundEvidence).toHaveLength(1)
    expect(result.boundEvidence[0].schemeId).toBe('pmegp')
    expect(result.contextualEvidence).toHaveLength(1)
    expect(result.coverage.sourcesSuccessful).toBe(2)
    expect(result.coverage.centralSourcesQueried).toBe(1)
    expect(result.coverage.stateSourcesQueried).toBe(1)
  })

  it('CONNECTOR FAILURE: one connector throwing never blocks results from the others, and is recorded honestly', async () => {
    const result = await runGovernmentEvidenceRetrieval({
      connectors: [
        stubConnector({ id: 'good', records: [record({ sourceRecordId: 'g1', explicitSchemeId: 'pmegp' })] }),
        stubConnector({ id: 'bad', error: new Error('upstream 500') }),
      ],
      schemeIds: ['pmegp'],
      lookupScheme,
      ranked: [],
    })
    expect(result.boundEvidence).toHaveLength(1)
    expect(result.coverage.sourcesSuccessful).toBe(1)
    expect(result.coverage.sourcesFailed).toBe(1)
    const badOutcome = result.coverage.sourceOutcomes.find((o) => o.sourceId === 'bad')
    expect(badOutcome?.status).toBe('failure')
    expect(badOutcome?.error).toMatch(/upstream 500/)
  })

  it('NOT CONFIGURED: a connector reporting itself unavailable is recorded as not_configured, never queried', async () => {
    let fetchCalled = false
    const connector = stubConnector({ id: 'off', available: false })
    connector.fetchNormalized = () => {
      fetchCalled = true
      return Promise.resolve([])
    }
    const result = await runGovernmentEvidenceRetrieval({ connectors: [connector], schemeIds: ['pmegp'], lookupScheme, ranked: [] })
    expect(fetchCalled).toBe(false)
    expect(result.coverage.sourcesNotConfigured).toBe(1)
    expect(result.coverage.sourcesSuccessful).toBe(0)
  })

  it('MALFORMED RESPONSE: rejects a record whose source URL is not on the trusted allowlist, without crashing the whole batch', async () => {
    const result = await runGovernmentEvidenceRetrieval({
      connectors: [
        stubConnector({
          records: [
            record({ sourceRecordId: 'ok', explicitSchemeId: 'pmegp' }),
            record({ sourceRecordId: 'bad-url', sourceUrl: 'https://evil.example.com/x' }),
          ],
        }),
      ],
      schemeIds: ['pmegp'],
      lookupScheme,
      ranked: [],
    })
    expect(result.boundEvidence).toHaveLength(1)
    expect(result.coverage.recordsRejected).toBe(1)
  })

  it('MALFORMED RESPONSE: rejects a record with an unparseable retrievedAt', () => {
    expect(isWellFormedRecord(record({ retrievedAt: 'not-a-date' }))).toBe(false)
    expect(isWellFormedRecord(record({ summary: '' }))).toBe(false)
    expect(isWellFormedRecord(record({ sourceUrl: 'http://api.data.gov.in/resource/abc' }))).toBe(false)
    expect(isWellFormedRecord(record())).toBe(true)
  })

  it('deduplicates identical records retrieved from the same connector', async () => {
    const result = await runGovernmentEvidenceRetrieval({
      connectors: [
        stubConnector({
          records: [record({ sourceRecordId: 'dup', explicitSchemeId: 'pmegp' }), record({ sourceRecordId: 'dup', explicitSchemeId: 'pmegp' })],
        }),
      ],
      schemeIds: ['pmegp'],
      lookupScheme,
      ranked: [],
    })
    expect(result.boundEvidence).toHaveLength(1)
    expect(result.coverage.recordsDeduplicated).toBe(1)
  })

  it('COVERAGE: never claims all government schemes were checked', async () => {
    const result = await runGovernmentEvidenceRetrieval({
      connectors: [stubConnector({ records: [] })],
      schemeIds: ['pmegp'],
      lookupScheme,
      ranked: [rankedFor('pmegp')],
    })
    expect(result.coverage.claimsAllGovernmentSchemesChecked).toBe(false)
  })

  it('DISCOVERY VS ELIGIBILITY: contextual evidence for a scheme never upgrades its deterministic eligibility status', async () => {
    // The scheme has no applicant facts at all (EMPTY_PROFILE), so eligibility.ts
    // legitimately says 'insufficient_data' — contextual government evidence
    // arriving alongside it must not change that.
    const ranked = rankedFor('pmegp')
    expect(ranked.eligibility.status).toBe('insufficient_data')
    const result = await runGovernmentEvidenceRetrieval({
      connectors: [stubConnector({ records: [record()] })], // no binding proof -> contextual
      schemeIds: ['pmegp'],
      lookupScheme,
      ranked: [ranked],
    })
    expect(result.contextualEvidence.length).toBeGreaterThan(0)
    // Nothing in the evidence layer touches `ranked` — eligibility remains authoritative.
    expect(ranked.eligibility.status).toBe('insufficient_data')
  })

  it('runs a single broad_discovery pass by default (cost discipline — never fans out to every pass on every turn)', async () => {
    const seenPasses: string[] = []
    const connector = stubConnector({ records: [] })
    connector.fetchNormalized = (query) => {
      seenPasses.push(query.pass)
      return Promise.resolve([])
    }
    await runGovernmentEvidenceRetrieval({ connectors: [connector], schemeIds: ['pmegp'], lookupScheme, ranked: [] })
    expect(seenPasses).toEqual(['broad_discovery'])
    expect(DEFAULT_DISCOVERY_PASSES).toEqual(['broad_discovery'])
  })

  it('supports the full 6-pass discovery sequence when a caller explicitly opts in', async () => {
    const seenPasses: string[] = []
    const connector = stubConnector({ records: [] })
    connector.fetchNormalized = (query) => {
      seenPasses.push(query.pass)
      return Promise.resolve([])
    }
    await runGovernmentEvidenceRetrieval({
      connectors: [connector],
      schemeIds: ['pmegp'],
      lookupScheme,
      ranked: [],
      passes: FULL_DISCOVERY_PASSES,
    })
    expect(seenPasses.sort()).toEqual([...FULL_DISCOVERY_PASSES].sort())
  })

  it('an empty connector list produces empty, honest results — never fabricated evidence', async () => {
    const result = await runGovernmentEvidenceRetrieval({ connectors: [], schemeIds: ['pmegp'], lookupScheme, ranked: [] })
    expect(result.boundEvidence).toEqual([])
    expect(result.contextualEvidence).toEqual([])
    expect(result.coverage.sourcesQueried).toBe(0)
  })
})
