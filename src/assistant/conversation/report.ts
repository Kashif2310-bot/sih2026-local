/**
 * Structured personalized-report SEAM — a data model and a deterministic
 * builder, not the visual report page (that's Prerna's UI). Everything here
 * is assembled from data that already exists elsewhere in the deterministic
 * pipeline (ApplicantProfile, RankedScheme[], ActionPlanStep[] from
 * orchestrator.ts's buildActionPlan) — nothing is invented, and nothing
 * computes a NEW eligibility/ranking/LokScore value.
 *
 * Every fact in the report is traceable to one of four buckets, matching
 * docs/applicant-profile.md's provenance model exactly:
 *   - verified evidence   -> ReportSchemeEntry.liveEvidence (live_official)
 *   - derived analysis    -> anything computed from the above (readiness,
 *                            eligibility status/score — never re-derived
 *                            here, only read from eligibility.ts's output)
 *   - user-provided facts -> citizenSnapshot, sourced from
 *                            ApplicantProfile.fieldProvenance
 *   - unknown/unverified  -> simply absent — never filled with a guess
 *
 * `opportunityAssessment.narrative` is left undefined by this builder on
 * purpose: it is a seam for a LATER guarded-AI-generated summary (via the
 * existing promptBuilder/responseGuard path), never fabricated by this
 * deterministic module.
 */

import type { ActionPlanStep } from '../orchestrator'
import type { EligibilityStatus, LiveEvidenceItem, RankedScheme, RetrievalSourceStatus } from '../types'
import type {
  ApplicantProfile,
  ApplicantProfileFieldKey,
  FieldProvenance,
} from '../../shared/applicantProfile'
import type { ReadinessAssessment } from './readiness'

export interface ReportSchemeEntry {
  schemeId: string
  schemeName: string
  eligibilityStatus: EligibilityStatus
  eligibilityConfidence: 'low' | 'medium' | 'high'
  /** Deterministic reasons FROM eligibility.ts — never re-derived here. */
  matchReasons: string[]
  concernReasons: string[]
  missingRequirements: string[]
  loanAmount?: { minRupees?: number; maxRupees?: number; notes?: string }
  subsidyDescription?: string
  documents: string[]
  applicationSteps: string[]
  officialInfoUrl: string
  /** Present only when live_official evidence was actually merged for this scheme this turn — see evidenceMerge.ts. Empty array, never fabricated. */
  liveEvidence: LiveEvidenceItem[]
}

export interface CitizenSnapshotFact {
  value: unknown
  source: FieldProvenance['source']
  confidence?: FieldProvenance['confidence']
  capturedAt?: string
}

export interface PersonalizedReport {
  generatedAt: string
  /** One entry per ApplicantProfile field actually known, each carrying its own provenance — never a flattened "profile dump" that loses where a fact came from. */
  citizenSnapshot: Partial<Record<ApplicantProfileFieldKey, CitizenSnapshotFact>>
  businessIdea: { description?: string; sector?: string }
  businessContext: { stage?: string; status?: string; experienceYears?: number; location?: { state?: string; district?: string; villageOrTown?: string } }
  /** Seam only — never populated by buildPersonalizedReport(). See module doc comment. */
  opportunityAssessment: { narrative?: string }
  relevantSchemes: ReportSchemeEntry[]
  documentsNeeded: string[]
  recommendedNextSteps: ActionPlanStep[]
  risksAndUncertainties: string[]
  sourceCoverage: { verifiedLocalCount: number; liveOfficialCount: number; totalSchemesConsidered: number }
  verification: { checkedAt: string | null; sourceStatus: RetrievalSourceStatus['status'] | null }
  readiness: ReadinessAssessment
}

function buildCitizenSnapshot(applicantProfile: ApplicantProfile): Partial<Record<ApplicantProfileFieldKey, CitizenSnapshotFact>> {
  const snapshot: Partial<Record<ApplicantProfileFieldKey, CitizenSnapshotFact>> = {}
  for (const [field, provenance] of Object.entries(applicantProfile.fieldProvenance) as Array<
    [ApplicantProfileFieldKey, FieldProvenance]
  >) {
    const value = applicantProfile.data[field]
    if (value === undefined) continue
    snapshot[field] = { value, source: provenance.source, confidence: provenance.confidence, capturedAt: provenance.capturedAt }
  }
  return snapshot
}

function buildSchemeEntries(ranked: RankedScheme[]): ReportSchemeEntry[] {
  return ranked.map((r) => ({
    schemeId: r.scheme.id,
    schemeName: r.scheme.name,
    eligibilityStatus: r.eligibility.status,
    eligibilityConfidence: r.eligibility.confidence,
    matchReasons: r.eligibility.reasons,
    concernReasons: r.eligibility.mismatchReasons,
    missingRequirements: r.eligibility.missingInfo,
    loanAmount: r.scheme.loanAmount,
    subsidyDescription: r.scheme.subsidy?.description,
    documents: r.scheme.documents,
    applicationSteps: r.scheme.applicationSteps,
    officialInfoUrl: r.scheme.officialInfoUrl,
    liveEvidence: r.liveEvidence ?? [],
  }))
}

function collectRisks(ranked: RankedScheme[]): string[] {
  const risks = new Set<string>()
  for (const r of ranked.slice(0, 5)) {
    for (const reason of r.eligibility.mismatchReasons) risks.add(reason)
  }
  return Array.from(risks)
}

function collectDocuments(ranked: RankedScheme[]): string[] {
  const docs = new Set<string>()
  for (const r of ranked.slice(0, 3)) {
    if (r.eligibility.status === 'likely_eligible' || r.eligibility.status === 'possibly_eligible') {
      for (const d of r.scheme.documents) docs.add(d)
    }
  }
  return Array.from(docs)
}

export interface BuildPersonalizedReportInput {
  applicantProfile: ApplicantProfile
  ranked: RankedScheme[]
  actionPlan: ActionPlanStep[]
  readiness: ReadinessAssessment
  sourceStatus: RetrievalSourceStatus | null
  now?: string
}

export function buildPersonalizedReport(input: BuildPersonalizedReportInput): PersonalizedReport {
  const { applicantProfile, ranked, actionPlan, readiness, sourceStatus } = input
  const now = input.now ?? new Date().toISOString()
  const data = applicantProfile.data

  const verifiedLocalCount = ranked.filter((r) => !r.liveEvidence || r.liveEvidence.length === 0).length
  const liveOfficialCount = ranked.filter((r) => r.liveEvidence && r.liveEvidence.length > 0).length

  return {
    generatedAt: now,
    citizenSnapshot: buildCitizenSnapshot(applicantProfile),
    businessIdea: { description: data.businessDescription, sector: data.businessSector },
    businessContext: {
      stage: data.businessStage,
      status: data.businessStatus,
      experienceYears: data.businessExperienceYears,
      location: { state: data.state, district: data.district, villageOrTown: data.villageOrTown },
    },
    opportunityAssessment: {},
    relevantSchemes: buildSchemeEntries(ranked),
    documentsNeeded: collectDocuments(ranked),
    recommendedNextSteps: actionPlan,
    risksAndUncertainties: collectRisks(ranked),
    sourceCoverage: { verifiedLocalCount, liveOfficialCount, totalSchemesConsidered: ranked.length },
    verification: { checkedAt: sourceStatus?.checkedAt ?? null, sourceStatus: sourceStatus?.status ?? null },
    readiness,
  }
}
