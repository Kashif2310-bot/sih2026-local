export type {
  AskedQuestionRecord,
  AskedQuestionStatus,
  ConversationPhase,
  ConversationState,
  ConversationTurnRecord,
} from './types'
export { createInitialConversationState } from './types'

export { determinePhase } from './phase'
export type { DeterminePhaseInput } from './phase'

export { assessReadiness } from './readiness'
export type { AssessReadinessInput, ReadinessAssessment, RecommendationReadiness } from './readiness'

export {
  FIELD_MATERIALITY,
  isUncertaintyResponse,
  reconcilePendingQuestion,
  selectNextQuestion,
} from './questionPolicy'
export type {
  NextQuestionDecision,
  QuestionCategory,
  QuestionDetails,
  QuestionMateriality,
  QuestionRequirement,
  SelectNextQuestionInput,
} from './questionPolicy'

export {
  checkEvidenceInvalidation,
  DECISION_CRITICAL_FIELDS,
  detectFinancingIntentSignal,
  snapshotDecisionCriticalFields,
} from './evidenceInvalidation'
export type { EvidenceInvalidationResult, FinancingIntentSignal } from './evidenceInvalidation'

export { mergeExtractedFactsIntoApplicantProfile } from './applicantProfileBridge'

export { buildPersonalizedReport } from './report'
export type {
  BuildPersonalizedReportInput,
  CitizenSnapshotFact,
  PersonalizedReport,
  ReportSchemeEntry,
  ApplicationReadinessAssessment,
  BusinessSnapshot,
  ComparativeOption,
  DocumentReadinessItem,
  ExecutiveSummary,
  FinancialPath,
  GuardedExplanation,
  OpportunityAssessment,
  SourceCoverageReport,
  UncertaintyItem,
} from './report'

export { buildDeterministicAnalysis, buildMatchExplanation } from './deterministicAnalysis'
export type { BuildDeterministicAnalysisInput, DeterministicAnalysis } from './deterministicAnalysis'

export {
  attachGuardedExplanation,
  composeOfflineReportExplanation,
  offlineReportExplanationProvider,
  OfflineReportExplanationProvider,
} from './explanationProvider'
export type { AttachExplanationResult, ReportExplanationProvider, ReportExplanationRequest } from './explanationProvider'

export { deepFreeze, freezeReportSnapshot } from './reportSnapshot'

export type {
  ApplicationReadinessStatus,
  BusinessSuitabilityAssessment,
  ExplanationLanguage,
  ReportFactCategory,
  ReportMaturity,
  SchemeMatchRecommendation,
} from './reportModel'

export { VoiceAssistantController } from './voiceAssistantController'
export type { ConversationEvent, VoiceAssistantControllerDeps, VoiceAssistantTurnResult } from './voiceAssistantController'

export { VoiceConversationRuntime } from './voiceConversationRuntime'
export type {
  AssistantAudioState,
  ConversationTurnHandler,
  RuntimeError,
  RuntimeErrorSource,
  RuntimeEvent,
  VoiceConversationRuntimeDeps,
} from './voiceConversationRuntime'
