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
import type { ContextualEvidenceItem, RankedScheme, RetrievalSourceStatus, UserProfile } from '../types'
import { createEmptyApplicantProfile, withRawNote, type ApplicantProfile } from '../../shared/applicantProfile'
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
import type { SourceCoverageAccounting } from '../evidence/types'

/** Tracks the last emitted report so refreshes bump version without mutating history. */
type ReportVersionCursor = Pick<PersonalizedReport, 'reportId' | 'version'>

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
  /** Always built — maturity may be exploratory; never requires every field known. */
  report: PersonalizedReport
  replyText: string
  isFallback: boolean
  usedProvider: ProviderId
  /** Official government evidence retrieved this turn that could not be tied to one specific scheme — same value already folded into `report.governmentContextualEvidence`; exposed here too since a caller may want it before/without rebuilding from the report. */
  contextualEvidence: ContextualEvidenceItem[]
  /** Honest source/record coverage accounting for this turn's live-evidence attempt (or the last one, on a turn that didn't refetch), or null if none has been attempted yet. */
  evidenceCoverage: SourceCoverageAccounting | null
}

/**
 * Everything one turn's deterministic pipeline produces, before anything
 * generative happens. Internal to this file — the two public entry points
 * (handleUserTranscript / ingestUserUtterance) both consume it and neither
 * exposes it.
 */
interface DeterministicTurn {
  nextUserProfile: UserProfile
  updatedFields: Array<keyof UserProfile>
  applicantProfile: ApplicantProfile
  missingFields: MissingFieldInfo[]
  ranked: RankedScheme[]
  sourceStatus: RetrievalSourceStatus | null
  lastEvidenceFetchSnapshot: ConversationState['lastEvidenceFetchSnapshot']
  contextualEvidence: ContextualEvidenceItem[]
  evidenceCoverage: SourceCoverageAccounting | null
  readiness: ReadinessAssessment
  questionDecision: NextQuestionDecision
  questionsAsked: AskedQuestionRecord[]
  pendingQuestionField: keyof UserProfile | null
  phase: ConversationState['phase']
}

/**
 * What ingestUserUtterance returns: the same analysis a full turn produces,
 * minus the reply fields — deliberately a narrower type than
 * VoiceAssistantTurnResult rather than one padded with an empty replyText
 * and a made-up providerId, which would misreport who spoke.
 */
export interface VoiceFactIngestResult {
  state: ConversationState
  question: NextQuestionDecision
  readiness: ReadinessAssessment
  report: PersonalizedReport
  contextualEvidence: ContextualEvidenceItem[]
  evidenceCoverage: SourceCoverageAccounting | null
}

function existingDeclineCountFor(field: keyof UserProfile, questionsAsked: AskedQuestionRecord[]): number {
  const prior = [...questionsAsked].reverse().find((q) => q.field === field && q.status === 'declined')
  return prior?.declineCount ?? 0
}

/**
 * When the citizen expresses uncertainty about financing (and did not just
 * supply a financing figure), preserve that as finance uncertainty in the
 * report rather than inventing an amount.
 */
function detectUserUncertainFields(
  message: string,
  updatedFields: Array<keyof UserProfile>,
): Array<keyof UserProfile> {
  if (updatedFields.includes('financingRequired') || updatedFields.includes('investmentRequired')) {
    return []
  }
  if (!isUncertaintyResponse(message)) return []
  if (/\b(loan|financ|amount|how much|investment|ಸಾಲ|ಎಷ್ಟು)\b/i.test(message)) {
    return ['financingRequired']
  }
  return []
}

export class VoiceAssistantController {
  private state: ConversationState
  private readonly deps: Required<VoiceAssistantControllerDeps>
  private readonly listeners = new Set<(event: ConversationEvent) => void>()
  private turnCounter = 0
  private lastReportCursor: ReportVersionCursor | null = null
  /** Contextual government evidence from the most recent live-evidence fetch — carried forward on turns that don't refetch, exactly like sourceStatus/lastEvidenceFetchSnapshot. Never scheme-specific (see evidence/schemeBinding.ts). */
  private lastContextualEvidence: ContextualEvidenceItem[] = []
  /** Coverage accounting from the most recent live-evidence fetch — carried forward on turns that don't refetch, same rule as lastContextualEvidence. */
  private lastEvidenceCoverage: SourceCoverageAccounting | null = null

  constructor(deps: VoiceAssistantControllerDeps = {}, initialState?: ConversationState) {
    this.deps = {
      retriever: deps.retriever ?? defaultRetriever,
      liveRetriever: deps.liveRetriever ?? defaultLiveRetriever,
      providers: deps.providers ?? defaultProviderChain(),
    }
    this.state = initialState ?? createInitialConversationState(createEmptyApplicantProfile(), createInitialProfile())
  }

