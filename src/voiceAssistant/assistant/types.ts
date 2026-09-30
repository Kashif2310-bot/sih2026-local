import type { DocumentKind } from '../application/documents'
import type { SubmitOutcome } from '../application/submission'
import type { DocumentDeclaration } from '../../apply/types'
import type { AdvisorView } from './advisor/advisor'
import type { SubmissionState } from './advisor/advisorSession'
import type { VoiceLanguage } from './advisor/systemInstruction'
import type { VoiceState } from './voiceState'

/**
 * Everything the UI renders. Both runtimes (Gemini Live, and the offline
 * `?mode=demo` script) produce this shape; the advisor view is always
 * derived from that runtime's own advisor state by the real engine.
 */
export interface AssistantSnapshot {
  voiceState: VoiceState
  advisor: AdvisorView
  submission: SubmissionState
  language: VoiceLanguage
  transcript: string
  assistantTranscript: string
  /** Microphone activity, 0..1. */
  inputLevel: number
  /** Assistant audio activity, 0..1. */
  outputLevel: number
  errorMessage: string | null
}

export interface ApplicationCallbacks {
  /** Open a scheme's details; null shows the scheme being applied for. Never changes the application. */
  onShowScheme: (schemeId: string | null) => void
  /** Apply for this scheme instead; null follows the live top match again. */
  onChooseScheme: (schemeId: string | null) => void
  /** Returns an error message when the value cannot be used. */
  onCorrectField: (key: string, value: string) => string | undefined
  onSetDocument: (kind: DocumentKind, declaration: DocumentDeclaration) => void
  onSubmitApplication: (consentAccepted: boolean) => Promise<SubmitOutcome>
  onClearSubmission: () => void
}

export interface AssistantCallbacks extends ApplicationCallbacks {
  onStart: () => void
  onStop: () => void
  onInterrupt: () => void
  onRetry: () => void
  onSubmitText: (text: string) => void
}
