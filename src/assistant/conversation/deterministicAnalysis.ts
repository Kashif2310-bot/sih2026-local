/**
 * DeterministicAnalysis — intermediate structured analysis assembled ONLY
 * from ApplicantProfile + RankedScheme[] + readiness + optional finance/
 * LokScore inputs. No LLM. No new eligibility/ranking/LokScore formula.
 *
 * Flow:
 *   DeterministicAnalysis
 *        ↓
 *   PersonalizedReport (report.ts)
 *        ↓
 *   guarded explanation (explanationProvider.ts)
 *        ↓
 *   UI (Prerna — out of scope)
 */

import { buildSchemePlan } from '../../lib/finance'
import type { LokScoreBreakdown } from '../../lib/lokScore'
import type { ActionPlanStep } from '../orchestrator'
import type { SourceCoverageAccounting } from '../evidence/types'
import type {
  ContextualEvidenceItem,
  EligibilityStatus,
  RankedScheme,
  RetrievalSourceStatus,
  UserProfile,
  VerificationStatus,
} from '../types'
import type {
  ApplicantProfile,
  ApplicantProfileFieldKey,
  FieldProvenance,
} from '../../shared/applicantProfile'
import type { ReadinessAssessment } from './readiness'
import {
  mapProvenanceSourceToCategory,
  type ApplicationReadinessAssessment,
  type ApplicationReadinessDimension,
  type BusinessSnapshot,
  type BusinessSuitabilityAssessment,
  type CitizenSnapshotFact,
  type ComparativeOption,
  type DocumentReadinessItem,
  type ExecutiveSummary,
  type FinancialPath,
  type OpportunityAssessment,
  type OpportunityDimension,
  type ReportSchemeEntry,
  type SchemeMatchRecommendation,
  type SourceCoverageReport,
  type UncertaintyItem,
} from './reportModel'

export interface DeterministicAnalysis {
  generatedAt: string
  maturity: ReadinessAssessment['status']
  executiveSummary: ExecutiveSummary
  citizenSnapshot: Partial<Record<ApplicantProfileFieldKey, CitizenSnapshotFact>>
  businessSnapshot: BusinessSnapshot
  opportunityAssessment: OpportunityAssessment
  schemeAnalyses: ReportSchemeEntry[]
  comparativeView: ComparativeOption[]
  governmentContextualEvidence: ContextualEvidenceItem[]
  financialPath: FinancialPath
  documentReadiness: DocumentReadinessItem[]
  applicationReadiness: ApplicationReadinessAssessment
  actionPlan: ActionPlanStep[]
  uncertainties: UncertaintyItem[]
  sourceCoverage: SourceCoverageReport
  verification: { checkedAt: string | null; sourceStatus: RetrievalSourceStatus['status'] | null }
  readiness: ReadinessAssessment
  /** Ranking order is authoritative — schemeAnalyses preserve RankedScheme order. */
  rankingAuthoritative: true
}

export interface BuildDeterministicAnalysisInput {
  applicantProfile: ApplicantProfile
  userProfile: UserProfile
  ranked: RankedScheme[]
  actionPlan: ActionPlanStep[]
  readiness: ReadinessAssessment
  sourceStatus: RetrievalSourceStatus | null
  /** Optional — only when an existing computeLokScore() result is supplied by a caller. Never computed here. */
  lokScore?: LokScoreBreakdown
  /** Fields the citizen explicitly said they don't know yet (finance uncertainty). */
  userUncertainFields?: Array<keyof UserProfile>
  /** Government evidence retrieved this turn that could not be tied to a specific scheme (Prompt 8) — see orchestrator.ts's attemptLiveRetrieval. */
  contextualEvidence?: ContextualEvidenceItem[]
  /** Honest source/record coverage accounting for this turn's live retrieval attempt, when it was attempted. */
  evidenceCoverage?: SourceCoverageAccounting | null
  now?: string
}

