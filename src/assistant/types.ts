/**
 * AI Government Scheme Assistant — core domain types.
 *
 * These types are independent of the existing NSFDC/LokScore domain in
 * src/lib — the assistant is a separate feature and must not change the
 * behaviour of /scan, /pulse, /report, /finance, /sanction, /export.
 */

export type AreaType = 'rural' | 'urban'
export type Gender = 'male' | 'female' | 'other'
export type SocialCategory = 'sc' | 'st' | 'obc' | 'general'
export type BusinessStage = 'idea' | 'new' | 'existing_expansion'
export type SchemeScope = 'central' | 'state'

/**
 * Confidence label for a knowledge-base entry — NOT an eligibility
 * confidence. 'reference' means the entry was manually curated from public
 * scheme documentation and should be re-verified against the official
 * source before being relied upon; it is never "live" government data.
 */
export type SchemeConfidence = 'reference'

export interface UserProfile {
  state?: string
  district?: string
  areaType?: AreaType
  age?: number
  gender?: Gender
  socialCategory?: SocialCategory
  annualIncome?: number
  occupation?: string
  businessStatus?: 'idea' | 'existing'
  proposedBusiness?: string
  /** Normalized sector tag, e.g. 'poultry', 'tailoring' — see SECTOR_KEYWORDS. */
  businessSector?: string
  investmentRequired?: number
  ownContribution?: number
  financingRequired?: number
  existingLoans?: string
  businessStage?: BusinessStage
  education?: string
  landOrAssets?: string
  /** Free-text fragments captured but not mapped to a structured field. */
  rawNotes: string[]
}

export const EMPTY_PROFILE: UserProfile = { rawNotes: [] }

export interface ProfileFieldMeta {
  field: keyof UserProfile
  label: string
  priority: number
  question: string
}

export interface SchemeEligibilityCriteria {
  /** Indian state names this scheme is restricted to. Absent = no state restriction. */
  states?: string[]
  areaTypes?: AreaType[]
  minAge?: number
  maxAge?: number
  genders?: Gender[]
  socialCategories?: SocialCategory[]
  maxAnnualIncome?: number
  /** Sector tags this scheme supports. Absent or including 'any' = sector-agnostic. */
  businessSectors?: string[]
  /** Sector tags explicitly excluded even if businessSectors is broad. */
  excludedBusinessSectors?: string[]
  businessStages?: BusinessStage[]
  requiresGreenfield?: boolean
  minEducationNote?: string
  notes?: string
  /**
   * Some schemes gate on a demographic OR, not AND (e.g. Stand-Up India:
   * SC/ST *or* woman). When present, the applicant must satisfy the base
   * genders/socialCategories fields above, OR at least one of these groups.
   * Leave genders/socialCategories above undefined when the only gate is
   * this OR group.
   */
  eligibleIfAny?: Array<{ genders?: Gender[]; socialCategories?: SocialCategory[] }>
}

export interface SchemeLoanInfo {
  minRupees?: number
  maxRupees?: number
  notes?: string
}

export interface SchemeSubsidyInfo {
  description: string
  ratePercentMin?: number
  ratePercentMax?: number
}

export interface SchemeInterestInfo {
  ratePercent?: number
  notes?: string
}

export interface GovernmentScheme {
  id: string
  name: string
  shortName?: string
  description: string
  ministry: string
  scope: SchemeScope
  /** Present only when scope === 'state'. */
  state?: string
  eligibility: SchemeEligibilityCriteria
  loanAmount?: SchemeLoanInfo
  subsidy?: SchemeSubsidyInfo
  interest?: SchemeInterestInfo
  documents: string[]
  applicationSteps: string[]
  officialApplicationUrl: string
  officialInfoUrl: string
  source: string
  sourceUrl: string
  lastVerifiedDate: string
  confidence: SchemeConfidence
  tags: string[]
}

export type EligibilityStatus =
  | 'likely_eligible'
  | 'possibly_eligible'
  | 'likely_ineligible'
  | 'insufficient_data'

export interface EligibilityResult {
  schemeId: string
  score: number
  status: EligibilityStatus
  reasons: string[]
  mismatchReasons: string[]
  missingInfo: string[]
  confidence: 'low' | 'medium' | 'high'
}

export interface RetrievalResult {
  scheme: GovernmentScheme
  relevance: number
  matchedTags: string[]
}

export interface RankedScheme {
  scheme: GovernmentScheme
  eligibility: EligibilityResult
  relevance: number
  rankScore: number
  /** Live evidence merged in for this scheme this turn, if any — see evidenceMerge.ts. Absent/empty is the normal case. */
  liveEvidence?: LiveEvidenceItem[]
}

