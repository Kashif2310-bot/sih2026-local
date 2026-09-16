/**
 * Deterministic conversation-phase resolution — five phases, one pure
 * function, no hand-maintained transition graph. The phase is always
 * recomputed FROM current state (readiness + whether a required question
 * is still pending + an explicit deep-analysis request); it is never
 * mutated directly, so it can never drift out of sync with the state it
 * describes.
 */

import type { RecommendationReadiness } from './readiness'
import type { ConversationPhase } from './types'

export interface DeterminePhaseInput {
  readiness: RecommendationReadiness
  hasPendingRequiredQuestion: boolean
  /** Only true when the citizen has explicitly asked for more depth (VoiceAssistantController.requestDeepAnalysis()) — never inferred from free text, to avoid guessing intent from ambiguous phrasing. */
  deepAnalysisRequested: boolean
}

export function determinePhase(input: DeterminePhaseInput): ConversationPhase {
  if (input.readiness === 'application_ready') return 'application_ready'
  if (input.readiness === 'exploratory') return 'discovery'
  if (input.deepAnalysisRequested && input.readiness === 'actionable') return 'deep_analysis'
  if (input.hasPendingRequiredQuestion) return 'clarification'
  return 'recommendation'
}
