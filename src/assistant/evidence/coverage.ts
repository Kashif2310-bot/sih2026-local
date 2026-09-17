/**
 * Coverage / completeness accounting (Prompt 8, Step 9).
 *
 * The one rule this module exists to enforce: NEVER claim "all government
 * schemes checked". `claimsAllGovernmentSchemesChecked` is hard-coded false
 * and every count here is a count of what was actually attempted/found —
 * never inflated to imply broader coverage than the sources actually
 * queried can prove.
 */

import type { RankedScheme } from '../types'
import type { ConnectorOutcome, SourceCoverageAccounting } from './types'

export interface BuildCoverageInput {
  sourceOutcomes: ConnectorOutcome[]
  recordsRetrieved: number
  recordsNormalized: number
  recordsRejected: number
  recordsDeduplicated: number
  schemeSpecificVerifiedCount: number
  contextualEvidenceCount: number
  ranked: RankedScheme[]
}

export function buildCoverageAccounting(input: BuildCoverageInput): SourceCoverageAccounting {
  const { sourceOutcomes, ranked } = input

  const sourcesSuccessful = sourceOutcomes.filter((o) => o.status === 'success').length
  const sourcesFailed = sourceOutcomes.filter((o) => o.status === 'failure').length
  const sourcesNotConfigured = sourceOutcomes.filter((o) => o.status === 'not_configured').length
  const centralSourcesQueried = sourceOutcomes.filter((o) => o.scope === 'central').length
  const stateSourcesQueried = sourceOutcomes.filter((o) => o.scope === 'state').length

  const eligibleSchemeCount = ranked.filter(
    (r) => r.eligibility.status === 'likely_eligible' || r.eligibility.status === 'possibly_eligible',
  ).length

  return {
    sourcesIntended: sourceOutcomes.length,
    sourcesQueried: sourceOutcomes.length,
    sourcesSuccessful,
    sourcesFailed,
    sourcesNotConfigured,
    recordsRetrieved: input.recordsRetrieved,
    recordsNormalized: input.recordsNormalized,
    recordsRejected: input.recordsRejected,
    recordsDeduplicated: input.recordsDeduplicated,
    schemeSpecificVerifiedCount: input.schemeSpecificVerifiedCount,
    contextualEvidenceCount: input.contextualEvidenceCount,
    candidateSchemeCount: ranked.length,
    eligibleSchemeCount,
    centralSourcesQueried,
    stateSourcesQueried,
    claimsAllGovernmentSchemesChecked: false,
    sourceOutcomes,
  }
}

/** An honest, structured "coverage was incomplete" signal — never silently absorbed. */
export function coverageIsIncomplete(coverage: SourceCoverageAccounting): boolean {
  return (
    coverage.sourcesFailed > 0 ||
    coverage.sourcesNotConfigured > 0 ||
    coverage.sourcesQueried === 0 ||
    !coverage.claimsAllGovernmentSchemesChecked
  )
}
