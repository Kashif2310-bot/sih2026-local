/**
 * Live Verified Government Evidence Layer — core types (Prompt 8).
 *
 * Target architecture:
 *   AUTHORIZED GOVERNMENT SOURCES
 *        -> SOURCE CONNECTORS
 *        -> NORMALIZATION
 *        -> SCHEME-SPECIFIC BINDING
 *        -> DEDUPLICATION
 *        -> PROVENANCE + VERIFICATION
 *        -> FRESHNESS + VERSIONING
 *        -> COVERAGE / COMPLETENESS
 *        -> EXISTING RETRIEVAL -> EXISTING ELIGIBILITY -> EXISTING RANKING -> PERSONALIZED REPORT
 *
 * The LLM is never the source of truth. A GovernmentSourceConnector
 * retrieves evidence; it never determines eligibility. Deterministic code
 * (eligibility.ts, ranking.ts, unmodified) remains the sole source of
 * eligibility/ranking decisions. This module is provider-independent: it
 * knows nothing about Gemini, React, or Supabase tables.
 */

import type { GovernmentScheme, SchemeBindingMethod } from '../types'

/** Category of government source a connector represents. Intentionally coarse — enough to report coverage by, not a taxonomy to grow without bound. */
export type GovernmentSourceType = 'open_data_api' | 'ministry_portal' | 'state_portal' | 'other_official'

export type SourceScope = 'central' | 'state'

/** Static, provider-independent description of one government source. */
export interface GovernmentSourceDescriptor {
  /** Stable id, e.g. 'data-gov-in'. */
  id: string
  name: string
  sourceType: GovernmentSourceType
  /** Hostname this source publishes from — must be on the trusted allowlist (trustedSources.ts) for any evidence it produces to survive validation. */
  officialDomain: string
  scope: SourceScope
  /** Present only when scope === 'state'. */
  state?: string
}

/**
 * One discovery pass in the multi-pass retrieval architecture (Prompt 8,
 * Step 10). A connector may choose to only respond to passes relevant to
 * it (e.g. a state-specific connector ignores 'central').
 */
export type DiscoveryPass =
  | 'broad_discovery'
  | 'beneficiary_eligibility'
  | 'business_sector'
  | 'financing_subsidy'
  | 'state_specific'
  | 'central'

export interface ConnectorQuery {
  /** Local scheme ids we'd like evidence for — normally the current turn's top-ranked schemes. Never the sole basis for binding evidence to one of them (see schemeBinding.ts). */
  schemeIds: string[]
  state?: string
  sector?: string
  pass: DiscoveryPass
}

/**
 * A government evidence record, normalized to one shape regardless of
 * connector/source — Prompt 8 Step 3. Every field is preserved ONLY where
 * actually supplied by the source. Unknown remains unknown: nothing here is
 * ever fabricated or inferred to fill a gap.
 */
export interface NormalizedGovernmentRecord {
  /** Stable identifier for this record, scoped to its source connector — used for deduplication and change detection. */
  sourceRecordId: string
  sourceId: string
  sourceName: string
  sourceType: GovernmentSourceType
  sourceUrl: string
  officialApplicationUrl?: string
  /** A scheme identifier the record ITSELF declares — never inferred from which scheme id we requested. */
  explicitSchemeId?: string
  schemeName?: string
  ministry?: string
  department?: string
  scope?: SourceScope
  state?: string
  district?: string
  sector?: string
  beneficiaryInfo?: string
  eligibilityInfo?: string
  benefitType?: string
  financialFacts?: string
  requiredDocuments?: string[]
  applicationInfo?: string
  publishedAt?: string
  updatedAt?: string
  effectiveAt?: string
  /** When THIS app retrieved the record — never conflated with publishedAt/updatedAt. */
  retrievedAt: string
  version?: string
  etag?: string
  contentHash?: string
  /** Human-readable fact derivable from the record — never eligibility criteria, never an amount not present in the record. */
  summary: string
  /** Opaque pointer back to the raw record/reference for audit purposes (e.g. a resource URL + row index). Never surfaced to a user directly. */
  rawReference?: string
}

export type ConnectorOutcomeStatus = 'success' | 'failure' | 'not_configured'

export interface ConnectorOutcome {
  sourceId: string
  sourceName: string
  scope: SourceScope
  status: ConnectorOutcomeStatus
  recordCount: number
  error?: string
  pass: DiscoveryPass
}

/**
 * Provider-independent government source connector. A connector RETRIEVES
 * and NORMALIZES evidence; it never decides eligibility, never invents a
 * scheme, and never couples to Gemini/React/Supabase tables directly.
 */
export interface GovernmentSourceConnector {
  readonly descriptor: GovernmentSourceDescriptor
  /** Whether this connector is currently configured/reachable — checked before every fetch attempt, never assumed. */
  isAvailable(): Promise<boolean>
  /**
   * Retrieves and normalizes evidence for one discovery pass. Must throw on
   * any failure (network error, malformed response, timeout) rather than
   * silently returning an empty/partial result dressed up as success — the
   * caller treats a throw as "this source failed", never as "checked, found
   * nothing".
   */
  fetchNormalized(query: ConnectorQuery): Promise<NormalizedGovernmentRecord[]>
}

export interface SchemeBindingDecision {
  method: SchemeBindingMethod
  bound: boolean
  reason: string
}

export interface SourceCoverageAccounting {
  sourcesIntended: number
  sourcesQueried: number
  sourcesSuccessful: number
  sourcesFailed: number
  sourcesNotConfigured: number
  recordsRetrieved: number
  recordsNormalized: number
  recordsRejected: number
  recordsDeduplicated: number
  schemeSpecificVerifiedCount: number
  contextualEvidenceCount: number
  candidateSchemeCount: number
  eligibleSchemeCount: number
  centralSourcesQueried: number
  stateSourcesQueried: number
  /** Always false — a real national-completeness guarantee requires a government-source registry this project does not have. Never flip this without such a registry actually existing. */
  claimsAllGovernmentSchemesChecked: false
  sourceOutcomes: ConnectorOutcome[]
}

export interface GovernmentEvidenceResult {
  boundEvidence: Array<import('../types').LiveEvidenceItem>
  contextualEvidence: Array<import('../types').ContextualEvidenceItem>
  coverage: SourceCoverageAccounting
}

export type SchemeLookup = (schemeId: string) => GovernmentScheme | undefined
