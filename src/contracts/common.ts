/**
 * Shared cross-workstream primitives.
 * Stable contracts — change only with an explicit team decision.
 */

/** Auth / portal roles (maps to public.profiles.role). */
export type UserRole = 'citizen' | 'reviewer' | 'admin' | 'service'

/** How a fact was obtained — never upgrade provenance silently. */
export type DataProvenanceKind =
  | 'user_input'
  | 'voice_extract'
  | 'system_computed'
  | 'curated_seed'
  | 'live_lookup'
  | 'official_source'
  | 'prototype_indicative'

export type VerificationStatus =
  | 'unverified'
  | 'prototype_indicative'
  | 'verified'
  | 'stale'
  | 'rejected'

/** Envelope for every API payload that cites scheme/gov facts. */
export interface ProvenanceEnvelope<T> {
  data: T
  provenance: DataProvenanceKind
  verificationStatus: VerificationStatus
  stale: boolean
  sourceIds: string[]
  retrievedAt: string
  /** Human-readable honesty note (EN). */
  honestyNoteEn: string
  honestyNoteKn?: string
}

export interface ApiErrorBody {
  code: string
  message: string
  messageKn?: string
  details?: Record<string, unknown>
}

export type IsoDateTime = string
export type Uuid = string
