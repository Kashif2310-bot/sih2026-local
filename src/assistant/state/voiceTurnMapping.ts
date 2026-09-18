/**
 * Pure mapping from one completed voice turn (VoiceAssistantController's
 * output, via VoiceConversationRuntime) onto the exact same fields the text
 * pipeline (AssistantContext.tsx's runTurn) already writes into — this is
 * what makes "one assistant state model" concrete rather than aspirational:
 * both input modalities produce the same shape, checked once here instead
 * of by eye at every call site. Kept dependency-free of React so it can be
 * unit-tested directly (this repo's test environment is Node, not jsdom —
 * see vitest.config.ts — so component-level rendering isn't how anything
 * here gets tested; this module is the part of the wiring that actually
 * can be, and should be).
 */
import type { ApplicantProfile } from '../../shared/applicantProfile'
import type { PersonalizedReport } from '../conversation/reportModel'
import type { VoiceAssistantTurnResult } from '../conversation/voiceAssistantController'
import type { SourceCoverageAccounting } from '../evidence/types'
import type { MissingFieldInfo } from '../missingFields'
import type { ActionPlanStep } from '../orchestrator'
import type { ContextualEvidenceItem, RankedScheme, RetrievalSourceStatus, UserProfile } from '../types'
import type { UIMessage } from './assistant-state'

export interface MappedVoiceTurn {
  profile: UserProfile
  applicantProfile: ApplicantProfile
  ranked: RankedScheme[]
  missingFields: MissingFieldInfo[]
  actionPlan: ActionPlanStep[]
  sourceStatus: RetrievalSourceStatus | null
  contextualEvidence: ContextualEvidenceItem[]
  evidenceCoverage: SourceCoverageAccounting | null
  report: PersonalizedReport
  /** Chat-bubble entries to append, in order — the citizen's own turn (if this handler can find it) followed by the assistant's reply. Never more than these two. */
  newMessages: UIMessage[]
}

export function mapVoiceTurnResult(result: VoiceAssistantTurnResult, genId: () => string, now: () => number = Date.now): MappedVoiceTurn {
  const { state, report, replyText, isFallback, usedProvider, contextualEvidence, evidenceCoverage } = result

  const turns = state.turns
  const userTurn = turns[turns.length - 2]
  const newMessages: UIMessage[] = []
  if (userTurn?.role === 'user') {
    newMessages.push({ id: genId(), role: 'user', text: userTurn.text, timestamp: now(), fromVoice: true })
  }
  newMessages.push({
    id: genId(),
    role: 'assistant',
    text: replyText,
    timestamp: now(),
    isFallback,
    providerUsed: usedProvider,
    sourceStatus: state.sourceStatus ?? undefined,
    fromVoice: true,
  })

  return {
    profile: state.userProfile,
    applicantProfile: state.applicantProfile,
    ranked: state.ranked,
    missingFields: state.missingFields,
    // report.recommendedNextSteps IS the deterministic action plan
    // (buildActionPlan's own output — see conversation/report.ts) — never
    // recomputed a second way here.
    actionPlan: report.recommendedNextSteps,
    sourceStatus: state.sourceStatus,
    contextualEvidence,
    evidenceCoverage,
    report,
    newMessages,
  }
}

/** Barge-in is only offered while the assistant is speaking or still thinking — never as a fake mic control. */
export function canInterruptVoice(voiceActive: boolean, audioState: string): boolean {
  return voiceActive && (audioState === 'speaking' || audioState === 'processing')
}
