/**
 * Deterministic question-selection engine.
 *
 * This is the module that stops the assistant from behaving like a
 * mechanical questionnaire ("age? gender? income? category?"). It does NOT
 * decide what information matters from scratch — src/assistant/missingFields.ts
 * already is that engine (an expert-authored, priority-ordered list of what's
 * still unknown) and is reused here unchanged as the candidate pool. What this
 * module adds:
 *
 *   1. Materiality — WHY a field matters (does it gate eligibility outright,
 *      does it shape financing, or is it merely nice-to-have?), grounded in
 *      what eligibility.ts actually does with each field (see
 *      FIELD_MATERIALITY below) and, when ranking evidence already exists,
 *      sharpened further by what THIS citizen's actual candidate schemes are
 *      currently missing (see rankingEvidenceBonus()).
 *   2. Selection — exactly ONE next question, not a list for an LLM to pick
 *      from (contrast with how ai/promptBuilder.ts's SUGGESTED FOLLOW-UP
 *      QUESTIONS section works in the existing text orchestrator — this
 *      engine narrows that down to one before a prompt is ever built).
 *   3. Repetition safety — a field that was already answered can never be a
 *      candidate again (it's structurally absent from missingFields.ts's
 *      output once set); a field the citizen explicitly declined
 *      ("I don't know") gets a bounded, materiality-scaled re-ask allowance
 *      instead of being asked forever or never again.
 *
 * The LLM never decides which field matters — see AI SAFETY BOUNDARY in
 * ../voice/types.ts and docs/voice-session-architecture.md. It may only
 * rephrase the ONE selected question naturally (see promptBuilder.ts's
 * existing "weave in ONE of them" contract, which this module feeds by
 * narrowing AIRequestContext.missingFields to at most one entry).
 */

import type { MissingFieldInfo } from '../missingFields'
import type { RankedScheme, UserProfile } from '../types'
import type { AskedQuestionRecord } from './types'

export type QuestionMateriality = 'high' | 'medium' | 'low'
export type QuestionRequirement = 'required' | 'optional'

export type QuestionCategory =
  | 'business_intent'
  | 'location'
  | 'financial'
  | 'demographic'
  | 'eligibility_gate'

/**
 * Grounded in eligibility.ts, not guessed: a field is 'high' materiality
 * when it can trigger a hard eligibility mismatch there (state/areaType/
 * age/gender/socialCategory/businessSector/businessStage all have a
 * `hardMismatch = true` branch) OR when the product requirement explicitly
 * names it as shaping financing structure (financingRequired — eligibility.ts
 * only soft-scores this, never hard-mismatches on it, but "financing
 * structure" is named explicitly in the task's materiality criteria).
 * 'low' fields (education, existingLoans) are asked by missingFields.ts but
 * are never read by eligibility.ts at all today — genuinely nice-to-have.
 */
export const FIELD_MATERIALITY: Partial<Record<keyof UserProfile, QuestionMateriality>> = {
  businessSector: 'high',
  state: 'high',
  socialCategory: 'high',
  annualIncome: 'high',
  businessStage: 'high',
  financingRequired: 'high',
  age: 'medium',
  areaType: 'medium',
  education: 'low',
  existingLoans: 'low',
}

const FIELD_CATEGORY: Partial<Record<keyof UserProfile, QuestionCategory>> = {
  businessSector: 'business_intent',
  businessStage: 'business_intent',
  financingRequired: 'financial',
  state: 'location',
  areaType: 'location',
  annualIncome: 'financial',
  socialCategory: 'eligibility_gate',
  age: 'demographic',
  education: 'demographic',
  existingLoans: 'financial',
}

/** How many times a declined field may be re-asked, by materiality. A 'low' field declined once is never re-asked; a 'high' field gets one more chance later (never a third). */
const REASK_ALLOWANCE_BY_MATERIALITY: Record<QuestionMateriality, number> = {
  high: 1,
  medium: 1,
  low: 0,
}

