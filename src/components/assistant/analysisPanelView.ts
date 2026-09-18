/**
 * Pure, UI-language-neutral projection of the EXISTING PersonalizedReport
 * onto the compact sections AnalysisPanel actually renders. Never a second
 * analysis model: every field is copied from the report, never recomputed.
 *
 * Kept free of React so it can be unit-tested in this repo's Node vitest
 * environment (see vitest.config.ts).
 */
import type { ApplicantProfileFieldKey } from '../../shared/applicantProfile'
import type {
  ApplicationReadinessStatus,
  BusinessSuitabilityKind,
  ComparativeOption,
  DocumentReadinessItem,
  FinancialPathStatus,
  OpportunityDimension,
  PersonalizedReport,
  ReferencedNsfdcPlan,
  ReportMaturity,
  UncertaintyItem,
} from '../../assistant/conversation/reportModel'

const SNAPSHOT_FIELD_ORDER: ApplicantProfileFieldKey[] = [
  'name',
  'age',
  'gender',
  'socialCategory',
  'areaType',
  'state',
  'district',
  'villageOrTown',
  'businessSector',
  'businessDescription',
  'businessStage',
  'businessStatus',
  'annualIncome',
  'investmentRequired',
  'ownContribution',
  'financingRequired',
  'education',
  'landOrAssets',
  'existingLoans',
  'phone',
  'businessExperienceYears',
]

const MONEY_FIELDS = new Set<ApplicantProfileFieldKey>([
  'annualIncome',
  'investmentRequired',
  'ownContribution',
  'financingRequired',
])

export interface AnalysisSnapshotEntry {
  field: ApplicantProfileFieldKey
  value: string
  source: string
}

export interface AnalysisBusinessSummary {
  idea?: string
  sector?: string
  stage?: string
  status?: string
  location?: string
}

export interface AnalysisOpportunityView {
  suitabilityKind: BusinessSuitabilityKind
  rationale: string
  dimensions: Array<Pick<OpportunityDimension, 'id' | 'status'>>
}

export interface AnalysisFinancialView {
  status: FinancialPathStatus
  statedInvestmentRequired?: number
  statedFinancingRequired?: number
  statedOwnContribution?: number
  notes: string[]
  /** Present only when the report already referenced src/lib/finance.ts — never invented here. */
  nsfdcPlan?: ReferencedNsfdcPlan
}

export interface AnalysisApplicationReadinessView {
  status: ApplicationReadinessStatus
  unmet: Array<{ id: string; detail: string }>
  metCount: number
  totalCount: number
}

export interface AnalysisPanelView {
  readiness: ReportMaturity
  financingIntention: string
  strengths: string[]
  blockers: string[]
  snapshot: AnalysisSnapshotEntry[]
  business: AnalysisBusinessSummary | null
  opportunity: AnalysisOpportunityView | null
  financial: AnalysisFinancialView
  documents: DocumentReadinessItem[]
  applicationReadiness: AnalysisApplicationReadinessView
  /** Other schemes besides the already-shown top match — same comparativeView, just not duplicated. */
  comparative: Array<Pick<ComparativeOption, 'schemeId' | 'schemeName' | 'fit'>>
  uncertainties: UncertaintyItem[]
  /** Count only — the full list already lives in ActionPlanPanel. */
  nextStepCount: number
}

const FINANCING_INTENTION_ENUM = new Set(['undetermined', 'financingRequired', 'investmentRequired'])

/** Map raw enum tokens to i18n keys; leave already-written sentences unchanged. */
export function financingIntentionI18nKey(value: string): string | null {
  if (FINANCING_INTENTION_ENUM.has(value)) {
    return `assistant.analysis.financingIntentionValue.${value}`
  }
  return null
}

function formatSnapshotValue(field: ApplicantProfileFieldKey, value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null
  if (MONEY_FIELDS.has(field) && typeof value === 'number') return `₹${value.toLocaleString('en-IN')}`
  if (field === 'socialCategory' && typeof value === 'string') return value.toUpperCase()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (typeof value === 'string') return value
  return null
}

function locationLine(report: PersonalizedReport): string | undefined {
  const snapLoc = report.businessSnapshot.locationContext
  const ctxLoc = report.businessContext.location
  const parts = [
    snapLoc?.villageOrTown ?? ctxLoc?.villageOrTown,
    snapLoc?.district ?? ctxLoc?.district,
    snapLoc?.state ?? ctxLoc?.state,
    snapLoc?.areaType,
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(', ') : undefined
}

/**
 * Projects a PersonalizedReport onto the compact AnalysisPanel sections.
 * Empty/unknown buckets become empty arrays or null — the panel hides them
 * rather than inventing placeholder copy.
 */
export function buildAnalysisPanelView(report: PersonalizedReport): AnalysisPanelView {
  const snapshot: AnalysisSnapshotEntry[] = []
  for (const field of SNAPSHOT_FIELD_ORDER) {
    const fact = report.citizenSnapshot[field]
    if (!fact) continue
    const value = formatSnapshotValue(field, fact.value)
    if (!value) continue
    snapshot.push({ field, value, source: fact.source })
  }

  const business: AnalysisBusinessSummary = {
    idea: report.businessSnapshot.businessIdea ?? report.businessIdea.description,
    sector: report.businessSnapshot.sector ?? report.businessIdea.sector,
    stage: report.businessSnapshot.businessStage ?? report.businessContext.stage,
    status: report.businessSnapshot.businessStatus ?? report.businessContext.status,
    location: locationLine(report),
  }
  const hasBusiness = Boolean(business.idea || business.sector || business.stage || business.status || business.location)

  const suitability = report.opportunityAssessment.businessSuitability
  const dimensions = report.opportunityAssessment.dimensions.filter((d) => d.status !== 'unknown')
  const opportunity: AnalysisOpportunityView | null =
    suitability.rationale || dimensions.length > 0
      ? { suitabilityKind: suitability.kind, rationale: suitability.rationale, dimensions: dimensions.slice(0, 5) }
      : null

  const path = report.financialPath
  const financial: AnalysisFinancialView = {
    status: path.status,
    statedInvestmentRequired: path.statedInvestmentRequired,
    statedFinancingRequired: path.statedFinancingRequired,
    statedOwnContribution: path.statedOwnContribution,
    notes: path.notes.slice(0, 2),
    nsfdcPlan: path.nsfdcPlan,
  }

  const dims = report.applicationReadiness.dimensions
  const applicationReadiness: AnalysisApplicationReadinessView = {
    status: report.applicationReadiness.status,
    unmet: dims.filter((d) => !d.met).map((d) => ({ id: d.id, detail: d.detail })),
    metCount: dims.filter((d) => d.met).length,
    totalCount: dims.length,
  }

  const topId = report.relevantSchemes[0]?.schemeId
  const comparative = report.comparativeView
    .filter((c) => c.schemeId !== topId)
    .slice(0, 4)
    .map((c) => ({ schemeId: c.schemeId, schemeName: c.schemeName, fit: c.fit }))

  return {
    readiness: report.executiveSummary.overallReadiness,
    financingIntention: report.executiveSummary.financingIntention,
    strengths: report.executiveSummary.keyStrengths,
    blockers: report.executiveSummary.majorBlockers,
    snapshot,
    business: hasBusiness ? business : null,
    opportunity,
    financial,
    documents: report.documentReadiness.slice(0, 6),
    applicationReadiness,
    comparative,
    uncertainties: report.uncertainties.slice(0, 4),
    nextStepCount: report.recommendedNextSteps.length,
  }
}