function buildCitizenSnapshot(applicantProfile: ApplicantProfile): Partial<Record<ApplicantProfileFieldKey, CitizenSnapshotFact>> {
  const snapshot: Partial<Record<ApplicantProfileFieldKey, CitizenSnapshotFact>> = {}
  for (const [field, provenance] of Object.entries(applicantProfile.fieldProvenance) as Array<
    [ApplicantProfileFieldKey, FieldProvenance]
  >) {
    const value = applicantProfile.data[field]
    if (value === undefined) continue
    snapshot[field] = {
      value,
      source: provenance.source,
      confidence: provenance.confidence,
      capturedAt: provenance.capturedAt,
      category: mapProvenanceSourceToCategory(provenance.source),
    }
  }
  return snapshot
}

function expansionOrNew(stage?: string, status?: string): BusinessSnapshot['expansionOrNew'] {
  if (stage === 'existing_expansion' || status === 'existing') return 'expansion'
  if (stage === 'idea' || stage === 'new' || status === 'idea') return 'new'
  return 'unknown'
}

function buildBusinessSnapshot(applicantProfile: ApplicantProfile, userUncertainFields: Array<keyof UserProfile>): BusinessSnapshot {
  const d = applicantProfile.data
  const financingUncertain = userUncertainFields.includes('financingRequired')
  return {
    businessIdea: d.businessDescription,
    sector: d.businessSector,
    businessStage: d.businessStage,
    businessStatus: d.businessStatus,
    intendedScale: d.businessExperienceYears !== undefined ? `experience_years:${d.businessExperienceYears}` : undefined,
    expansionOrNew: expansionOrNew(d.businessStage, d.businessStatus),
    locationContext: {
      state: d.state,
      district: d.district,
      villageOrTown: d.villageOrTown,
      areaType: d.areaType,
    },
    intendedInvestment:
      d.investmentRequired !== undefined
        ? { amountRupees: d.investmentRequired, status: 'known' }
        : { status: 'unknown' },
    financingRequirement: financingUncertain
      ? { status: 'user_uncertain' }
      : d.financingRequired !== undefined
        ? { amountRupees: d.financingRequired, status: 'known' }
        : { status: 'unknown' },
    statedObjective: d.businessDescription,
  }
}

function recommendationFromEligibility(status: EligibilityStatus): SchemeMatchRecommendation {
  switch (status) {
    case 'likely_eligible':
      return 'strong_match'
    case 'possibly_eligible':
      return 'possible_match'
    case 'insufficient_data':
      return 'insufficient_information'
    case 'likely_ineligible':
      return 'mismatch'
  }
}

function verificationFor(ranked: RankedScheme): VerificationStatus {
  if (ranked.liveEvidence && ranked.liveEvidence.some((e) => e.verificationStatus === 'live_official')) {
    return 'live_official'
  }
  return 'verified_local'
}

function benefitTypeFor(ranked: RankedScheme): string | undefined {
  const parts: string[] = []
  if (ranked.scheme.loanAmount) parts.push('loan')
  if (ranked.scheme.subsidy) parts.push('subsidy')
  if (ranked.scheme.interest) parts.push('interest_support')
  return parts.length > 0 ? parts.join('+') : undefined
}

/**
 * Deterministic match explanation personalized by applicant context.
 * Same scheme + different applicant facts → different text.
 */
export function buildMatchExplanation(ranked: RankedScheme, userProfile: UserProfile): string {
  const name = ranked.scheme.name
  const status = ranked.eligibility.status
  const parts: string[] = []

  if (userProfile.state) {
    parts.push(`Your stated location is ${userProfile.state}`)
  }
  if (userProfile.businessSector) {
    const stageHint =
      userProfile.businessStage === 'existing_expansion' || userProfile.businessStatus === 'existing'
        ? 'existing/expansion'
        : userProfile.businessStage === 'idea' || userProfile.businessStage === 'new'
          ? 'first-time/new'
          : 'stated'
    parts.push(`your ${stageHint} business intent is ${userProfile.businessSector}`)
  }
  if (userProfile.landOrAssets) {
    parts.push(`you mentioned resources/assets: ${userProfile.landOrAssets}`)
  }

  const context = parts.length > 0 ? parts.join(' and ') + '. ' : ''

  if (status === 'likely_eligible' || status === 'possibly_eligible') {
    const reason = ranked.eligibility.reasons[0]
    return `${context}${name} appears relevant based on retrieved scheme criteria.${reason ? ` ${reason}` : ''} Official verification still applies.`
  }
  if (status === 'likely_ineligible') {
    const concern = ranked.eligibility.mismatchReasons[0]
    return `${context}${name} does not currently look like a fit.${concern ? ` ${concern}` : ''} Official verification still applies.`
  }
  const missing = ranked.eligibility.missingInfo[0]
  return `${context}${name} cannot be fully evaluated yet.${missing ? ` Missing: ${missing}.` : ''} No eligibility conclusion has been made.`
}