/** Substrings of eligibility.ts's own missingInfo strings, used to detect when a field is blocking THIS citizen's actual top candidate schemes right now — see rankingEvidenceBonus(). */
const MISSING_INFO_KEYWORDS: Partial<Record<keyof UserProfile, string>> = {
  state: 'state',
  areaType: 'area type',
  age: 'age',
  socialCategory: 'social categ',
  annualIncome: 'annual income',
  businessSector: 'business sector',
  businessStage: 'business stage',
  financingRequired: 'financing amount',
}

const MATERIALITY_WEIGHT: Record<QuestionMateriality, number> = { high: 1.5, medium: 1.0, low: 0.5 }
const RANKING_EVIDENCE_BONUS = 6
const TOP_SCHEMES_CONSIDERED = 3

export interface QuestionDetails {
  id: string
  category: QuestionCategory
  fields: Array<keyof UserProfile>
  prompt: string
  rationale: string
  priority: number
  materiality: QuestionMateriality
  requirement: QuestionRequirement
}

export interface NextQuestionDecision {
  shouldAsk: boolean
  question?: QuestionDetails
  reason?: string
}

function materialityOf(field: keyof UserProfile): QuestionMateriality {
  return FIELD_MATERIALITY[field] ?? 'medium'
}

/** Extra score when this field appears in the missingInfo of one of the citizen's own current top-ranked schemes — i.e. it's blocking THEIR actual candidates right now, not just abstractly important. */
function rankingEvidenceBonus(field: keyof UserProfile, ranked: RankedScheme[]): number {
  const keyword = MISSING_INFO_KEYWORDS[field]
  if (!keyword) return 0
  const top = ranked.slice(0, TOP_SCHEMES_CONSIDERED)
  const isBlocking = top.some(
    (r) =>
      (r.eligibility.status === 'possibly_eligible' || r.eligibility.status === 'insufficient_data') &&
      r.eligibility.missingInfo.some((m) => m.toLowerCase().includes(keyword)),
  )
  return isBlocking ? RANKING_EVIDENCE_BONUS : 0
}

function reaskPenalty(field: keyof UserProfile, questionsAsked: AskedQuestionRecord[]): number | null {
  const record = [...questionsAsked].reverse().find((q) => q.field === field)
  if (!record) return 0
  if (record.status === 'answered') return null // structurally shouldn't happen (answered fields leave missingFields), but never re-ask if it somehow does
  if (record.status === 'declined') {
    const allowance = REASK_ALLOWANCE_BY_MATERIALITY[materialityOf(field)]
    if (record.declineCount > allowance) return null
    return -15 // still eligible, but de-prioritized so fresher candidates win first
  }
  return -3 // 'pending' (asked but the citizen didn't address it) — still legitimate to retry, mild de-prioritization so it doesn't dominate every turn
}

/**
 * Sector-aware deterministic phrasing for a couple of high-value fields —
 * demonstrates the "not a mechanical questionnaire" requirement even with
 * zero AI provider available (the offline path). When a real AIProvider IS
 * available, it naturally rephrases this further in context (see
 * ai/promptBuilder.ts's existing "weave in ONE of them" instruction) — this
 * is the deterministic floor, not the ceiling.
 */
function phraseQuestion(field: keyof UserProfile, fallback: string, profile: UserProfile): string {
  const sector = profile.businessSector ? profile.businessSector.replace(/_/g, ' ') : undefined
  if (field === 'businessStage') {
    return sector
      ? `Are you already running a ${sector} operation, or would this be a completely new setup?`
      : fallback
  }
  if (field === 'financingRequired') {
    if (sector && profile.businessStage === 'existing_expansion') {
      return `Roughly how much are you looking to invest to expand the ${sector} business?`
    }
    if (sector) {
      return `Roughly how much are you planning to invest to get the ${sector} business started?`
    }
    return fallback
  }
  return fallback
}

