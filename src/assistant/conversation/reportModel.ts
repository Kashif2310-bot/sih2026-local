/**
 * Structured report model for the personalized analysis intelligence layer.
 *
 * Language-neutral: natural-language narratives (EN/KN/mixed) are produced
 * later by the explanation seam and never become the source of truth for
 * eligibility, amounts, documents, readiness, or scheme IDs.
 *
 * Extends — does not replace — the PersonalizedReport seam from Prompt 5.
 * See report.ts / deterministicAnalysis.ts.
 */

import type { ActionPlanStep } from '../orchestrator'
import type {
  ContextualEvidenceItem,
  EligibilityStatus,
  LiveEvidenceItem,
  RetrievalSourceStatus,
  VerificationStatus,
} from '../types'
import type {
  ApplicantProfileFieldKey,
  ApplicantProfileFieldSource,
  FieldProvenance,
} from '../../shared/applicantProfile'
import type { LokScoreBreakdown } from '../../lib/lokScore'
import type { SchemePlan } from '../../lib/finance'
import type { RecommendationReadiness, ReadinessAssessment } from './readiness'

/** How complete the underlying evidence is for this report version. */
export type ReportMaturity = RecommendationReadiness

/**
 * Explicit fact buckets — never mixed in the report model.
 * UI must not invent a category by parsing narrative text.
 */
export type ReportFactCategory =
  | 'user_provided'
  | 'verified_government'
  | 'derived_analysis'
  | 'uncertainty'
  | 'assumption_inference'
  | 'missing'

export interface CitizenSnapshotFact {
  value: unknown
  source: FieldProvenance['source']
  confidence?: FieldProvenance['confidence']
  capturedAt?: string
  /** Always user_provided / government_verified / etc. from ApplicantProfile provenance — never "derived" for a raw profile field. */
  category: 'user_provided' | 'verified_government' | 'assumption_inference'
}

export interface ExecutiveSummary {
  whatCitizenWants?: string
  where?: string
  businessStage?: string
  financingIntention: string | 'undetermined'
  keyStrengths: string[]
  majorBlockers: string[]
  overallReadiness: ReportMaturity
}

export interface BusinessSnapshot {
  businessIdea?: string
  sector?: string
  businessStage?: string
  businessStatus?: string
  intendedScale?: string
  expansionOrNew?: 'expansion' | 'new' | 'unknown'
  locationContext?: { state?: string; district?: string; villageOrTown?: string; areaType?: string }
  intendedInvestment?: { amountRupees?: number; status: 'known' | 'unknown' }
  financingRequirement?: { amountRupees?: number; status: 'known' | 'unknown' | 'user_uncertain' }
  statedObjective?: string
}

export type OpportunityDimensionId =
  | 'eligibility_fit'
  | 'financing_fit'
  | 'local_context_fit'
  | 'business_stage_fit'
  | 'readiness'
  | 'information_completeness'
  | 'application_feasibility'

export type OpportunityDimensionStatus =
  | 'strong'
  | 'moderate'
  | 'weak'
  | 'unknown'
  | 'insufficient_information'

export interface OpportunityDimension {
  id: OpportunityDimensionId
  status: OpportunityDimensionStatus
  supportingEvidence: string[]
  uncertainties: string[]
  missingInformation: string[]
}

/**
 * Business suitability conclusions — deliberately soft and evidence-bound.
 * Never profitability, demand, approval, or subsidy guarantees.
 */
export type BusinessSuitabilityKind =
  | 'information_insufficient'
  | 'promising_based_on_stated_resources'
  | 'requires_additional_validation'
  | 'financing_appears_aligned'
  | 'significant_unresolved_constraint'

export interface BusinessSuitabilityAssessment {
  kind: BusinessSuitabilityKind
  rationale: string
  /** Explicitly false unless evidence supports a positive statement — never invents profit/demand. */
  claimsProfitability: false
  claimsGuaranteedDemand: false
  claimsGuaranteedApproval: false
  claimsGuaranteedSubsidy: false
}