function buildSchemeAnalyses(ranked: RankedScheme[], userProfile: UserProfile): ReportSchemeEntry[] {
  return ranked.map((r) => ({
    schemeId: r.scheme.id,
    schemeName: r.scheme.name,
    source: r.scheme.source,
    verificationStatus: verificationFor(r),
    lastVerifiedDate: r.scheme.lastVerifiedDate,
    eligibilityStatus: r.eligibility.status,
    eligibilityConfidence: r.eligibility.confidence,
    recommendation: recommendationFromEligibility(r.eligibility.status),
    matchExplanation: buildMatchExplanation(r, userProfile),
    matchReasons: r.eligibility.reasons,
    concernReasons: r.eligibility.mismatchReasons,
    missingRequirements: r.eligibility.missingInfo,
    benefitType: benefitTypeFor(r),
    loanAmount: r.scheme.loanAmount,
    subsidyDescription: r.scheme.subsidy?.description,
    documents: r.scheme.documents,
    applicationSteps: r.scheme.applicationSteps,
    applicationRoute: r.scheme.officialApplicationUrl,
    officialInfoUrl: r.scheme.officialInfoUrl,
    officialApplicationUrl: r.scheme.officialApplicationUrl,
    liveEvidence: r.liveEvidence ?? [],
    rankScore: r.rankScore,
  }))
}

function buildComparativeView(schemeAnalyses: ReportSchemeEntry[]): ComparativeOption[] {
  return schemeAnalyses.map((s) => ({
    schemeId: s.schemeId,
    schemeName: s.schemeName,
    fit: s.recommendation,
    benefitType: s.benefitType,
    financingRequirementNotes: s.loanAmount?.notes,
    missingRequirements: s.missingRequirements,
    documents: s.documents,
    applicationComplexity:
      s.applicationSteps.length === 0 ? 'unknown' : s.applicationSteps.length <= 3 ? 'few_steps' : 'many_steps',
    verificationStatus: s.verificationStatus,
    rankScore: s.rankScore,
  }))
}

function buildFinancialPath(
  applicantProfile: ApplicantProfile,
  userUncertainFields: Array<keyof UserProfile>,
): FinancialPath {
  const d = applicantProfile.data
  const notes: string[] = []
  const financingUncertain = userUncertainFields.includes('financingRequired')

  if (financingUncertain) {
    notes.push('Financing amount is not yet determined — the citizen indicated uncertainty rather than a figure.')
  }
  if (d.financingRequired === undefined && d.investmentRequired === undefined && !financingUncertain) {
    notes.push('No investment or financing amount has been provided yet.')
  }

  let nsfdcPlan: FinancialPath['nsfdcPlan']
  if (d.ownContribution !== undefined && d.ownContribution > 0) {
    // Reuse the EXISTING NSFDC finance engine — do not reimplement EMI math.
    const plan = buildSchemePlan(d.ownContribution)
    nsfdcPlan = {
      schemeId: plan.schemeId,
      schemeName: plan.schemeName,
      projectCost: plan.projectCost,
      loanAmount: plan.loanAmount,
      marginRequired: plan.marginRequired,
      interestRate: plan.interestRate,
      tenureYears: plan.tenureYears,
      quarterlyEmi: plan.quarterlyEmi,
      computedBy: 'src/lib/finance.ts#buildSchemePlan',
    }
    notes.push(`NSFDC plan figures referenced from buildSchemePlan(ownContribution=${d.ownContribution}).`)
  } else {
    notes.push('Exact NSFDC EMI/interest figures are unavailable until own contribution (margin money) is known.')
  }

  const hasAny =
    d.investmentRequired !== undefined || d.financingRequired !== undefined || d.ownContribution !== undefined
  const status: FinancialPath['status'] = financingUncertain
    ? 'not_determined'
    : nsfdcPlan && (d.financingRequired !== undefined || d.investmentRequired !== undefined)
      ? 'determined'
      : hasAny
        ? 'partial'
        : 'not_determined'

  return {
    status,
    statedInvestmentRequired: d.investmentRequired,
    statedFinancingRequired: d.financingRequired,
    statedOwnContribution: d.ownContribution,
    nsfdcPlan,
    notes,
  }
}

