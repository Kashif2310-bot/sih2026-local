/**
 * Core types for the voice-first intelligence/orchestration layer that
 * sits above VoiceSession and the existing deterministic text pipeline.
 *
 * Two distinct things live in this module, and they must never merge:
 *   - ConversationState — INTERACTION state: what's been asked, what phase
 *     the conversation is in, what evidence/readiness looks like right now.
 *   - ApplicantProfile (src/shared/applicantProfile.ts) — APPLICANT data:
 *     facts about the citizen, with provenance. ConversationState HOLDS one,
 *     it never re-implements or competes with it.
 *
 * AI SAFETY BOUNDARY: nothing in this module computes eligibility, ranks
 * schemes, calculates LokScore, or invents a government fact. Those stay
 * exactly where they already live (eligibility.ts, ranking.ts, retrieval.ts)
 * — this layer only reasons about WHICH question to ask next and WHEN the
 * conversation has enough to say something useful, using that existing
 * pipeline's own outputs as its evidence.
 */

import type { MissingFieldInfo } from '../missingFields'
import type { RankedScheme, RetrievalSourceStatus, UserProfile } from '../types'
import type { ApplicantProfile } from '../../shared/applicantProfile'

/**
 * Deliberately five phases, deterministic from current state — not a
 * hand-authored state machine with transition edges to maintain. See
 * determinePhase() in phase.ts.
 */
export type ConversationPhase = 'discovery' | 'clarification' | 'recommendation' | 'deep_analysis' | 'application_ready'

export interface ConversationTurnRecord {
  turnId: string
  role: 'user' | 'assistant'
  text: string
  at: string
}

export type AskedQuestionStatus = 'pending' | 'answered' | 'declined'

/**
 * One tracked "we asked about this field" record. Keyed on `keyof
 * UserProfile` (not ApplicantProfileFieldKey) because it directly tracks
 * MissingFieldInfo.field — the existing missingFields.ts's own vocabulary —
 * so no translation layer sits between "what we asked" and "what
 * identifyMissingFields still considers missing".
 */
export interface AskedQuestionRecord {
  field: keyof UserProfile
  questionId: string
  askedAt: string
  status: AskedQuestionStatus
  /** How many times a decline ("I don't know" / "not decided yet") has been recorded for this field — governs whether it may ever be re-asked. See questionPolicy.ts's REASK_ALLOWANCE_BY_MATERIALITY. */
  declineCount: number
}

export interface ConversationState {
  /** Feeds the existing, unmodified deterministic engines (missingFields/ranking/eligibility) — never redesigned here. */
  userProfile: UserProfile
  /** The cross-workstream shared contract — populated FROM userProfile via the bridge in applicantProfileBridge.ts, never a second competing profile. */
  applicantProfile: ApplicantProfile
  phase: ConversationPhase
  turns: ConversationTurnRecord[]
  missingFields: MissingFieldInfo[]
  questionsAsked: AskedQuestionRecord[]
  /** The field the most recently asked question targeted, if any — set so the NEXT turn can check whether it was answered/declined/ignored. */
  pendingQuestionField: keyof UserProfile | null
  ranked: RankedScheme[]
  sourceStatus: RetrievalSourceStatus | null
  /** UserProfile snapshot (decision-critical fields only) as of the last live-evidence fetch attempt — null before the first attempt. See evidenceInvalidation.ts. */
  lastEvidenceFetchSnapshot: Partial<UserProfile> | null
  /** True once the citizen has explicitly asked for more depth on the current recommendation (controller.requestDeepAnalysis()) — the only way phase reaches 'deep_analysis'; never auto-detected from free text. */
  deepAnalysisRequested: boolean
}

export function createInitialConversationState(applicantProfile: ApplicantProfile, userProfile: UserProfile): ConversationState {
  return {
    userProfile,
    applicantProfile,
    phase: 'discovery',
    turns: [],
    missingFields: [],
    questionsAsked: [],
    pendingQuestionField: null,
    ranked: [],
    sourceStatus: null,
    lastEvidenceFetchSnapshot: null,
    deepAnalysisRequested: false,
  }
}