/**
 * Trust model for a single piece of retrieved evidence.
 *   verified_local   — from the curated local dataset (data/schemes.ts).
 *   live_official     — fetched this turn from an allowlisted official
 *                        government domain via the live-retrieval Edge
 *                        Function, AND deterministically bound to this
 *                        specific scheme (see src/assistant/evidence/
 *                        schemeBinding.ts) — never merely "requested for
 *                        this scheme id".
 *   live_contextual    — official government information that was
 *                        successfully retrieved but could NOT be
 *                        deterministically tied to one specific scheme
 *                        (e.g. a generic state/sector statistic). Useful
 *                        context; never presented as proof of a scheme's
 *                        eligibility/benefits. See Prompt 8.
 *   live_unverified    — reserved for a live result that could not be fully
 *                        validated (e.g. domain allowlisted but response
 *                        shape unexpected). Never produced by the current
 *                        implementation, which drops anything it can't
 *                        validate rather than passing it through with this
 *                        label — kept in the enum so the UI/tests have a
 *                        defined place to render it if that changes.
 *   unavailable        — live retrieval was attempted and failed, or was
 *                        never configured/attempted.
 */
export type VerificationStatus =
  | 'verified_local'
  | 'live_official'
  | 'live_contextual'
  | 'live_unverified'
  | 'unavailable'

/** How a piece of live evidence was deterministically tied to one specific scheme. See src/assistant/evidence/schemeBinding.ts. */
export type SchemeBindingMethod = 'explicit_scheme_id' | 'canonical_url_match' | 'unbound'

export interface LiveEvidenceItem {
  /** Local scheme this evidence was matched to — live evidence is never shown as a standalone, unvetted "scheme". */
  schemeId: string
  sourceName: string
  sourceUrl: string
  sourceType: 'official_open_data' | 'official_ministry' | 'official_other'
  verificationStatus: VerificationStatus
  /** When THIS app fetched it. */
  retrievedAt: string
  /** When the source itself says the underlying data was published/updated, if it says. */
  publishedAt?: string
  /** Short, human-readable fact — e.g. "1,204 units sanctioned in Karnataka in FY2023-24". Never eligibility criteria. */
  summary: string

  // --- Optional provenance/binding/freshness fields (Prompt 8). All
  // additive and optional: never fabricated when a source doesn't supply
  // them, and never required for a caller that only knows the pre-Prompt-8
  // shape (e.g. the current data.gov.in connector, which cannot supply any
  // of these). ---

  /** Stable identifier for the underlying source record, when the source/connector can supply one. */
  sourceRecordId?: string
  /** A scheme identifier the SOURCE RECORD ITSELF explicitly declares (not merely "which id we requested"). The only strong basis (besides a canonical URL match) for verificationStatus 'live_official'. */
  explicitSchemeId?: string
  /** Canonical official application URL the source record cites, if any — compared against GovernmentScheme.officialApplicationUrl for binding. */
  officialApplicationUrl?: string
  /** When the source says the underlying data was last updated (may differ from publishedAt). */
  updatedAt?: string
  /** Source-reported version/revision label, if any. */
  version?: string
  /** Source-reported ETag, if any. */
  etag?: string
  /** Content hash computed over the raw source record, if available — used for change detection/dedup. */
  contentHash?: string
  /** How this item came to be bound to `schemeId`. Absent only for evidence produced before Prompt 8. */
  bindingMethod?: SchemeBindingMethod
  /** Human-readable justification for the binding decision — never blank when bindingMethod is present. */
  bindingReason?: string
}

/**
 * Official government evidence that was retrieved successfully but could
 * NOT be deterministically tied to one specific local scheme — see
 * VerificationStatus['live_contextual']. Deliberately NOT attached to any
 * RankedScheme: it is exposed separately (report/coverage) so it can never
 * be mistaken for scheme-specific proof.
 */
export interface ContextualEvidenceItem {
  sourceName: string
  sourceUrl: string
  sourceType: 'official_open_data' | 'official_ministry' | 'official_other'
  verificationStatus: 'live_contextual'
  retrievedAt: string
  publishedAt?: string
  summary: string
  /** The scheme id(s) this evidence was originally sought for, purely for audit/debugging — NOT a binding claim. */
  requestedSchemeIds: string[]
  /** Why this could not be bound to a specific scheme. */
  reason: string
  state?: string
  sector?: string
}

/** What actually happened when this turn tried (or didn't try) live retrieval — drives the UI's source-status line. */
export interface RetrievalSourceStatus {
  status: 'verified_local' | 'live_official' | 'live_unavailable'
  checkedAt: string
}