function buildDocumentReadiness(ranked: RankedScheme[]): DocumentReadinessItem[] {
  const items: DocumentReadinessItem[] = []
  const seen = new Set<string>()
  for (const r of ranked.slice(0, 3)) {
    if (r.eligibility.status !== 'likely_eligible' && r.eligibility.status !== 'possibly_eligible') continue
    for (const doc of r.scheme.documents) {
      const key = `${r.scheme.id}::${doc}`
      if (seen.has(key)) continue
      seen.add(key)
      items.push({
        documentName: doc,
        schemeId: r.scheme.id,
        schemeName: r.scheme.name,
        required: true,
        knownToExist: false,
        verificationState: 'required',
        source: 'scheme_requirement',
      })
    }
  }
  return items
}

function buildApplicationReadiness(
  readiness: ReadinessAssessment,
  ranked: RankedScheme[],
  documentReadiness: DocumentReadinessItem[],
  financialPath: FinancialPath,
  userProfile: UserProfile,
): ApplicationReadinessAssessment {
  const top = ranked[0]
  const topPromising =
    top && (top.eligibility.status === 'likely_eligible' || top.eligibility.status === 'possibly_eligible')
  const eligibilityComplete =
    Boolean(top) && top.eligibility.status === 'likely_eligible' && top.eligibility.confidence === 'high' && readiness.materialGapsRemaining.length === 0

  const dimensions: ApplicationReadinessDimension[] = [
    {
      id: 'profile_completeness',
      met: readiness.materialGapsRemaining.length === 0 && Boolean(userProfile.businessSector || userProfile.proposedBusiness),
      detail:
        readiness.materialGapsRemaining.length === 0
          ? 'No high-materiality profile gaps remain.'
          : `High-materiality gaps remain: ${readiness.materialGapsRemaining.join(', ')}.`,
    },
    {
      id: 'scheme_selected',
      met: topPromising,
      detail: topPromising ? `Top ranked scheme is ${top.scheme.name}.` : 'No promising top scheme yet.',
    },
    {
      id: 'eligibility_evidence_complete',
      met: eligibilityComplete,
      detail: eligibilityComplete
        ? 'Top scheme is likely eligible at high confidence with no material gaps.'
        : 'Eligibility evidence is not yet complete for application preparation.',
    },
    {
      id: 'required_documents_known',
      met: documentReadiness.length > 0,
      detail: documentReadiness.length > 0 ? `${documentReadiness.length} required document(s) listed from scheme data.` : 'Required documents not yet known from ranked schemes.',
    },
    {
      id: 'required_documents_verified',
      met: false,
      detail: 'Document verification is not performed in this workstream — none marked verified.',
    },
    {
      id: 'financing_information_complete',
      met: financialPath.status === 'determined',
      detail:
        financialPath.status === 'determined'
          ? 'Financing path figures are available from stated amounts + finance engine.'
          : 'Financing plan is not yet fully determined.',
    },
    {
      id: 'consent_readiness',
      met: false,
      detail: 'Consent/readiness for submission is owned by a later application workstream (Adita).',
    },
    {
      id: 'official_application_path_available',
      met: Boolean(top?.scheme.officialApplicationUrl),
      detail: top?.scheme.officialApplicationUrl
        ? `Official application URL present for ${top.scheme.name}.`
        : 'No official application path available on the top scheme yet.',
    },
  ]

  let status: ApplicationReadinessAssessment['status']
  if (readiness.status === 'exploratory' || !topPromising) status = 'not_ready'
  else if (readiness.status === 'application_ready' && eligibilityComplete) status = 'ready_for_application'
  else if (readiness.status === 'actionable' || readiness.status === 'application_ready') status = 'ready_for_review'
  else status = 'gathering_information'

  return { status, dimensions, applicationSubmitted: false }
}