export interface OpportunityAssessment {
  dimensions: OpportunityDimension[]
  businessSuitability: BusinessSuitabilityAssessment
  /**
   * Optional reference to an EXISTING LokScoreBreakdown computed elsewhere
   * (src/lib/lokScore.ts). Never computed inside the report builder.
   */
  lokScore?: LokScoreBreakdown
  /** Filled only by the guarded explanation seam — never by deterministic builders. */
  narrative?: string
}

export type SchemeMatchRecommendation = 'strong_match' | 'possible_match' | 'insufficient_information' | 'mismatch'

export interface ReportSchemeEntry {
  schemeId: string
  schemeName: string
  source: string
  verificationStatus: VerificationStatus
  lastVerifiedDate?: string
  eligibilityStatus: EligibilityStatus
  eligibilityConfidence: 'low' | 'medium' | 'high'
  recommendation: SchemeMatchRecommendation
  /** Deterministic "why this matches / does not" — from eligibility evidence, never LLM inventiveness. */
  matchExplanation: string
  matchReasons: string[]
  concernReasons: string[]
  missingRequirements: string[]
  benefitType?: string
  loanAmount?: { minRupees?: number; maxRupees?: number; notes?: string }
  subsidyDescription?: string
  documents: string[]
  applicationSteps: string[]
  applicationRoute?: string
  officialInfoUrl: string
  officialApplicationUrl?: string
  liveEvidence: LiveEvidenceItem[]
  /** Existing deterministic rankScore — authoritative order comes from RankedScheme[]. */
  rankScore: number
}

export interface ComparativeOption {
  schemeId: string
  schemeName: string
  fit: SchemeMatchRecommendation
  benefitType?: string
  financingRequirementNotes?: string
  missingRequirements: string[]
  documents: string[]
  applicationComplexity: 'unknown' | 'few_steps' | 'many_steps'
  verificationStatus: VerificationStatus
  rankScore: number
}

export type FinancialPathStatus = 'determined' | 'partial' | 'not_determined'

/**
 * References results from src/lib/finance.ts's buildSchemePlan — never
 * reimplements EMI / interest / subsidy math.
 */
export interface ReferencedNsfdcPlan {
  schemeId: SchemePlan['schemeId']
  schemeName: string
  projectCost: number
  loanAmount: number
  marginRequired: number
  interestRate: number
  tenureYears: number
  quarterlyEmi: number
  /** Provenance: always the existing finance engine. */
  computedBy: 'src/lib/finance.ts#buildSchemePlan'
}

export interface FinancialPath {
  status: FinancialPathStatus
  statedInvestmentRequired?: number
  statedFinancingRequired?: number
  statedOwnContribution?: number
  nsfdcPlan?: ReferencedNsfdcPlan
  notes: string[]
}

export type DocumentVerificationState = 'required' | 'user_mentioned' | 'verified' | 'missing'

export interface DocumentReadinessItem {
  documentName: string
  schemeId?: string
  schemeName?: string
  required: true
  /** Never true merely because a profile field exists. */
  knownToExist: boolean
  verificationState: DocumentVerificationState
  source: 'scheme_requirement' | 'user_mentioned' | 'government_verified'
}

export type ApplicationReadinessStatus =
  | 'not_ready'
  | 'gathering_information'
  | 'ready_for_review'
  | 'ready_for_application'

export type ApplicationReadinessDimensionId =
  | 'profile_completeness'
  | 'scheme_selected'
  | 'eligibility_evidence_complete'
  | 'required_documents_known'
  | 'required_documents_verified'
  | 'financing_information_complete'
  | 'consent_readiness'
  | 'official_application_path_available'

export interface ApplicationReadinessDimension {
  id: ApplicationReadinessDimensionId
  met: boolean
  detail: string
}

export interface ApplicationReadinessAssessment {
  status: ApplicationReadinessStatus
  dimensions: ApplicationReadinessDimension[]
  /** Explicit: ready_for_application ≠ submitted. */
  applicationSubmitted: false
}

