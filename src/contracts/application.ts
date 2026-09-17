/**
 * Application lifecycle contracts — Adita (automation) + Prerna (status UI).
 */

import type { IsoDateTime, Uuid } from './common'

export type ApplicationStatus =
  | 'draft'
  | 'profile_incomplete'
  | 'recommended'
  | 'fields_pending'
  | 'documents_pending'
  | 'citizen_review'
  | 'consent_pending'
  | 'ready_to_submit'
  | 'submitted'
  | 'under_review'
  | 'approval_pending'
  | 'approved'
  | 'rejected'
  | 'disbursement_pending'
  | 'disbursed'
  | 'withdrawn'

export type SubmissionMode = 'authorized_api' | 'assisted' | 'none'

export type ApplicationFieldSource = 'voice' | 'user' | 'system' | 'adapter'

export interface ApplicationField {
  key: string
  value: unknown
  source: ApplicationFieldSource
  updatedAt: IsoDateTime
}

export interface ApplicationDocumentMeta {
  id: Uuid
  docType: string
  storagePath: string | null
  contentHash: string | null
  validationStatus: 'pending' | 'valid' | 'invalid' | 'not_uploaded'
  indicativeRequirement: boolean
}

export interface ApplicationRecord {
  id: Uuid
  userId: Uuid
  applicantProfileId: Uuid | null
  schemeId: Uuid | null
  schemeVersionId: Uuid | null
  status: ApplicationStatus
  submissionMode: SubmissionMode
  /** Honesty label when submissionMode !== authorized_api */
  submissionLabelEn: string | null
  submissionLabelKn: string | null
  consentAt: IsoDateTime | null
  /** Set only once a government/channel-partner system has actually confirmed receipt — never fabricated. */
  governmentReferenceId: string | null
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
}

export interface ApplicationVersionRecord {
  id: Uuid
  applicationId: Uuid
  versionNumber: number
  payloadHash: string
  payload: Record<string, unknown>
  createdBy: Uuid | null
  createdAt: IsoDateTime
}

export type ApplicationEventType =
  | 'created'
  | 'profile_updated'
  | 'recommendation_attached'
  | 'field_updated'
  | 'document_uploaded'
  | 'citizen_corrected'
  | 'consent_recorded'
  | 'submitted'
  | 'status_changed'
  | 'reviewer_assigned'
  | 'approval_progress'
  | 'chain_anchored'
  | 'note'

export interface ApplicationEvent {
  id: Uuid
  applicationId: Uuid
  type: ApplicationEventType
  actorId: Uuid | null
  payload: Record<string, unknown>
  createdAt: IsoDateTime
}

export interface ApplicationStatusView {
  application: ApplicationRecord
  latestVersion: ApplicationVersionRecord | null
  documents: ApplicationDocumentMeta[]
  recentEvents: ApplicationEvent[]
}

export interface CreateApplicationInput {
  userId: Uuid
  applicantProfileId?: Uuid
  schemeId?: Uuid
  schemeVersionId?: Uuid
  initialFields?: ApplicationField[]
}

export interface UpdateApplicationFieldsInput {
  applicationId: Uuid
  actorId: Uuid | null
  fields: ApplicationField[]
}

export interface SubmitApplicationInput {
  applicationId: Uuid
  actorId: Uuid | null
  mode: SubmissionMode
  /** Caller-supplied idempotency key — a retried request with the same key replays the prior result instead of double-submitting. */
  idempotencyKey: string
  /** Only set when a real integration/channel partner has confirmed receipt. */
  governmentReferenceId?: string | null
  submissionLabelEn?: string
  submissionLabelKn?: string
}