function buildOpportunityDimensions(
  ranked: RankedScheme[],
  readiness: ReadinessAssessment,
  financialPath: FinancialPath,
  userProfile: UserProfile,
): OpportunityDimension[] {
  const top = ranked[0]
  const promising = ranked.filter(
    (r) => r.eligibility.status === 'likely_eligible' || r.eligibility.status === 'possibly_eligible',
  )

  const eligibilityFit: OpportunityDimension = {
    id: 'eligibility_fit',
    status: !top
      ? 'insufficient_information'
      : top.eligibility.status === 'likely_eligible'
        ? 'strong'
        : top.eligibility.status === 'possibly_eligible'
          ? 'moderate'
          : top.eligibility.status === 'likely_ineligible'
            ? 'weak'
            : 'insufficient_information',
    supportingEvidence: top ? top.eligibility.reasons.slice(0, 3) : [],
    uncertainties: top?.eligibility.status === 'insufficient_data' ? ['Top scheme lacks enough applicant facts for a firm eligibility call.'] : [],
    missingInformation: top?.eligibility.missingInfo ?? readiness.materialGapsRemaining.map(String),
  }

  const financingFit: OpportunityDimension = {
    id: 'financing_fit',
    status:
      financialPath.status === 'determined'
        ? 'strong'
        : financialPath.status === 'partial'
          ? 'moderate'
          : 'insufficient_information',
    supportingEvidence: financialPath.nsfdcPlan
      ? [`Referenced NSFDC plan loanAmount=${financialPath.nsfdcPlan.loanAmount}`]
      : financialPath.statedFinancingRequired !== undefined
        ? [`Stated financingRequired=${financialPath.statedFinancingRequired}`]
        : [],
    uncertainties: financialPath.status !== 'determined' ? ['Financing plan not fully determined.'] : [],
    missingInformation: financialPath.statedOwnContribution === undefined ? ['ownContribution'] : [],
  }

  const localFit: OpportunityDimension = {
    id: 'local_context_fit',
    status: userProfile.state ? 'moderate' : 'insufficient_information',
    supportingEvidence: userProfile.state
      ? [`Applicant stated state=${userProfile.state}${userProfile.areaType ? `, areaType=${userProfile.areaType}` : ''}.`]
      : [],
    uncertainties: userProfile.state ? [] : ['Location not provided — local/context fit cannot be assessed.'],
    missingInformation: userProfile.state ? [] : ['state'],
  }

  const stageFit: OpportunityDimension = {
    id: 'business_stage_fit',
    status: userProfile.businessStage || userProfile.businessStatus ? 'moderate' : 'insufficient_information',
    supportingEvidence: [
      userProfile.businessStage ? `businessStage=${userProfile.businessStage}` : '',
      userProfile.businessStatus ? `businessStatus=${userProfile.businessStatus}` : '',
      userProfile.landOrAssets ? `stated assets/resources=${userProfile.landOrAssets}` : '',
    ].filter(Boolean),
    uncertainties: !(userProfile.businessStage || userProfile.businessStatus)
      ? ['Business stage unknown.']
      : [],
    missingInformation: !(userProfile.businessStage || userProfile.businessStatus) ? ['businessStage'] : [],
  }

  const readinessDim: OpportunityDimension = {
    id: 'readiness',
    status:
      readiness.status === 'application_ready'
        ? 'strong'
        : readiness.status === 'actionable'
          ? 'moderate'
          : readiness.status === 'preliminary'
            ? 'weak'
            : 'insufficient_information',
    supportingEvidence: readiness.rationale,
    uncertainties: [],
    missingInformation: readiness.materialGapsRemaining.map(String),
  }

  const completeness: OpportunityDimension = {
    id: 'information_completeness',
    status:
      readiness.materialGapsRemaining.length === 0
        ? 'strong'
        : readiness.materialGapsRemaining.length === 1
          ? 'moderate'
          : 'weak',
    supportingEvidence: [`High-materiality gaps remaining: ${readiness.materialGapsRemaining.length}.`],
    uncertainties: [],
    missingInformation: readiness.materialGapsRemaining.map(String),
  }

  const appFeasibility: OpportunityDimension = {
    id: 'application_feasibility',
    status: promising.length > 0 && top?.scheme.officialApplicationUrl ? 'moderate' : 'insufficient_information',
    supportingEvidence: promising.length > 0 ? [`${promising.length} promising scheme(s); official paths from scheme data only.`] : [],
    uncertainties: ['Application submission is a later workstream — feasibility here means path known, not submitted.'],
    missingInformation: [],
  }

  return [eligibilityFit, financingFit, localFit, stageFit, readinessDim, completeness, appFeasibility]
}

