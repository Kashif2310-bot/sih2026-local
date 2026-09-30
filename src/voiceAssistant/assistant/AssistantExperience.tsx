import { useCallback, useState } from 'react'
import type { AdvisorView } from './advisor/advisor'
import type { SubmissionState } from './advisor/advisorSession'
import { ApplicationBoard } from './ApplicationBoard'
import { AssistantCharacter } from './AssistantCharacter'
import { RecommendationBoard } from './RecommendationBoard'
import { ReviewPanel } from './ReviewPanel'
import { SchemeDetailBoard } from './SchemeDetailBoard'
import { VoiceControl } from './VoiceControl'
import type { AssistantCallbacks } from './types'
import type { VoiceState } from './voiceState'

export interface AssistantExperienceProps extends AssistantCallbacks {
  voiceState: VoiceState
  advisor: AdvisorView
  submission: SubmissionState
  transcript?: string
  assistantTranscript?: string
  inputLevel?: number
  outputLevel?: number
  errorMessage?: string | null
  connecting?: boolean
  notice?: string | null
  /** Level of the assistant audio audible right now; drives the advisor's mouth. */
  getOutputLevel?: () => number
}

const CAPTION_WORDS = 18

function captionTail(text: string) {
  const words = text.trim().split(/\s+/).filter(Boolean)
  if (words.length <= CAPTION_WORDS) return words.join(' ')
  return `…${words.slice(-CAPTION_WORDS).join(' ')}`
}

export function AssistantExperience({
  voiceState,
  advisor,
  submission,
  transcript = '',
  assistantTranscript = '',
  inputLevel = 0,
  outputLevel = 0,
  errorMessage = null,
  connecting = false,
  notice = null,
  getOutputLevel,
  onStart,
  onStop,
  onInterrupt,
  onRetry,
  onSubmitText,
  onShowScheme,
  onChooseScheme,
  onCorrectField,
  onSetDocument,
  onSubmitApplication,
  onClearSubmission,
}: AssistantExperienceProps) {
  const [reviewing, setReviewing] = useState(false)
  const closeReview = useCallback(() => setReviewing(false), [])
  const speaker = voiceState === 'speaking' ? 'assistant' : 'user'
  const captionSource =
    voiceState === 'speaking' ? assistantTranscript : voiceState === 'listening' || voiceState === 'thinking' ? transcript : ''
  const caption = captionTail(captionSource)

  return (
    <main className={`experience experience--${voiceState}`}>
      <div className="environment" aria-hidden="true">
        <div className="environment__glow" />
        <div className="environment__arch environment__arch--outer" />
        <div className="environment__arch" />
        <div className="environment__floor" />
      </div>

      <aside className="experience__side experience__side--left" aria-label="Your application">
        <ApplicationBoard advisor={advisor} onFollowTop={() => onChooseScheme(null)} onReview={() => setReviewing(true)} />
      </aside>

      <section className="experience__center" aria-label="Ishaara assistant">
        <div className="stage">
          <span className="pedestal__shadow" aria-hidden="true" />
          <span className="pedestal__back" aria-hidden="true" />
          <AssistantCharacter voiceState={voiceState} getOutputLevel={getOutputLevel} />
          <span className="pedestal__side" aria-hidden="true" />
          <span className="pedestal__front" aria-hidden="true" />
        </div>

        <div className="dock">
          <p className={`caption caption--${speaker} ${caption ? 'is-visible' : ''}`} aria-hidden={!caption}>
            {caption}
          </p>
          <VoiceControl
            voiceState={voiceState}
            inputLevel={inputLevel}
            outputLevel={outputLevel}
            errorMessage={errorMessage}
            connecting={connecting}
            notice={notice}
            onStart={onStart}
            onStop={onStop}
            onInterrupt={onInterrupt}
            onRetry={onRetry}
            onSubmitText={onSubmitText}
          />
        </div>
      </section>

      <aside className="experience__side experience__side--right" aria-label="Matching schemes">
        <RecommendationBoard advisor={advisor} analyzing={voiceState === 'thinking'} onSelect={onShowScheme} />
        <SchemeDetailBoard advisor={advisor} onApply={onChooseScheme} onBack={() => onShowScheme(null)} />
      </aside>

      {(reviewing || submission.status === 'submitted') && (advisor.application || submission.status === 'submitted') && (
        <ReviewPanel
          advisor={advisor}
          submission={submission}
          onCorrectField={onCorrectField}
          onSetDocument={onSetDocument}
          onSubmitApplication={onSubmitApplication}
          onClearSubmission={onClearSubmission}
          onClose={closeReview}
        />
      )}
    </main>
  )
}
