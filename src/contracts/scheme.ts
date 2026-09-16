/**
 * Government scheme registry contracts.
 * LLM consumers MUST only cite facts from these DTOs — never free-form knowledge.
 */

import type {
  DataProvenanceKind,
  IsoDateTime,
  ProvenanceEnvelope,
  Uuid,
  VerificationStatus,
} from './common'
import type { BusinessCategory } from './domain'

export type JurisdictionLevel = 'central' | 'state' | 'ministry' | 'department'
export type SourceType =
  | 'official_website'
  | 'official_api'
  | 'official_dataset'
  | 'gazette_notification'
  | 'internal_curated'
  | 'prototype_fixture'

export interface Ministry {
  id: Uuid
  code: string
  nameEn: string
  nameKn: string
  level: JurisdictionLevel
}

export interface Department {
  id: Uuid
  ministryId: Uuid
  code: string
  nameEn: string
  nameKn: string
}

export interface SchemeSource {
  id: Uuid
  sourceType: SourceType
  titleEn: string
  url: string | null
  publisher: string
  publishedAt: IsoDateTime | null
  retrievedAt: IsoDateTime
  confidence: number
  status: VerificationStatus
  notesEn: string
}

export interface SchemeLoanTerms {
  projectCostMinRupees: number | null
  projectCostMaxRupees: number | null
  loanRatio: number
  loanCapRupees: number | null
  interestRatePercent: number
  tenureYears: number
  moratoriumMonths: number
  marginRatio: number
}

export interface SchemeBenefit {
  kind: 'loan' | 'subsidy' | 'grant' | 'other'
  summaryEn: string
  summaryKn: string
}

export interface SchemeDocumentRequirement {
  docType: string
  required: boolean
  labelEn: string
  labelKn: string
  /** true when list is indicative / not from an official circular */
  indicative: boolean
}

export interface SchemeVersionRecord {
  id: Uuid
  schemeId: Uuid
  version: string
  effectiveFrom: IsoDateTime
  effectiveTo: IsoDateTime | null
  benefits: SchemeBenefit[]
  loanTerms: SchemeLoanTerms | null
  subsidies: SchemeBenefit[]
  procedureSummaryEn: string
  procedureSummaryKn: string
  officialUrls: string[]
  documents: SchemeDocumentRequirement[]
  eligibilitySummaryEn: string
  eligibilitySummaryKn: string
  /** Machine-oriented eligibility hints for recommenders (not LLM prose). */
  eligibilityHints: {
    communitiesPreferred: Array<'sc' | 'st' | 'obc' | 'general'>
    maxAnnualIncomeRupees: number | null
    womenPriority: boolean
    minAge: number | null
    maxAge: number | null
    businessCategories: BusinessCategory[] | null
    states: string[] | null
  }
  verificationStatus: VerificationStatus
  publishedAt: IsoDateTime | null
  retrievedAt: IsoDateTime
  freshnessScore: number
  sources: SchemeSource[]
}

export interface SchemeRecord {
  id: Uuid
  code: string
  nameEn: string
  nameKn: string
  jurisdiction: JurisdictionLevel
  owningDepartmentId: Uuid
  owningMinistryId: Uuid
  status: 'active' | 'draft' | 'retired'
  latestVersion: SchemeVersionRecord | null
}

export interface SchemeSummary {
  id: Uuid
  code: string
  nameEn: string
  nameKn: string
  jurisdiction: JurisdictionLevel
  verificationStatus: VerificationStatus
  provenance: DataProvenanceKind
  latestVersionId: Uuid | null
  latestVersion: string | null
}

export interface SchemeFilter {
  jurisdiction?: JurisdictionLevel
  ministryId?: Uuid
  departmentId?: Uuid
  businessCategory?: BusinessCategory
  verificationStatus?: VerificationStatus
  stateCode?: string
}

export type SchemeSummaryEnvelope = ProvenanceEnvelope<SchemeSummary[]>
export type SchemeVersionEnvelope = ProvenanceEnvelope<SchemeVersionRecord>