export interface SelectNextQuestionInput {
  userProfile: UserProfile
  missingFields: MissingFieldInfo[]
  ranked: RankedScheme[]
  questionsAsked: AskedQuestionRecord[]
}

/**
 * Selects at most ONE next question. Returns shouldAsk:false with a reason
 * when nothing left is worth asking (either nothing is missing, or every
 * remaining candidate has exhausted its re-ask allowance).
 */
export function selectNextQuestion(input: SelectNextQuestionInput): NextQuestionDecision {
  const { userProfile, missingFields, ranked, questionsAsked } = input

  if (missingFields.length === 0) {
    return { shouldAsk: false, reason: 'no tracked fields are missing' }
  }

  let best: { candidate: MissingFieldInfo; score: number } | null = null
  for (const candidate of missingFields) {
    const penalty = reaskPenalty(candidate.field, questionsAsked)
    if (penalty === null) continue // exhausted its re-ask allowance
    const materiality = materialityOf(candidate.field)
    const basePriorityScore = 10 - candidate.priority // missingFields.ts priorities run 1 (most important) .. 9
    const score = basePriorityScore * MATERIALITY_WEIGHT[materiality] + rankingEvidenceBonus(candidate.field, ranked) + penalty
    if (!best || score > best.score) best = { candidate, score }
  }

  if (!best) {
    return { shouldAsk: false, reason: 'every remaining missing field has already been declined as many times as its importance allows' }
  }

  const materiality = materialityOf(best.candidate.field)
  const requirement: QuestionRequirement = materiality === 'low' ? 'optional' : 'required'
  const blockingRanked = rankingEvidenceBonus(best.candidate.field, ranked) > 0

  return {
    shouldAsk: true,
    question: {
      id: `q-${best.candidate.field}`,
      category: FIELD_CATEGORY[best.candidate.field] ?? 'demographic',
      fields: [best.candidate.field],
      prompt: phraseQuestion(best.candidate.field, best.candidate.question, userProfile),
      rationale: blockingRanked
        ? `${String(best.candidate.field)} is currently missing information for one of your closest-matching schemes.`
        : `${String(best.candidate.field)} materially affects which schemes can be recommended and how.`,
      priority: best.score,
      materiality,
      requirement,
    },
  }
}

/**
 * Called once per turn to reconcile the PREVIOUS turn's pending question
 * against what the citizen just said. Returns the updated status/declineCount
 * for that record — the caller (voiceAssistantController.ts) is responsible
 * for actually mutating ConversationState.questionsAsked with it.
 */
export function reconcilePendingQuestion(input: {
  pendingField: keyof UserProfile | null
  previousRecord: AskedQuestionRecord | undefined
  wasAnsweredThisTurn: boolean
  wasDeclinedThisTurn: boolean
}): Pick<AskedQuestionRecord, 'status' | 'declineCount'> | null {
  if (!input.pendingField || !input.previousRecord) return null
  if (input.wasAnsweredThisTurn) return { status: 'answered', declineCount: input.previousRecord.declineCount }
  if (input.wasDeclinedThisTurn) return { status: 'declined', declineCount: input.previousRecord.declineCount + 1 }
  return null // left pending — no change
}

const UNCERTAINTY_PATTERNS: RegExp[] = [
  /\bi\s*(don'?t|do not)\s*know\b/i,
  /\bnot\s*(yet\s*)?(decided|sure|certain)\b/i,
  /\bhaven'?t\s*decided\b/i,
  /\bno\s*idea\b/i,
  /\bskip\s*(that|this)\s*(question)?\b/i,
]

/** Deterministic "the citizen declined to answer" detector — kept local to this module rather than added to profileExtraction.ts, since it's a conversation-flow signal (don't re-ask), not a profile fact. */
export function isUncertaintyResponse(text: string): boolean {
  return UNCERTAINTY_PATTERNS.some((re) => re.test(text))
}
