/**
 * VoiceAssistantController — the headless intelligence/orchestration layer
 * that sits between VoiceSession (src/assistant/voice/) and the existing
 * deterministic text pipeline (profileExtraction/missingFields/ranking/
 * retrieval/liveRetrieval/promptBuilder/responseGuard).
 *
 *   VoiceSession -> (a finalized transcript) -> VoiceAssistantController -> reply text -> VoiceSession
 *
 * This is the concrete implementation of the VoiceTurnPipelineHandler seam
 * documented in src/assistant/voice/types.ts. It is PROVIDER-INDEPENDENT:
 * nothing in this file knows about Gemini, WebSockets, or audio — it
 * consumes a plain transcript string and produces a plain reply string. A
 * caller wires it to VoiceSession events (see "Voice integration" below).
 *
 * AI SAFETY BOUNDARY (see also ../voice/types.ts and
 * docs/voice-session-architecture.md): this controller reuses, and never
 * duplicates or bypasses:
 *   - profileExtraction.ts's extractAndMerge        (fact extraction)
 *   - missingFields.ts's identifyMissingFields      (what's still unknown)
 *   - ranking.ts's rankSchemes / eligibility.ts underneath (all scoring)
 *   - orchestrator.ts's attemptLiveRetrieval        (live evidence timing/validation)
 *   - orchestrator.ts's generateWithFallback        (which itself runs every
 *     reply through ai/responseGuard.ts's validateProviderReply before
 *     trusting it — never weakened or bypassed here)
 *   - orchestrator.ts's buildActionPlan             (next-steps text)
 * The only NEW decision this file adds is WHICH ONE question to ask next
 * (questionPolicy.ts) and WHEN the conversation has learned enough to be
 * useful (readiness.ts) — never a new fact, score, or approval.
 */

import { extractAndMerge } from '../profileExtraction'
import { identifyMissingFields, type MissingFieldInfo } from '../missingFields'
import { rankSchemes } from '../ranking'
import { defaultRetriever, type SchemeRetriever } from '../retrieval'
import { defaultLiveRetriever, type LiveRetriever } from '../liveRetrieval'
import {
  attemptLiveRetrieval,
  buildActionPlan,
  createInitialProfile,
  generateWithFallback,
  type ActionPlanStep,
} from '../orchestrator'
import { defaultProviderChain } from '../ai'
import type { AIProvider, AIRequestContext, ChatTurn, ProviderId } from '../ai/types'
import type { RetrievalSourceStatus, UserProfile } from '../types'
import { createEmptyApplicantProfile, withRawNote } from '../../shared/applicantProfile'
import { mergeExtractedFactsIntoApplicantProfile } from './applicantProfileBridge'
import {
  checkEvidenceInvalidation,
  detectFinancingIntentSignal,
  snapshotDecisionCriticalFields,
} from './evidenceInvalidation'
import { determinePhase } from './phase'
import {
  isUncertaintyResponse,
  reconcilePendingQuestion,
  selectNextQuestion,
  type NextQuestionDecision,
  type QuestionDetails,
} from './questionPolicy'
import { assessReadiness, type ReadinessAssessment } from './readiness'
import { buildPersonalizedReport, type PersonalizedReport } from './report'
import { createInitialConversationState, type AskedQuestionRecord, type ConversationState } from './types'

export interface VoiceAssistantControllerDeps {
  retriever?: SchemeRetriever
  liveRetriever?: LiveRetriever
  providers?: AIProvider[]
}

export type ConversationEvent =
  | { type: 'state_updated'; state: ConversationState }
  | { type: 'question_selected'; question: QuestionDetails }
  | { type: 'evidence_fetch_started' }
  | { type: 'evidence_fetch_finished'; sourceStatus: RetrievalSourceStatus }
  | { type: 'report_ready'; report: PersonalizedReport }

export interface VoiceAssistantTurnResult {
  state: ConversationState
  question: NextQuestionDecision
  readiness: ReadinessAssessment
  report: PersonalizedReport | null
  replyText: string
  isFallback: boolean
  usedProvider: ProviderId
}

function existingDeclineCountFor(field: keyof UserProfile, questionsAsked: AskedQuestionRecord[]): number {
  const prior = [...questionsAsked].reverse().find((q) => q.field === field && q.status === 'declined')
  return prior?.declineCount ?? 0
}

