/**
 * Map Postgres/snake_case rows ↔ shared contracts.
 */

import type { Uuid, VerificationStatus } from '../../contracts/common'
import type {
  ApplicationEvent,
  ApplicationRecord,
  ApplicationStatus,
  ApplicationVersionRecord,
  SubmissionMode,
} from '../../contracts/application'
import type { ApplicantProfileV2 } from '../../contracts/profile'
import type {
  Department,
  JurisdictionLevel,
  Ministry,
  SchemeRecord,
  SchemeSource,
  SchemeVersionRecord,
} from '../../contracts/scheme'

export interface MinistryRow {
  id: string
  code: string
  name_en: string
  name_kn: string
  level: JurisdictionLevel
}

export interface DepartmentRow {
  id: string
  ministry_id: string
  code: string
  name_en: string
  name_kn: string
}

export interface SchemeRow {
  id: string
  code: string
  name_en: string
  name_kn: string
  jurisdiction: JurisdictionLevel
  owning_department_id: string
  owning_ministry_id: string
  status: 'active' | 'draft' | 'retired'
}

export interface SchemeVersionRow {
  id: string
  scheme_id: string
  version: string
  effective_from: string
  effective_to: string | null
  benefits: SchemeVersionRecord['benefits']
  loan_terms: SchemeVersionRecord['loanTerms']
  subsidies: SchemeVersionRecord['subsidies']
  procedure_summary_en: string
  procedure_summary_kn: string
  official_urls: string[]
  documents: SchemeVersionRecord['documents']
  eligibility_summary_en: string
  eligibility_summary_kn: string
  eligibility_hints: SchemeVersionRecord['eligibilityHints']
  verification_status: VerificationStatus
  published_at: string | null
  retrieved_at: string
  freshness_score: number
}

export interface SchemeSourceRow {
  id: string
  source_type: SchemeSource['sourceType']
  title_en: string
  url: string | null
  publisher: string
  published_at: string | null
  retrieved_at: string
  confidence: number
  status: VerificationStatus
  notes_en: string
}

export interface ApplicationRow {
  id: string
  user_id: string
  applicant_profile_id: string | null
  scheme_id: string | null
  scheme_version_id: string | null
  status: ApplicationStatus
  submission_mode: SubmissionMode
  submission_label_en: string | null
  submission_label_kn: string | null
  consent_at: string | null
  government_reference_id: string | null
  /** Internal dedup bookkeeping — never mapped into the public ApplicationRecord. */
  submission_idempotency_key?: string | null
  created_at: string
  updated_at: string
}

export interface ApplicationVersionRow {
  id: string
  application_id: string
  version_number: number
  payload_hash: string
  payload: Record<string, unknown>
  created_by: string | null
  created_at: string
}

export interface ApplicationEventRow {
  id: string
  application_id: string
  type: ApplicationEvent['type']
  actor_id: string | null
  payload: Record<string, unknown>
  created_at: string
}

export interface ApplicantProfileRow {
  id: string
  user_id: string
  conversation_id: string | null
  locale: string
  profile: ApplicantProfileV2
  created_at: string
  updated_at: string
}

export function mapMinistry(row: MinistryRow): Ministry {
  return {
    id: row.id as Uuid,
    code: row.code,
    nameEn: row.name_en,
    nameKn: row.name_kn,
    level: row.level,
  }
}

export function mapDepartment(row: DepartmentRow): Department {
  return {
    id: row.id as Uuid,
    ministryId: row.ministry_id as Uuid,
    code: row.code,
    nameEn: row.name_en,
    nameKn: row.name_kn,
  }
}

export function mapSchemeSource(row: SchemeSourceRow): SchemeSource {
  return {
    id: row.id as Uuid,
    sourceType: row.source_type,
    titleEn: row.title_en,
    url: row.url,
    publisher: row.publisher,
    publishedAt: row.published_at,
    retrievedAt: row.retrieved_at,
    confidence: Number(row.confidence),
    status: row.status,
    notesEn: row.notes_en,
  }
}

export function mapSchemeVersion(row: SchemeVersionRow, sources: SchemeSource[] = []): SchemeVersionRecord {
  return {
    id: row.id as Uuid,
    schemeId: row.scheme_id as Uuid,
    version: row.version,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    benefits: row.benefits ?? [],
    loanTerms: row.loan_terms ?? null,
    subsidies: row.subsidies ?? [],
    procedureSummaryEn: row.procedure_summary_en,
    procedureSummaryKn: row.procedure_summary_kn,
    officialUrls: row.official_urls ?? [],
    documents: row.documents ?? [],
    eligibilitySummaryEn: row.eligibility_summary_en,
    eligibilitySummaryKn: row.eligibility_summary_kn,
    eligibilityHints: row.eligibility_hints ?? {
      communitiesPreferred: [],
      maxAnnualIncomeRupees: null,
      womenPriority: false,
      minAge: null,
      maxAge: null,
      businessCategories: null,
      states: null,
    },
    verificationStatus: row.verification_status,
    publishedAt: row.published_at,
    retrievedAt: row.retrieved_at,
    freshnessScore: Number(row.freshness_score),
    sources,
  }
}

export function mapScheme(row: SchemeRow, latestVersion: SchemeVersionRecord | null): SchemeRecord {
  return {
    id: row.id as Uuid,
    code: row.code,
    nameEn: row.name_en,
    nameKn: row.name_kn,
    jurisdiction: row.jurisdiction,
    owningDepartmentId: row.owning_department_id as Uuid,
    owningMinistryId: row.owning_ministry_id as Uuid,
    status: row.status,
    latestVersion,
  }
}

export function mapApplication(row: ApplicationRow): ApplicationRecord {
  return {
    id: row.id as Uuid,
    userId: row.user_id as Uuid,
    applicantProfileId: row.applicant_profile_id as Uuid | null,
    schemeId: row.scheme_id as Uuid | null,
    schemeVersionId: row.scheme_version_id as Uuid | null,
    status: row.status,
    submissionMode: row.submission_mode,
    submissionLabelEn: row.submission_label_en,
    submissionLabelKn: row.submission_label_kn,
    consentAt: row.consent_at,
    governmentReferenceId: row.government_reference_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function mapApplicationVersion(row: ApplicationVersionRow): ApplicationVersionRecord {
  return {
    id: row.id as Uuid,
    applicationId: row.application_id as Uuid,
    versionNumber: row.version_number,
    payloadHash: row.payload_hash,
    payload: row.payload ?? {},
    createdBy: row.created_by as Uuid | null,
    createdAt: row.created_at,
  }
}

export function mapApplicationEvent(row: ApplicationEventRow): ApplicationEvent {
  return {
    id: row.id as Uuid,
    applicationId: row.application_id as Uuid,
    type: row.type,
    actorId: row.actor_id as Uuid | null,
    payload: row.payload ?? {},
    createdAt: row.created_at,
  }
}

export function hydrateApplicantProfile(row: ApplicantProfileRow): ApplicantProfileV2 {
  const body = row.profile
  return {
    ...body,
    id: row.id as Uuid,
    userId: row.user_id as Uuid,
    conversationId: (row.conversation_id as Uuid | null) ?? body.conversationId,
    locale: (row.locale as ApplicantProfileV2['locale']) || body.locale || 'en',
    createdAt: body.createdAt || row.created_at,
    updatedAt: row.updated_at,
  }
}
