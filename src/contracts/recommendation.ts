/**
 * Recommendation contracts — deterministic matcher output for Kashif / Adita / Prerna.
 */

import type { IsoDateTime, ProvenanceEnvelope, Uuid } from './common'
import type { ApplicantProfileV2 } from './profile'

export interface RecommendationReason {
  code: string
  messageEn: string
  messageKn: string
  severity: 'info' | 'positive' | 'warning' | 'blocking'
}

export interface RecommendationResult {
  schemeId: Uuid
  schemeVersionId: Uuid
  schemeCode: string
  schemeNameEn: string
  schemeNameKn: string
  rank: number
  score: number
  eligible: boolean
  reasons: RecommendationReason[]
  /** Pin the exact version used — never float to "latest" after the fact. */
  schemeVersion: string
}

export interface RecommendationInput {
  profile: ApplicantProfileV2
  /** Optional hard filter to a state (e.g. KA). */
  stateCode?: string
  limit?: number
}

export type RecommendationEnvelope = ProvenanceEnvelope<RecommendationResult[]>

export interface RecommendationRequestMeta {
  requestedAt: IsoDateTime
  engine: 'fixture_v0'
}
