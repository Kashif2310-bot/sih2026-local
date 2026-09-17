/**
 * Government Evidence Retrieval Orchestrator (Prompt 8, Steps 2/9/10).
 *
 * Runs one or more GovernmentSourceConnectors for a set of discovery
 * passes, validates + deduplicates what comes back, deterministically
 * binds it to specific local schemes (schemeBinding.ts), and produces an
 * honest coverage/completeness accounting (coverage.ts).
 *
 * Cost discipline: by default this runs exactly ONE pass
 * ('broad_discovery') per connector, matching the existing
 * evidenceInvalidation.ts contract of "only refresh when decision-critical
 * profile information changes, never on every sentence" — the full 6-pass
 * discovery sequence described in Prompt 8 Step 10 is supported (pass an
 * explicit `passes` list) for a caller that deliberately wants deeper,
 * more expensive discovery, but is never the default for the per-turn
 * assistant pipeline.
 *
 * This module never determines eligibility or ranking — see
 * eligibility.ts/ranking.ts, both unmodified and untouched by anything
 * here.
 */

import { isTrustedGovUrl } from '../trustedSources'
import { buildCoverageAccounting } from './coverage'
import { bindNormalizedRecords } from './schemeBinding'
import { deduplicateRecords } from './dedup'
import type {
  ConnectorOutcome,
  DiscoveryPass,
  GovernmentEvidenceResult,
  GovernmentSourceConnector,
  NormalizedGovernmentRecord,
  SchemeLookup,
} from './types'
import type { RankedScheme } from '../types'

export const DEFAULT_DISCOVERY_PASSES: DiscoveryPass[] = ['broad_discovery']

/** The full multi-pass sequence from Prompt 8 Step 10, for a caller that explicitly wants deeper (more expensive) discovery than the per-turn default. */
export const FULL_DISCOVERY_PASSES: DiscoveryPass[] = [
  'broad_discovery',
  'beneficiary_eligibility',
  'business_sector',
  'financing_subsidy',
  'state_specific',
  'central',
]

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0
}

/**
 * Untrusted-content validation for whatever a connector normalizes — a
 * connector is code we wrote, but its data ultimately originates from an
 * external network response, so nothing here is trusted implicitly.
 */
export function isWellFormedRecord(record: NormalizedGovernmentRecord): boolean {
  if (!isNonEmptyString(record.sourceRecordId)) return false
  if (!isNonEmptyString(record.sourceId)) return false
  if (!isNonEmptyString(record.sourceName)) return false
  if (!isNonEmptyString(record.sourceUrl) || !isTrustedGovUrl(record.sourceUrl)) return false
  if (!isNonEmptyString(record.summary)) return false
  if (!isNonEmptyString(record.retrievedAt) || Number.isNaN(Date.parse(record.retrievedAt))) return false
  if (record.publishedAt !== undefined && Number.isNaN(Date.parse(record.publishedAt))) return false
  if (record.updatedAt !== undefined && Number.isNaN(Date.parse(record.updatedAt))) return false
  return true
}

export interface RunGovernmentEvidenceRetrievalInput {
  connectors: GovernmentSourceConnector[]
  schemeIds: string[]
  state?: string
  sector?: string
  lookupScheme: SchemeLookup
  ranked: RankedScheme[]
  passes?: DiscoveryPass[]
}

export async function runGovernmentEvidenceRetrieval(
  input: RunGovernmentEvidenceRetrievalInput,
): Promise<GovernmentEvidenceResult> {
  const passes = input.passes ?? DEFAULT_DISCOVERY_PASSES
  const outcomes: ConnectorOutcome[] = []
  const rawRecords: NormalizedGovernmentRecord[] = []
  let recordsRetrieved = 0
  let recordsRejected = 0

  const tasks: Array<Promise<void>> = []
  for (const connector of input.connectors) {
    for (const pass of passes) {
      tasks.push(
        (async () => {
          let available: boolean
          try {
            available = await connector.isAvailable()
          } catch {
            available = false
          }
          if (!available) {
            outcomes.push({
              sourceId: connector.descriptor.id,
              sourceName: connector.descriptor.name,
              scope: connector.descriptor.scope,
              status: 'not_configured',
              recordCount: 0,
              pass,
            })
            return
          }

          try {
            const records = await connector.fetchNormalized({
              schemeIds: input.schemeIds,
              state: input.state,
              sector: input.sector,
              pass,
            })
            recordsRetrieved += records.length
            const valid = records.filter(isWellFormedRecord)
            recordsRejected += records.length - valid.length
            rawRecords.push(...valid)
            outcomes.push({
              sourceId: connector.descriptor.id,
              sourceName: connector.descriptor.name,
              scope: connector.descriptor.scope,
              status: 'success',
              recordCount: valid.length,
              pass,
            })
          } catch (e) {
            outcomes.push({
              sourceId: connector.descriptor.id,
              sourceName: connector.descriptor.name,
              scope: connector.descriptor.scope,
              status: 'failure',
              recordCount: 0,
              error: e instanceof Error ? e.message : 'unknown connector failure',
              pass,
            })
          }
        })(),
      )
    }
  }

  await Promise.all(tasks)

  // Deterministic ordering regardless of concurrent completion order —
  // matters for coverage reporting and test stability.
  outcomes.sort((a, b) => (a.sourceId + a.pass).localeCompare(b.sourceId + b.pass))

  const { records: deduped, duplicatesRemoved } = deduplicateRecords(rawRecords)
  const { bound, contextual } = bindNormalizedRecords({
    records: deduped,
    requestedSchemeIds: input.schemeIds,
    lookupScheme: input.lookupScheme,
  })

  const coverage = buildCoverageAccounting({
    sourceOutcomes: outcomes,
    recordsRetrieved,
    recordsNormalized: rawRecords.length,
    recordsRejected,
    recordsDeduplicated: duplicatesRemoved,
    schemeSpecificVerifiedCount: bound.length,
    contextualEvidenceCount: contextual.length,
    ranked: input.ranked,
  })

  return { boundEvidence: bound, contextualEvidence: contextual, coverage }
}