  /**
   * Serializes every state-mutating turn.
   *
   * A turn reads `this.state`, awaits async work (live evidence, the AI
   * provider), then writes the result back. Two turns overlapping therefore
   * both read the SAME base state and the second one's write silently
   * discards whatever the first learned. That is not hypothetical here: the
   * native-audio path can receive a batch of tool calls that each record a
   * detail, and a finalized transcript can land while one is still running.
   * Queueing costs nothing on the common path (the queue is already
   * resolved) and removes the whole class of lost updates.
   */
  private mutationQueue: Promise<unknown> = Promise.resolve()

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    // Chained through both settle paths so one failed turn cannot wedge the
    // queue for the rest of the conversation.
    const run = this.mutationQueue.then(work, work)
    this.mutationQueue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
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

  /**
   * Runs the deterministic pipeline for one utterance WITHOUT generating a
   * reply — profile extraction, evidence, ranking, readiness, question
   * selection and the report, exactly as handleUserTranscript does, minus
   * step 8.
   *
   * This exists for the native-audio voice path, where the provider speaks
   * its own reply and asking a second model to write one would be wasted
   * work and a second voice in the conversation. The provider still never
   * becomes a source of government facts: it must call a tool to learn
   * anything, and those tools are answered from the state this method
   * computes. See conversation/voiceTools.ts.
   *
   * Deliberately shares every step with handleUserTranscript rather than
   * re-implementing them — the two differ only in who writes the words.
   */
  async ingestUserUtterance(transcript: string, turnId?: string): Promise<VoiceFactIngestResult> {
    return this.enqueue(() => this.runIngestUserUtterance(transcript, turnId))
  }

  private async runIngestUserUtterance(transcript: string, turnId?: string): Promise<VoiceFactIngestResult> {
    const trimmed = transcript.trim()
    const now = new Date().toISOString()
    const effectiveTurnId = turnId ?? `voice-turn-${(this.turnCounter += 1)}`
    const computed = await this.computeDeterministicTurn(trimmed, now)
    const committed = this.commitTurn(computed, trimmed, effectiveTurnId, now, null)
    return {
      state: committed.state,
      question: computed.questionDecision,
      readiness: computed.readiness,
      report: committed.report,
      contextualEvidence: computed.contextualEvidence,
      evidenceCoverage: computed.evidenceCoverage,
    }
  }

  async handleUserTranscript(transcript: string, turnId?: string): Promise<VoiceAssistantTurnResult> {
    return this.enqueue(() => this.runHandleUserTranscript(transcript, turnId))
  }

  private async runHandleUserTranscript(transcript: string, turnId?: string): Promise<VoiceAssistantTurnResult> {
    const trimmed = transcript.trim()
    const now = new Date().toISOString()
    const effectiveTurnId = turnId ?? `voice-turn-${(this.turnCounter += 1)}`
    const base = this.state

    const computed = await this.computeDeterministicTurn(trimmed, now)

    // 8. Reply text via the EXISTING guarded pipeline (promptBuilder +
    // responseGuard, inside generateWithFallback) — narrowed to AT MOST the
    // one question this engine selected, so a real AIProvider naturally
    // phrases exactly that one question in context rather than picking
    // among several candidates itself. No eligibility/scheme fact is ever
    // supplied to the model beyond what `ranked` already contains.
    const history: ChatTurn[] = base.turns.slice(-6).map((t) => ({ role: t.role, text: t.text }))
    const narrowedMissingFields: MissingFieldInfo[] =
      computed.questionDecision.shouldAsk && computed.questionDecision.question
        ? [
            {
              field: computed.questionDecision.question.fields[0],
              priority: 1,
              question: computed.questionDecision.question.prompt,
            },
          ]
        : []
    const context: AIRequestContext = {
      profile: computed.nextUserProfile,
      message: trimmed,
      history,
      missingFields: narrowedMissingFields,
      ranked: computed.ranked,
      newlyUpdatedFields: computed.updatedFields,
    }
    const reply = await generateWithFallback(context, this.deps.providers)

    const committed = this.commitTurn(computed, trimmed, effectiveTurnId, now, reply.text)

    return {
      state: committed.state,
      question: computed.questionDecision,
      readiness: computed.readiness,
      report: committed.report,
      replyText: reply.text,
      isFallback: reply.isFallback,
      usedProvider: reply.usedProvider,
      contextualEvidence: computed.contextualEvidence,
      evidenceCoverage: computed.evidenceCoverage,
    }
  }

