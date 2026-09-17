/**
 * Service interfaces — stable boundaries for parallel workstreams.
 * Implementations live under src/backend/services/.
 */

import type {
  ApplicationEvent,
  ApplicationRecord,
  ApplicationStatusView,
  CreateApplicationInput,
  SubmitApplicationInput,
  UpdateApplicationFieldsInput,
} from '../../contracts/application'
import type { ApplicantProfileV2, ApplicantProfilePatch, MissingField } from '../../contracts/profile'
import type { RecommendationEnvelope, RecommendationInput } from '../../contracts/recommendation'
import type {
  Department,
  Ministry,
  SchemeFilter,
  SchemeRecord,
  SchemeSummaryEnvelope,
  SchemeVersionEnvelope,
} from '../../contracts/scheme'
import type { Uuid } from '../../contracts/common'

/** Kashif + Backend: conversational profile store / merge. */
export interface ProfileCreateOptions {
  /** Required when persisting to Supabase (FK → profiles.id). Optional for memory. */
  userId?: Uuid
  conversationId?: Uuid
}

export interface ProfileService {
  create(locale?: ApplicantProfileV2['locale'], opts?: ProfileCreateOptions): Promise<ApplicantProfileV2>
  get(id: Uuid): Promise<ApplicantProfileV2 | null>
  applyPatch(id: Uuid, patch: ApplicantProfilePatch): Promise<ApplicantProfileV2>
  getMissingFields(id: Uuid): Promise<MissingField[]>
}

/** Scheme retrieval — replace fixture with Supabase without changing callers. */
export interface SchemeRetrievalService {
  listSchemes(filter?: SchemeFilter): Promise<SchemeSummaryEnvelope>
  getScheme(schemeId: Uuid): Promise<SchemeRecord | null>
  getSchemeVersion(schemeId: Uuid, version: string): Promise<SchemeVersionEnvelope | null>
  getLatestVerifiedVersion(schemeId: Uuid): Promise<SchemeVersionEnvelope | null>
  listMinistries(): Promise<Ministry[]>
  listDepartments(ministryId?: Uuid): Promise<Department[]>
}

/** Deterministic recommendations grounded in registry facts only. */
export interface RecommendationService {
  recommend(input: RecommendationInput): Promise<RecommendationEnvelope>
}

/** Adita: application persistence. */
export interface ApplicationPersistenceService {
  create(input: CreateApplicationInput): Promise<ApplicationRecord>
  get(applicationId: Uuid): Promise<ApplicationRecord | null>
  updateFields(input: UpdateApplicationFieldsInput): Promise<ApplicationRecord>
  setStatus(applicationId: Uuid, status: ApplicationRecord['status'], actorId: Uuid | null): Promise<ApplicationRecord>
  recordConsent(applicationId: Uuid, actorId: Uuid, at?: string): Promise<ApplicationRecord>
  attachScheme(
    applicationId: Uuid,
    schemeId: Uuid,
    schemeVersionId: Uuid,
    actorId: Uuid | null,
  ): Promise<ApplicationRecord>
  /**
   * Idempotent submission: a retried call with the same idempotencyKey
   * replays the prior result; a different key on an already-submitted
   * application is rejected (CONFLICT) rather than double-submitting.
   * Requires consent to already be recorded.
   */
  submit(input: SubmitApplicationInput): Promise<ApplicationRecord>
}

/** Prerna: citizen/admin status views. */
export interface ApplicationStatusService {
  getStatusView(applicationId: Uuid): Promise<ApplicationStatusView | null>
  listEvents(applicationId: Uuid, limit?: number): Promise<ApplicationEvent[]>
}

/** Registry port — same surface as SchemeRetrievalService for DI. */
export type SchemeRegistry = SchemeRetrievalService