function buildBusinessSuitability(
  businessSnapshot: BusinessSnapshot,
  financialPath: FinancialPath,
  ranked: RankedScheme[],
  readiness: ReadinessAssessment,
): BusinessSuitabilityAssessment {
  const base = {
    claimsProfitability: false as const,
    claimsGuaranteedDemand: false as const,
    claimsGuaranteedApproval: false as const,
    claimsGuaranteedSubsidy: false as const,
  }

  const topMismatch = ranked[0]?.eligibility.status === 'likely_ineligible'
  if (topMismatch) {
    return {
      ...base,
      kind: 'significant_unresolved_constraint',
      rationale: `Top ranked scheme is likely ineligible based on stated facts (${ranked[0].eligibility.mismatchReasons[0] ?? 'see mismatch reasons'}).`,
    }
  }

  if (readiness.status === 'exploratory' || !businessSnapshot.sector) {
    return {
      ...base,
      kind: 'information_insufficient',
      rationale: 'Business sector/intent is not yet clear enough for a suitability conclusion.',
    }
  }

  if (financialPath.status === 'determined') {
    return {
      ...base,
      kind: 'financing_appears_aligned',
      rationale: 'Stated margin/financing inputs produced a concrete NSFDC plan via the existing finance engine — not a claim about business profit.',
    }
  }

  if (businessSnapshot.expansionOrNew === 'expansion' && businessSnapshot.sector) {
    return {
      ...base,
      kind: 'promising_based_on_stated_resources',
      rationale: `Citizen describes an existing ${businessSnapshot.sector} operation seeking expansion. Suitability is based on stated resources/stage only — no demand or profit forecast.`,
    }
  }

  return {
    ...base,
    kind: 'requires_additional_validation',
    rationale: 'Early business intent is captured, but more eligibility/finance validation is needed before treating the plan as application-ready.',
  }
}

function buildExecutiveSummary(
  applicantProfile: ApplicantProfile,
  businessSnapshot: BusinessSnapshot,
  readiness: ReadinessAssessment,
  financialPath: FinancialPath,
  uncertainties: UncertaintyItem[],
): ExecutiveSummary {
  const d = applicantProfile.data
  const strengths: string[] = []
  const blockers: string[] = []

  if (d.state) strengths.push(`Location stated: ${d.state}`)
  if (d.socialCategory) strengths.push(`Social category stated: ${d.socialCategory.toUpperCase()}`)
  if (businessSnapshot.expansionOrNew === 'expansion') strengths.push('Existing business / expansion intent')
  if (d.landOrAssets) strengths.push(`Stated resources: ${d.landOrAssets}`)
  if (d.ownContribution !== undefined) strengths.push('Own contribution (margin) stated')

  for (const g of readiness.materialGapsRemaining) blockers.push(`Missing high-impact field: ${String(g)}`)
  if (financialPath.status === 'not_determined') blockers.push('Financing plan not yet determined')
  for (const u of uncertainties.slice(0, 3)) {
    if (u.kind === 'missing_information' || u.kind === 'eligibility_ambiguity' || u.kind === 'finance_uncertainty') {
      blockers.push(u.message)
    }
  }

  const financingIntention =
    financialPath.status === 'not_determined' || businessSnapshot.financingRequirement?.status === 'user_uncertain'
      ? 'undetermined'
      : d.financingRequired !== undefined
        ? `stated financing about ₹${d.financingRequired.toLocaleString('en-IN')}`
        : d.investmentRequired !== undefined
          ? `stated investment about ₹${d.investmentRequired.toLocaleString('en-IN')}`
          : 'undetermined'

  return {
    whatCitizenWants: d.businessDescription ?? (d.businessSector ? `${d.businessSector} business` : undefined),
    where: [d.villageOrTown, d.district, d.state].filter(Boolean).join(', ') || undefined,
    businessStage: d.businessStage ?? d.businessStatus,
    financingIntention,
    keyStrengths: strengths,
    majorBlockers: Array.from(new Set(blockers)),
    overallReadiness: readiness.status,
  }
}

