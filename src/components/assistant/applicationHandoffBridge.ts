/**
 * UI-layer wiring only: connects the assistant's report-based adapters
 * (src/assistant/conversation/applicationHandoff.ts — deliberately
 * apply-agnostic, imports nothing from src/apply/*) to the EXISTING Apply
 * handoff mechanism (src/apply/store.ts's ApplyHandoff/saveHandoff, already
 * used by SchemeDetailModal's "Start application" button).
 *
 * Never mints a second application id or store: the actual navigation
 * target, storage key, and downstream pipeline (ApplyStartPage ->
 * ApplyWizard -> submitApplication -> TrackedApplication, LP-APP-*) are
 * completely unchanged. This module only decides WHICH scheme to start and
 * what traceable context to attach — the same two things
 * SchemeDetailModal's existing button already decides today, just now
 * derived from the analysis instead of a single clicked scheme card.
 */
import type { ApplicantProfile } from '../../shared/applicantProfile'
import {
  projectDocumentsForApplication,
  projectReportForApplicationStart,
} from '../../assistant/conversation/applicationHandoff'
import type { PersonalizedReport } from '../../assistant/conversation/reportModel'
import type { UserProfile } from '../../assistant/types'
import type { ApplyHandoff } from '../../apply/store'

export interface StartApplicationFromAnalysis {
  schemeId: string
  handoff: ApplyHandoff
}

/**
 * Builds the exact same ApplyHandoff shape SchemeDetailModal's button
 * already saves, sourced from the current analysis instead of one clicked
 * scheme card. Returns null when the report has no candidate scheme yet —
 * never fabricates one (see projectReportForApplicationStart).
 */
export function buildStartApplicationFromAnalysis(
  report: PersonalizedReport,
  applicantProfile: ApplicantProfile,
  profile: UserProfile,
  schemeId?: string,
): StartApplicationFromAnalysis | null {
  const draft = projectReportForApplicationStart(report, applicantProfile, schemeId)
  if (!draft) return null

  const documents = projectDocumentsForApplication(report, draft.schemeId)

  // `profile` is used as-is: both the text (runAssistantTurn) and voice
  // (VoiceAssistantController) engines already keep `profile`/
  // `applicantProfile` in sync every turn (see AssistantContext.tsx /
  // voiceTurnMapping.ts), so it is already the complete, current UserProfile.
  // Re-deriving it from applicantProfile here would be lossy: every
  // ApplicantProfile->UserProfile adapter field the profile hasn't
  // (yet) been given a value for comes back as an explicit `undefined`,
  // which would silently overwrite a real value already on `profile` if
  // spread after it — never do that.
  return {
    schemeId: draft.schemeId,
    handoff: {
      schemeId: draft.schemeId,
      profile,
      conversation: {
        source: 'assistant',
        extractedProfile: {
          ...profile,
          // Informational only — the apply wizard's own document
          // requirements (src/apply/catalog.ts, keyed by the real scheme
          // spec) remain authoritative for what's actually required; this
          // is just the analysis's own trace of what it already flagged,
          // so a later step can show "the assistant already noted you'll
          // need these" without re-deriving it.
          __analysisDocuments: documents.map((d) => d.label),
          __analysisEligibilityStatus: draft.eligibilityStatus,
          __analysisReportId: draft.sourceReportId,
        },
        citedScheme: draft.schemeId,
      },
    },
  }
}

/** Convenience re-export so a component only needs one import for the whole handoff. */
export { projectDocumentsForApplication, projectReportForApplicationStart }
export type { ApplyHandoff }
