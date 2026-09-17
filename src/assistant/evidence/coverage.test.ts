import { describe, expect, it } from 'vitest'
import { evaluateEligibility } from '../eligibility'
import { SCHEMES } from '../data/schemes'
import { EMPTY_PROFILE, type RankedScheme } from '../types'
import type { ConnectorOutcome } from './types'
import { buildCoverageAccounting, coverageIsIncomplete } from './coverage'

function schemeById(id: string) {
  const s = SCHEMES.find((x) => x.id === id)
  if (!s) throw new Error(`fixture not found: ${id}`)
  return s
}

function rankedFor(id: string): RankedScheme {
  const scheme = schemeById(id)
  return { scheme, eligibility: evaluateEligibility(EMPTY_PROFILE, scheme), relevance: 50, rankScore: 50 }
}

function outcome(overrides: Partial<ConnectorOutcome> = {}): ConnectorOutcome {
  return {
    sourceId: 'data-gov-in',
    sourceName: 'data.gov.in',
    scope: 'central',
    status: 'success',
    recordCount: 1,
    pass: 'broad_discovery',
    ...overrides,
  }
}

describe('buildCoverageAccounting', () => {
  it('NEVER claims all government schemes were checked, regardless of inputs', () => {
    const coverage = buildCoverageAccounting({
      sourceOutcomes: [outcome()],
      recordsRetrieved: 10,
      recordsNormalized: 10,
      recordsRejected: 0,
      recordsDeduplicated: 0,
      schemeSpecificVerifiedCount: 5,
      contextualEvidenceCount: 0,
      ranked: [rankedFor('pmegp')],
    })
    expect(coverage.claimsAllGovernmentSchemesChecked).toBe(false)
  })

  it('counts successful, failed, and not-configured sources separately', () => {
    const coverage = buildCoverageAccounting({
      sourceOutcomes: [
        outcome({ sourceId: 'a', status: 'success' }),
        outcome({ sourceId: 'b', status: 'failure' }),
        outcome({ sourceId: 'c', status: 'not_configured' }),
      ],
      recordsRetrieved: 1,
      recordsNormalized: 1,
      recordsRejected: 0,
      recordsDeduplicated: 0,
      schemeSpecificVerifiedCount: 0,
      contextualEvidenceCount: 1,
      ranked: [],
    })
    expect(coverage.sourcesSuccessful).toBe(1)
    expect(coverage.sourcesFailed).toBe(1)
    expect(coverage.sourcesNotConfigured).toBe(1)
    expect(coverage.sourcesIntended).toBe(3)
    expect(coverage.sourcesQueried).toBe(3)
  })

  it('splits coverage by central vs. state source scope', () => {
    const coverage = buildCoverageAccounting({
      sourceOutcomes: [
        outcome({ sourceId: 'central-1', scope: 'central' }),
        outcome({ sourceId: 'state-1', scope: 'state' }),
        outcome({ sourceId: 'state-2', scope: 'state' }),
      ],
      recordsRetrieved: 0,
      recordsNormalized: 0,
      recordsRejected: 0,
      recordsDeduplicated: 0,
      schemeSpecificVerifiedCount: 0,
      contextualEvidenceCount: 0,
      ranked: [],
    })
    expect(coverage.centralSourcesQueried).toBe(1)
    expect(coverage.stateSourcesQueried).toBe(2)
  })

  it('reports candidate vs eligible scheme counts from the ranked list, never inflating beyond it', () => {
    const ranked = [rankedFor('pmegp'), rankedFor('nsfdc-term-loan')]
    const coverage = buildCoverageAccounting({
      sourceOutcomes: [],
      recordsRetrieved: 0,
      recordsNormalized: 0,
      recordsRejected: 0,
      recordsDeduplicated: 0,
      schemeSpecificVerifiedCount: 0,
      contextualEvidenceCount: 0,
      ranked,
    })
    expect(coverage.candidateSchemeCount).toBe(2)
    expect(coverage.eligibleSchemeCount).toBeLessThanOrEqual(2)
  })

  it('tracks records retrieved/normalized/rejected/deduplicated distinctly for audit', () => {
    const coverage = buildCoverageAccounting({
      sourceOutcomes: [outcome()],
      recordsRetrieved: 12,
      recordsNormalized: 9,
      recordsRejected: 3,
      recordsDeduplicated: 2,
      schemeSpecificVerifiedCount: 1,
      contextualEvidenceCount: 6,
      ranked: [],
    })
    expect(coverage.recordsRetrieved).toBe(12)
    expect(coverage.recordsRejected).toBe(3)
    expect(coverage.recordsDeduplicated).toBe(2)
    expect(coverage.schemeSpecificVerifiedCount).toBe(1)
    expect(coverage.contextualEvidenceCount).toBe(6)
  })
})

describe('coverageIsIncomplete', () => {
  it('is always true given the current architecture (no real government-source registry exists yet)', () => {
    const coverage = buildCoverageAccounting({
      sourceOutcomes: [outcome({ status: 'success' })],
      recordsRetrieved: 1,
      recordsNormalized: 1,
      recordsRejected: 0,
      recordsDeduplicated: 0,
      schemeSpecificVerifiedCount: 1,
      contextualEvidenceCount: 0,
      ranked: [],
    })
    expect(coverageIsIncomplete(coverage)).toBe(true)
  })

  it('flags incompleteness explicitly when a source failed or was not configured', () => {
    const failed = buildCoverageAccounting({
      sourceOutcomes: [outcome({ status: 'failure' })],
      recordsRetrieved: 0,
      recordsNormalized: 0,
      recordsRejected: 0,
      recordsDeduplicated: 0,
      schemeSpecificVerifiedCount: 0,
      contextualEvidenceCount: 0,
      ranked: [],
    })
    expect(coverageIsIncomplete(failed)).toBe(true)

    const notConfigured = buildCoverageAccounting({
      sourceOutcomes: [outcome({ status: 'not_configured' })],
      recordsRetrieved: 0,
      recordsNormalized: 0,
      recordsRejected: 0,
      recordsDeduplicated: 0,
      schemeSpecificVerifiedCount: 0,
      contextualEvidenceCount: 0,
      ranked: [],
    })
    expect(coverageIsIncomplete(notConfigured)).toBe(true)
  })

  it('flags incompleteness when no sources were queried at all', () => {
    const coverage = buildCoverageAccounting({
      sourceOutcomes: [],
      recordsRetrieved: 0,
      recordsNormalized: 0,
      recordsRejected: 0,
      recordsDeduplicated: 0,
      schemeSpecificVerifiedCount: 0,
      contextualEvidenceCount: 0,
      ranked: [],
    })
    expect(coverageIsIncomplete(coverage)).toBe(true)
  })
})