export class VoiceAssistantController {
  private state: ConversationState
  private readonly deps: Required<VoiceAssistantControllerDeps>
  private readonly listeners = new Set<(event: ConversationEvent) => void>()
  private turnCounter = 0

  constructor(deps: VoiceAssistantControllerDeps = {}, initialState?: ConversationState) {
    this.deps = {
      retriever: deps.retriever ?? defaultRetriever,
      liveRetriever: deps.liveRetriever ?? defaultLiveRetriever,
      providers: deps.providers ?? defaultProviderChain(),
    }
    this.state = initialState ?? createInitialConversationState(createEmptyApplicantProfile(), createInitialProfile())
  }

  getState(): ConversationState {
    return this.state
  }

  subscribe(listener: (event: ConversationEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** The only way phase reaches 'deep_analysis' — never inferred from free text. A future "tell me more" UI affordance calls this. */
  requestDeepAnalysis(): void {
    this.state = { ...this.state, deepAnalysisRequested: true }
    this.emit({ type: 'state_updated', state: this.state })
  }

  async handleUserTranscript(transcript: string, turnId?: string): Promise<VoiceAssistantTurnResult> {
    const trimmed = transcript.trim()
    const now = new Date().toISOString()
    const effectiveTurnId = turnId ?? `voice-turn-${(this.turnCounter += 1)}`
    const base = this.state

    // 1. Deterministic multi-fact extraction — reused, unmodified. Handles
    // "I am 28, from a village near Mysore, and my father already has five
    // cows" in one pass; tolerates incomplete/irrelevant text by simply
    // extracting nothing from it.
    const { profile: nextUserProfile, updatedFields } = extractAndMerge(trimmed, base.userProfile)

    // 2. Reconcile whatever question was pending against this reply.
    const pendingWasAnswered = base.pendingQuestionField !== null && updatedFields.includes(base.pendingQuestionField)
    const pendingWasDeclined = !pendingWasAnswered && isUncertaintyResponse(trimmed)
    let questionsAsked = base.questionsAsked
    if (base.pendingQuestionField) {
      const previousRecord = [...base.questionsAsked].reverse().find((q) => q.field === base.pendingQuestionField && q.status === 'pending')
      const reconciled = reconcilePendingQuestion({
        pendingField: base.pendingQuestionField,
        previousRecord,
        wasAnsweredThisTurn: pendingWasAnswered,
        wasDeclinedThisTurn: pendingWasDeclined,
      })
      if (reconciled && previousRecord) {
        questionsAsked = base.questionsAsked.map((q) => (q === previousRecord ? { ...q, ...reconciled } : q))
      }
    }

    // 3. A financing-TYPE signal ("no loan, only subsidy") that the current
    // UserProfile has no dedicated field for — captured as a rawNote, never
    // a structured (and therefore potentially misrepresented) fact.
    const financingSignal = detectFinancingIntentSignal(trimmed)

    // 4. Fold this turn's newly-learned facts into the shared ApplicantProfile,
    // with correct provenance (see applicantProfileBridge.ts).
    let applicantProfile = mergeExtractedFactsIntoApplicantProfile(base.applicantProfile, nextUserProfile, updatedFields, now)
    if (financingSignal) {
      applicantProfile = withRawNote(
        applicantProfile,
        `Financing preference: ${financingSignal === 'subsidy_only' ? 'wants a subsidy, not a loan' : 'wants a loan, not a subsidy'}.`,
        now,
      )
    }

    // 5. Missing-field detection and local ranking — reused, unmodified,
    // and (matching the existing text orchestrator) recomputed every turn
    // since both are cheap and synchronous.
    const missingFields = identifyMissingFields(nextUserProfile)
    let ranked = rankSchemes(nextUserProfile, trimmed, this.deps.retriever)

    // 6. Live evidence is NOT refetched on every sentence — only when a
    // decision-critical fact actually changed (or hasn't been fetched yet).
    const invalidation = checkEvidenceInvalidation(
      base.lastEvidenceFetchSnapshot,
      nextUserProfile,
      financingSignal ? `financing intent changed (${financingSignal})` : undefined,
    )
    let sourceStatus = base.sourceStatus
    let lastEvidenceFetchSnapshot = base.lastEvidenceFetchSnapshot
    if (invalidation.shouldRefetch) {
      this.emit({ type: 'evidence_fetch_started' })
      const result = await attemptLiveRetrieval(ranked, nextUserProfile, this.deps.liveRetriever)
      ranked = result.ranked
      sourceStatus = result.sourceStatus
      lastEvidenceFetchSnapshot = snapshotDecisionCriticalFields(nextUserProfile)
      this.emit({ type: 'evidence_fetch_finished', sourceStatus })
    }

    // 7. Readiness, then exactly one next question (never a mechanical list).
    const readiness = assessReadiness({ userProfile: nextUserProfile, ranked, missingFields })
    const questionDecision = selectNextQuestion({ userProfile: nextUserProfile, missingFields, ranked, questionsAsked })
    let pendingQuestionField: keyof UserProfile | null = null
    if (questionDecision.shouldAsk && questionDecision.question) {
      const field = questionDecision.question.fields[0]
      pendingQuestionField = field
      questionsAsked = [
        ...questionsAsked,
        {
          field,
          questionId: questionDecision.question.id,
          askedAt: now,
          status: 'pending',
          declineCount: existingDeclineCountFor(field, questionsAsked),
        },
      ]
      this.emit({ type: 'question_selected', question: questionDecision.question })
    }

    const phase = determinePhase({
      readiness: readiness.status,
      hasPendingRequiredQuestion: Boolean(questionDecision.shouldAsk && questionDecision.question?.requirement === 'required'),
      deepAnalysisRequested: base.deepAnalysisRequested,
    })

    // 8. Reply text via the EXISTING guarded pipeline (promptBuilder +
    // responseGuard, inside generateWithFallback) — narrowed to AT MOST the
    // one question this engine selected, so a real AIProvider naturally
    // phrases exactly that one question in context rather than picking
    // among several candidates itself. No eligibility/scheme fact is ever
    // supplied to the model beyond what `ranked` already contains.
    const history: ChatTurn[] = base.turns.slice(-6).map((t) => ({ role: t.role, text: t.text }))
    const narrowedMissingFields: MissingFieldInfo[] =
      questionDecision.shouldAsk && questionDecision.question
        ? [{ field: questionDecision.question.fields[0], priority: 1, question: questionDecision.question.prompt }]
        : []
    const context: AIRequestContext = {
      profile: nextUserProfile,
      message: trimmed,
      history,
      missingFields: narrowedMissingFields,
      ranked,
      newlyUpdatedFields: updatedFields,
    }
    const reply = await generateWithFallback(context, this.deps.providers)

    // 9. Early value delivery: the report becomes available once readiness
    // is 'actionable' or better — built purely from existing deterministic
    // data (never gated on "every field known").
    const reportReady = readiness.status === 'actionable' || readiness.status === 'application_ready'
    let report: PersonalizedReport | null = null
    let actionPlan: ActionPlanStep[] = []
    if (reportReady) {
      actionPlan = buildActionPlan(ranked)
      report = buildPersonalizedReport({ applicantProfile, ranked, actionPlan, readiness, sourceStatus, now })
      this.emit({ type: 'report_ready', report })
    }

    const nextState: ConversationState = {
      userProfile: nextUserProfile,
      applicantProfile,
      phase,
      turns: [
        ...base.turns,
        { turnId: effectiveTurnId, role: 'user', text: trimmed, at: now },
        { turnId: effectiveTurnId, role: 'assistant', text: reply.text, at: new Date().toISOString() },
      ],
      missingFields,
      questionsAsked,
      pendingQuestionField,
      ranked,
      sourceStatus,
      lastEvidenceFetchSnapshot,
      deepAnalysisRequested: base.deepAnalysisRequested,
    }
    this.state = nextState
    this.emit({ type: 'state_updated', state: nextState })

    return {
      state: nextState,
      question: questionDecision,
      readiness,
      report,
      replyText: reply.text,
      isFallback: reply.isFallback,
      usedProvider: reply.usedProvider,
    }
  }

  private emit(event: ConversationEvent): void {
    for (const listener of this.listeners) listener(event)
  }
}
