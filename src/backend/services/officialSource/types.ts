/**
 * Phase 3 — Government Intelligence: official source retrieval types.
 *
 * Adapters here call authorized government APIs/datasets only (data.gov.in,
 * ministry/department feeds) — never arbitrary scraping. Fixture NSFDC data
 * (src/backend/registry/fixtureSchemeRegistry.ts) remains the authoritative
 * floor; this subsystem only ever *adds* live-official enrichment on top of
 * it and never claims a scheme doesn't exist just because a source failed.
 */

import type { IsoDateTime } from '../../../contracts/common'
import type { BusinessCategory } from '../../../contracts/domain'
import type {
  JurisdictionLevel,
  SchemeBenefit,
  SchemeDocumentRequirement,
  SchemeLoanTerms,
  SourceType,
} from '../../../contracts/scheme'

/**
 * Verification state for a single retrieved candidate, scoped to this
 * retrieval pipeline. Deliberately NOT the same enum as contracts/common's
 * VerificationStatus (a stable cross-workstream contract) — mapped into it
 * only at the point a candidate is turned into a SchemeSource (see
 * normalize.ts#toSchemeSource).
 */
export type RetrievalVerificationState =
  | 'verified_local'
  | 'live_official'
  | 'live_unverified'
  | 'unavailable'

export type RetrievalPassType =
  | 'broad_discovery'
  | 'profile_aware'
  | 'state'
  | 'central'
  | 'sector'
  | 'finance'
  | 'ministry'

export interface RetrievalQuery {
  pass: RetrievalPassType
  keywords?: string[]
  stateCode?: string
  businessCategory?: BusinessCategory
  ministryCode?: string
  departmentCode?: string
  financeType?: 'loan' | 'subsidy' | 'grant'
  limit?: number
}

/** Raw, adapter-specific row before normalization — deliberately loose. */
export interface RawOfficialRecord {
  sourceAdapterId: string
  sourceType: SourceType
  raw: Record<string, unknown>
  fetchedAt: IsoDateTime
}

export interface AdapterFetchResult {
  records: RawOfficialRecord[]
  /** True when the adapter successfully reached and parsed the source (even if 0 rows). */
  ok: boolean
  errorMessage?: string
  latencyMs: number
}

export interface OfficialSourceAdapter {
  id: string
  sourceType: SourceType
  jurisdiction: JurisdictionLevel | 'mixed'
  /** False when required config (API key / resource id) is absent. Orchestrator skips cleanly — never throws. */
  isConfigured(): boolean
  fetch(query: RetrievalQuery): Promise<AdapterFetchResult>
}

export interface NormalizedSchemeCandidate {
  /** Stable dedup key: normalized code, or slug of name+ministry when no code. */
  dedupKey: string
  code: string | null
  nameEn: string
  nameKn: string | null
  jurisdiction: JurisdictionLevel
  ministryNameEn: string | null
  departmentNameEn: string | null
  officialUrl: string | null
  geography: { stateCode: string | null; nationwide: boolean }
  beneficiaryInfo: string | null
  eligibilitySummaryEn: string | null
  financialSupport: Partial<SchemeLoanTerms> | null
  benefits: SchemeBenefit[]
  documents: SchemeDocumentRequirement[]
  publishedAt: IsoDateTime | null
  updatedAt: IsoDateTime | null
  retrievedAt: IsoDateTime
  freshnessScore: number
  verificationState: RetrievalVerificationState
  sourceAdapterId: string
  sourceType: SourceType
  confidence: number
}

export interface SourceHealth {
  sourceAdapterId: string
  attempts: number
  successes: number
  failures: number
  consecutiveFailures: number
  lastAttemptAt: IsoDateTime | null
  lastSuccessAt: IsoDateTime | null
  lastErrorMessage: string | null
  lastLatencyMs: number | null
}

export interface RetrievalAttemptLogEntry {
  sourceAdapterId: string
  pass: RetrievalPassType
  at: IsoDateTime
  ok: boolean
  recordCount: number
  latencyMs: number
  errorMessage?: string
}

export type CacheState = 'fresh' | 'served_from_cache' | 'empty'

export interface DiscoveryResult {
  candidates: NormalizedSchemeCandidate[]
  attempted: RetrievalPassType[]
  sourceHealth: SourceHealth[]
  attemptLog: RetrievalAttemptLogEntry[]
  /** True when every configured live adapter for this query failed or was unconfigured. */
  allLiveSourcesUnavailable: boolean
  cacheState: CacheState
  honestyNoteEn: string
}
