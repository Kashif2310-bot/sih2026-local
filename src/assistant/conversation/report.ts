/**
 * Structured personalized-report builder.
 *
 * Prompt 5 created the PersonalizedReport seam. Prompt 7 completes the
 * intelligence behind it:
 *
 *   DeterministicAnalysis (deterministicAnalysis.ts)
 *        ↓
 *   PersonalizedReport     (this file — structured, language-neutral)
 *        ↓
 *   guarded explanation    (explanationProvider.ts + responseGuard)
 *        ↓
 *   UI                     (Prerna — out of scope)
 *
 * Every fact is traceable to one of: user-provided, verified government,
 * derived analysis, uncertainty, assumption/inference, or missing.
 * Nothing invents schemes, URLs, eligibility, profits, or approvals.
 *
 * Snapshot immutability: each build returns a fresh deep-frozen object
 * with an incremented version. Later conversation changes never mutate a
 * previously emitted report in place.
 */

import type { ActionPlanStep } from '../orchestrator'
import type { RankedScheme, RetrievalSourceStatus, UserProfile } from '../types'
import type { ApplicantProfile } from '../../shared/applicantProfile'
import type { LokScoreBreakdown } from '../../lib/lokScore'
import type { ReadinessAssessment } from './readiness'
import { buildDeterministicAnalysis } from './deterministicAnalysis'
import type { PersonalizedReport } from './reportModel'
import { deepFreeze } from './reportSnapshot'

export type {
  ApplicationReadinessAssessment,
  ApplicationReadinessStatus,
  BusinessSnapshot,
  BusinessSuitabilityAssessment,
  CitizenSnapshotFact,
  ComparativeOption,
  DocumentReadinessItem,
  ExecutiveSummary,
  FinancialPath,
  GuardedExplanation,
  OpportunityAssessment,
  PersonalizedReport,
  ReportSchemeEntry,
  SourceCoverageReport,
  UncertaintyItem,
} from './reportModel'

export interface BuildPersonalizedReportInput {
  applicantProfile: ApplicantProfile
  /** Used for personalized match explanations; typically ConversationState.userProfile. */
  userProfile?: UserProfile
  ranked: RankedScheme[]
  actionPlan: ActionPlanStep[]
  readiness: ReadinessAssessment
  sourceStatus: RetrievalSourceStatus | null
  /** Optional existing LokScoreBreakdown — never computed here. */
  lokScore?: LokScoreBreakdown
  userUncertainFields?: Array<keyof UserProfile>
  now?: string
  /** Prior emitted report — used only for reportId continuity + version bump. */
  previous?: Pick<PersonalizedReport, 'reportId' | 'version'> | null
  reportId?: string
}

function newReportId(): string {
  return `report_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Builds a fresh PersonalizedReport snapshot from deterministic inputs.
 * Always returns a new frozen object — never mutates `previous`.
 */
export function buildPersonalizedReport(input: BuildPersonalizedReportInput): PersonalizedReport {
  const userProfile: UserProfile = input.userProfile ?? {
    rawNotes: input.applicantProfile.data.rawNotes ?? [],
    state: input.applicantProfile.data.state,
    district: input.applicantProfile.data.district,
    areaType: input.applicantProfile.data.areaType,
    age: input.applicantProfile.data.age,
    gender: input.applicantProfile.data.gender,
    socialCategory: input.applicantProfile.data.socialCategory,
    annualIncome: input.applicantProfile.data.annualIncome,
    businessStatus: input.applicantProfile.data.businessStatus,
    proposedBusiness: input.applicantProfile.data.businessDescription,
    businessSector: input.applicantProfile.data.businessSector,
    investmentRequired: input.applicantProfile.data.investmentRequired,
    ownContribution: input.applicantProfile.data.ownContribution,
    financingRequired: input.applicantProfile.data.financingRequired,
    existingLoans: input.applicantProfile.data.existingLoans,
    businessStage: input.applicantProfile.data.businessStage,
    education: input.applicantProfile.data.education,
    landOrAssets: input.applicantProfile.data.landOrAssets,
  }

  const analysis = buildDeterministicAnalysis({
    applicantProfile: input.applicantProfile,
    userProfile,
    ranked: input.ranked,
    actionPlan: input.actionPlan,
    readiness: input.readiness,
    sourceStatus: input.sourceStatus,
    lokScore: input.lokScore,
    userUncertainFields: input.userUncertainFields,
    now: input.now,
  })

  const data = input.applicantProfile.data
  const reportId = input.previous?.reportId ?? input.reportId ?? newReportId()
  const version = (input.previous?.version ?? 0) + 1

  const report: PersonalizedReport = {
    reportId,
    version,
    generatedAt: analysis.generatedAt,
    maturity: analysis.maturity,
    executiveSummary: analysis.executiveSummary,
    citizenSnapshot: analysis.citizenSnapshot,
    businessIdea: { description: data.businessDescription, sector: data.businessSector },
    businessContext: {
      stage: data.businessStage,
      status: data.businessStatus,
      experienceYears: data.businessExperienceYears,
      location: { state: data.state, district: data.district, villageOrTown: data.villageOrTown },
    },
    businessSnapshot: analysis.businessSnapshot,
    opportunityAssessment: analysis.opportunityAssessment,
    relevantSchemes: analysis.schemeAnalyses,
    comparativeView: analysis.comparativeView,
    financialPath: analysis.financialPath,
    documentReadiness: analysis.documentReadiness,
    documentsNeeded: analysis.documentReadiness.map((d) => d.documentName),
    applicationReadiness: analysis.applicationReadiness,
    recommendedNextSteps: analysis.actionPlan,
    risksAndUncertainties: analysis.uncertainties.map((u) => u.message),
    uncertainties: analysis.uncertainties,
    sourceCoverage: analysis.sourceCoverage,
    verification: analysis.verification,
    readiness: analysis.readiness,
  }

  return deepFreeze(report)
}