function buildUncertainties(
  applicantProfile: ApplicantProfile,
  ranked: RankedScheme[],
  readiness: ReadinessAssessment,
  sourceStatus: RetrievalSourceStatus | null,
  financialPath: FinancialPath,
  userUncertainFields: Array<keyof UserProfile>,
): UncertaintyItem[] {
  const items: UncertaintyItem[] = []
  const d = applicantProfile.data

  for (const field of readiness.materialGapsRemaining) {
    items.push({
      kind: 'missing_information',
      message: `${String(field)} has not been provided, so related eligibility checks may be incomplete.`,
      relatedFields: [field as ApplicantProfileFieldKey],
    })
  }

  if (d.annualIncome === undefined) {
    items.push({
      kind: 'missing_information',
      message: 'Income information has not been provided, so income-based eligibility could not be fully evaluated.',
      relatedFields: ['annualIncome'],
    })
  }

  if (userUncertainFields.includes('financingRequired') || financialPath.status === 'not_determined') {
    items.push({
      kind: 'finance_uncertainty',
      message: 'Financing amount is uncertain or undetermined — no loan figure has been invented.',
      relatedFields: ['financingRequired'],
    })
  }

  if (sourceStatus?.status === 'live_unavailable') {
    items.push({
      kind: 'source_unavailable',
      message: 'Live official-source retrieval was unavailable for this analysis; local curated evidence was used instead.',
    })
  }

  for (const r of ranked.slice(0, 5)) {
    if (r.eligibility.status === 'insufficient_data') {
      items.push({
        kind: 'eligibility_ambiguity',
        message: `${r.scheme.name} could not be fully evaluated due to missing applicant facts.`,
        relatedSchemeIds: [r.scheme.id],
      })
    }
  }

  items.push({
    kind: 'application_integration_unavailable',
    message: 'Official application submission/integration is not part of this analysis workstream.',
  })

  // De-dupe by message
  const seen = new Set<string>()
  return items.filter((i) => {
    if (seen.has(i.message)) return false
    seen.add(i.message)
    return true
  })
}

