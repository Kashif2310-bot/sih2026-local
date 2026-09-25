import { createContext } from 'react'
import type { ApplicantProfile } from '../../shared/applicantProfile'
import type { ProviderId } from '../ai/types'
import type { PersonalizedReport } from '../conversation/reportModel'
import type { SourceCoverageAccounting } from '../evidence/types'
import type { MissingFieldInfo } from '../missingFields'
import type { ActionPlanStep } from '../orchestrator'
import type { AssistantAudioState } from '../conversation/voiceConversationRuntime'
import type { VoiceLanguageSelection } from '../voice/voiceLanguageSelection'
import type { ContextualEvidenceItem, RankedScheme, RetrievalSourceStatus, UserProfile } from '../types'

export interface UIMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  timestamp: number
  isFallback?: boolean
  providerUsed?: ProviderId
  /** What actually happened with live government-source retrieval on the turn that produced this message — drives the visible source-status line. Absent for user messages. */
  sourceStatus?: RetrievalSourceStatus
  /** True for a message produced by a finalized voice turn rather than typed text — same state, same pipeline output, just a different input modality. */
  fromVoice?: boolean
}

export interface AssistantState {
  profile: UserProfile
  /**
   * The shared, cross-workstream ApplicantProfile (src/shared/applicantProfile.ts),
   * kept in sync with `profile` every turn — never a second competing model,
   * just the same facts projected through the existing bridge (see
   * orchestrator.ts's runAssistantTurn / conversation/applicantProfileBridge.ts).
   */
  applicantProfile: ApplicantProfile
  messages: UIMessage[]
  ranked: RankedScheme[]
  missingFields: MissingFieldInfo[]
  actionPlan: ActionPlanStep[]
  /** What actually happened with live government-source retrieval on the most recent turn — the same value as the latest assistant message's sourceStatus, exposed at top level for convenience. */
  sourceStatus: RetrievalSourceStatus | null
  /** Official government evidence retrieved on the most recent turn that could NOT be deterministically tied to one specific scheme (Prompt 8) — never scheme-specific proof, always shown separately from `ranked[].liveEvidence`. */
  contextualEvidence: ContextualEvidenceItem[]
  /** Honest source/record coverage accounting for the most recent live-evidence attempt, or null if none has been attempted yet this session. Never implies "all government schemes checked". */
  evidenceCoverage: SourceCoverageAccounting | null
  /** The current personalized analysis, built from the same deterministic evidence already in `ranked`/`applicantProfile` — null until the first turn completes. Rebuilt (never mutated) every turn; see buildPersonalizedReport. */
  report: PersonalizedReport | null
  loading: boolean
  error: string | null
  selectedSchemeId: string | null
  hasStarted: boolean
  caseBound: boolean
  sendMessage: (text: string) => Promise<void>
  retryLast: () => Promise<void>
  selectScheme: (id: string | null) => void
  reset: () => void
  /** Voice entry point — see conversation/voiceConversationRuntime.ts + conversation/voiceAssistantController.ts. Reuses this exact assistant state; never a second state machine. */
  voiceAvailable: boolean
  voiceAudioState: AssistantAudioState
  voiceActive: boolean
  voiceError: string | null
  startVoice: () => Promise<void>
  stopVoice: () => Promise<void>
  interruptVoice: () => void
  /** The citizen's explicit language choice for the NEXT startVoice() call — read once at connect time, so changing it while a session is already active has no effect until the next start. */
  voiceLanguage: VoiceLanguageSelection
  setVoiceLanguage: (language: VoiceLanguageSelection) => void
}

export const AssistantCtx = createContext<AssistantState | null>(null)