export type UncertaintyKind =
  | 'missing_information'
  | 'source_unavailable'
  | 'source_stale'
  | 'conflicting_information'
  | 'user_uncertainty'
  | 'eligibility_ambiguity'
  | 'finance_uncertainty'
  | 'application_integration_unavailable'

export interface UncertaintyItem {
  kind: UncertaintyKind
  message: string
  relatedFields?: ApplicantProfileFieldKey[]
  relatedSchemeIds?: string[]
}

export interface SourceCoverageReport {
  sourcesQueried: string[]
  sourcesSuccessfullyRetrieved: string[]
  sourcesUnavailable: string[]
  candidateSchemeCount: number
  eligibleOrPossibleCount: number
  verifiedLocalCount: number
  liveOfficialCount: number
  totalSchemesConsidered: number
  verificationTimestamps: string[]
  /** Always true until a real government-source registry claims otherwise (Vamshi). */
  claimsAllGovernmentSchemesChecked: false
  /** Government evidence retrieved but not tied to any specific scheme (Prompt 8) — see governmentContextualEvidence on PersonalizedReport for the full items. */
  contextualEvidenceCount: number
  /** Raw records seen from connectors before validation/dedup/binding, for audit — 0 whenever live retrieval was not attempted. */
  recordsRetrieved: number
  recordsRejected: number
  recordsDeduplicated: number
  sourcesFailedCount: number
  sourcesNotConfiguredCount: number
  centralSourcesQueried: number
  stateSourcesQueried: number
}

export type ExplanationLanguage = 'en' | 'kn' | 'mixed'

export interface GuardedExplanation {
  language: ExplanationLanguage
  text: string
  usedProvider: 'offline_template' | 'ai_provider' | 'deterministic_fallback'
  guardPassed: boolean
  fellBack: boolean
}

export interface PersonalizedReport {
  /** Stable across refreshes of the same conversation lineage until a hard reset. */
  reportId: string
  /** Increments on every fresh build from changed underlying state. */
  version: number
  generatedAt: string
  maturity: ReportMaturity

  executiveSummary: ExecutiveSummary
  /** One entry per ApplicantProfile field actually known, with provenance. */
  citizenSnapshot: Partial<Record<ApplicantProfileFieldKey, CitizenSnapshotFact>>
  businessIdea: { description?: string; sector?: string }
  businessContext: {
    stage?: string
    status?: string
    experienceYears?: number
    location?: { state?: string; district?: string; villageOrTown?: string }
  }
  businessSnapshot: BusinessSnapshot
  opportunityAssessment: OpportunityAssessment
  relevantSchemes: ReportSchemeEntry[]
  comparativeView: ComparativeOption[]
  /** Official government evidence that could NOT be deterministically bound to any specific scheme this turn (Prompt 8) — never eligibility/benefit proof for any listed scheme, kept structurally separate from relevantSchemes[].liveEvidence. */
  governmentContextualEvidence: ContextualEvidenceItem[]
  financialPath: FinancialPath
  documentReadiness: DocumentReadinessItem[]
  /** Flat list retained for Prompt 5 consumers — derived from documentReadiness. */
  documentsNeeded: string[]
  applicationReadiness: ApplicationReadinessAssessment
  recommendedNextSteps: ActionPlanStep[]
  /** Flat strings retained for Prompt 5 consumers — prefer `uncertainties`. */
  risksAndUncertainties: string[]
  uncertainties: UncertaintyItem[]
  sourceCoverage: SourceCoverageReport
  verification: { checkedAt: string | null; sourceStatus: RetrievalSourceStatus['status'] | null }
  readiness: ReadinessAssessment
  /** Optional guarded narratives — never required for UI to render structured fields. */
  explanations?: GuardedExplanation[]
}

export function mapProvenanceSourceToCategory(
  source: ApplicantProfileFieldSource,
): CitizenSnapshotFact['category'] {
  if (source === 'government_verified') return 'verified_government'
  if (source === 'system_derived' || source === 'ai_extracted') return 'assumption_inference'
  return 'user_provided'
}