function buildSourceCoverage(
  ranked: RankedScheme[],
  sourceStatus: RetrievalSourceStatus | null,
  contextualEvidence: ContextualEvidenceItem[],
  evidenceCoverage: SourceCoverageAccounting | null | undefined,
): SourceCoverageReport {
  const verifiedLocalCount = ranked.filter((r) => !r.liveEvidence || r.liveEvidence.length === 0).length
  const liveOfficialCount = ranked.filter((r) => r.liveEvidence && r.liveEvidence.length > 0).length
  const eligibleOrPossibleCount = ranked.filter(
    (r) => r.eligibility.status === 'likely_eligible' || r.eligibility.status === 'possibly_eligible',
  ).length

  const sourcesQueried = ['local:data/schemes.ts']
  const sourcesSuccessfullyRetrieved = ['local:data/schemes.ts']
  const sourcesUnavailable: string[] = []
  const verificationTimestamps: string[] = []

  if (sourceStatus) {
    sourcesQueried.push('live:official_retrieval')
    verificationTimestamps.push(sourceStatus.checkedAt)
    if (sourceStatus.status === 'live_official') {
      sourcesSuccessfullyRetrieved.push('live:official_retrieval')
    } else if (sourceStatus.status === 'live_unavailable') {
      sourcesUnavailable.push('live:official_retrieval')
    }
  }

  for (const r of ranked) {
    for (const live of r.liveEvidence ?? []) {
      if (!sourcesSuccessfullyRetrieved.includes(live.sourceUrl)) {
        sourcesSuccessfullyRetrieved.push(live.sourceUrl)
      }
      verificationTimestamps.push(live.retrievedAt)
    }
  }
  for (const ctx of contextualEvidence) {
    verificationTimestamps.push(ctx.retrievedAt)
  }

  return {
    sourcesQueried,
    sourcesSuccessfullyRetrieved,
    sourcesUnavailable,
    candidateSchemeCount: ranked.length,
    eligibleOrPossibleCount,
    verifiedLocalCount,
    liveOfficialCount,
    totalSchemesConsidered: ranked.length,
    verificationTimestamps: Array.from(new Set(verificationTimestamps)),
    claimsAllGovernmentSchemesChecked: false,
    contextualEvidenceCount: contextualEvidence.length,
    recordsRetrieved: evidenceCoverage?.recordsRetrieved ?? 0,
    recordsRejected: evidenceCoverage?.recordsRejected ?? 0,
    recordsDeduplicated: evidenceCoverage?.recordsDeduplicated ?? 0,
    sourcesFailedCount: evidenceCoverage?.sourcesFailed ?? 0,
    sourcesNotConfiguredCount: evidenceCoverage?.sourcesNotConfigured ?? 0,
    centralSourcesQueried: evidenceCoverage?.centralSourcesQueried ?? 0,
    stateSourcesQueried: evidenceCoverage?.stateSourcesQueried ?? 0,
  }
}

export function buildDeterministicAnalysis(input: BuildDeterministicAnalysisInput): DeterministicAnalysis {
  const {
    applicantProfile,
    userProfile,
    ranked,
    actionPlan,
    readiness,
    sourceStatus,
    lokScore,
    now,
  } = input
  const userUncertainFields = input.userUncertainFields ?? []
  const contextualEvidence = input.contextualEvidence ?? []
  const generatedAt = now ?? new Date().toISOString()

  const citizenSnapshot = buildCitizenSnapshot(applicantProfile)
  const businessSnapshot = buildBusinessSnapshot(applicantProfile, userUncertainFields)
  const schemeAnalyses = buildSchemeAnalyses(ranked, userProfile)
  const comparativeView = buildComparativeView(schemeAnalyses)
  const financialPath = buildFinancialPath(applicantProfile, userUncertainFields)
  const documentReadiness = buildDocumentReadiness(ranked)
  const applicationReadiness = buildApplicationReadiness(
    readiness,
    ranked,
    documentReadiness,
    financialPath,
    userProfile,
  )
  const uncertainties = buildUncertainties(
    applicantProfile,
    ranked,
    readiness,
    sourceStatus,
    financialPath,
    userUncertainFields,
  )
  const dimensions = buildOpportunityDimensions(ranked, readiness, financialPath, userProfile)
  const businessSuitability = buildBusinessSuitability(businessSnapshot, financialPath, ranked, readiness)
  const executiveSummary = buildExecutiveSummary(
    applicantProfile,
    businessSnapshot,
    readiness,
    financialPath,
    uncertainties,
  )
  const sourceCoverage = buildSourceCoverage(ranked, sourceStatus, contextualEvidence, input.evidenceCoverage)

  return {
    generatedAt,
    maturity: readiness.status,
    executiveSummary,
    citizenSnapshot,
    businessSnapshot,
    opportunityAssessment: {
      dimensions,
      businessSuitability,
      lokScore,
      // narrative intentionally omitted — explanation seam only
    },
    schemeAnalyses,
    comparativeView,
    governmentContextualEvidence: contextualEvidence,
    financialPath,
    documentReadiness,
    applicationReadiness,
    actionPlan,
    uncertainties,
    sourceCoverage,
    verification: { checkedAt: sourceStatus?.checkedAt ?? null, sourceStatus: sourceStatus?.status ?? null },
    readiness,
    rankingAuthoritative: true,
  }
}
