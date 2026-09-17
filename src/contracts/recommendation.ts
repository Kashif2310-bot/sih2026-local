/**
 * Recommendation contracts — deterministic matcher output for Kashif / Adita / Prerna.
 */

import type { IsoDateTime, ProvenanceEnvelope, Uuid } from './common'
import type { ApplicantProfileV2, MissingField } from './profile'

export interface RecommendationReason {
  code: string
  messageEn: string
  messageKn: string
  severity: 'info' | 'positive' | 'warning' | 'blocking'
}

/** Deterministic, rule-based follow-up action — never an LLM suggestion. */
export interface RecommendationNextStep {
  code: string
  messageEn: string
  messageKn: string
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
  /** Profile fields still missing that this recommendation depends on. */
  missingFields: MissingField[]
  /** From the scheme version's own freshnessScore — how current the underlying facts are. */
  freshnessScore: number
  /** What the applicant should do next, derived from eligibility/reasons/missing fields. */
  nextSteps: RecommendationNextStep[]
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