  /**
   * Steps 1-7 of a turn: everything deterministic, nothing generative.
   * Extracted verbatim from handleUserTranscript so the voice path can run
   * exactly the same logic without also paying for a written reply — there
   * is one pipeline here, not two.
   */
  private async computeDeterministicTurn(trimmed: string, now: string): Promise<DeterministicTurn> {
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
    let contextualEvidence = this.lastContextualEvidence
    let evidenceCoverage = this.lastEvidenceCoverage
    if (invalidation.shouldRefetch) {
      this.emit({ type: 'evidence_fetch_started' })
      const result = await attemptLiveRetrieval(ranked, nextUserProfile, this.deps.liveRetriever)
      ranked = result.ranked
      sourceStatus = result.sourceStatus
      contextualEvidence = result.contextualEvidence
      this.lastContextualEvidence = result.contextualEvidence
      evidenceCoverage = result.evidenceCoverage
      this.lastEvidenceCoverage = result.evidenceCoverage
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

    return {
      nextUserProfile,
      updatedFields,
      applicantProfile,
      missingFields,
      ranked,
      sourceStatus,
      lastEvidenceFetchSnapshot,
      contextualEvidence,
      evidenceCoverage,
      readiness,
      questionDecision,
      questionsAsked,
      pendingQuestionField,
      phase,
    }
  }

  /**
   * Step 9 plus state commit. `assistantText` is null when the reply was
   * spoken by a native-audio provider rather than written here — in that
   * case no assistant turn is appended, because inventing an empty one
   * would corrupt the conversation history that later turns feed to the
   * text pipeline as context.
   */
  private commitTurn(
    computed: DeterministicTurn,
    trimmed: string,
    turnId: string,
    now: string,
    assistantText: string | null,
  ): { state: ConversationState; report: PersonalizedReport } {
    const base = this.state

    // 9. Incremental personalized analysis: a structured report is always
    // built from deterministic evidence (exploratory → application_ready).
    // Never gated on "every field known". Fresh snapshot each turn — prior
    // emitted reports are never mutated in place (version bumps via cursor).
    const actionPlan: ActionPlanStep[] = buildActionPlan(computed.ranked)
    const report = buildPersonalizedReport({
      applicantProfile: computed.applicantProfile,
      userProfile: computed.nextUserProfile,
      ranked: computed.ranked,
      actionPlan,
      readiness: computed.readiness,
      sourceStatus: computed.sourceStatus,
      contextualEvidence: computed.contextualEvidence,
      evidenceCoverage: computed.evidenceCoverage,
      now,
      previous: this.lastReportCursor,
      userUncertainFields: detectUserUncertainFields(trimmed, computed.updatedFields),
    })
    this.lastReportCursor = { reportId: report.reportId, version: report.version }
    this.emit({ type: 'report_ready', report })

    const nextState: ConversationState = {
      userProfile: computed.nextUserProfile,
      applicantProfile: computed.applicantProfile,
      phase: computed.phase,
      turns: [
        ...base.turns,
        { turnId, role: 'user', text: trimmed, at: now },
        ...(assistantText === null
          ? []
          : [{ turnId, role: 'assistant' as const, text: assistantText, at: new Date().toISOString() }]),
      ],
      missingFields: computed.missingFields,
      questionsAsked: computed.questionsAsked,
      pendingQuestionField: computed.pendingQuestionField,
      ranked: computed.ranked,
      sourceStatus: computed.sourceStatus,
      lastEvidenceFetchSnapshot: computed.lastEvidenceFetchSnapshot,
      deepAnalysisRequested: base.deepAnalysisRequested,
    }
    this.state = nextState
    this.emit({ type: 'state_updated', state: nextState })

    return { state: nextState, report }
  }

  /**
   * Records an assistant utterance that a native-audio provider spoke, so
   * the shared conversation history stays complete even though this
   * controller did not author the words. Purely additive — no pipeline step
   * runs, because the assistant speaking teaches us nothing new about the
   * citizen.
   */
  recordAssistantUtterance(text: string, turnId: string): ConversationState {
    const trimmed = text.trim()
    if (!trimmed) return this.state
    const nextState: ConversationState = {
      ...this.state,
      turns: [...this.state.turns, { turnId, role: 'assistant', text: trimmed, at: new Date().toISOString() }],
    }
    this.state = nextState
    this.emit({ type: 'state_updated', state: nextState })
    return nextState
  }

  private emit(event: ConversationEvent): void {
    for (const listener of this.listeners) listener(event)
  }
}
