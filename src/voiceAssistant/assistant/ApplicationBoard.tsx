import type { AdvisorView } from './advisor/advisor'
import { profileFacts } from './advisor/format'
import { FormFields, FormReadiness } from './FormFields'
import { LokScoreStatus } from './LokScoreStatus'

interface ApplicationBoardProps {
  advisor: AdvisorView
  onFollowTop: () => void
  onReview: () => void
}

export function ApplicationBoard({ advisor, onFollowTop, onReview }: ApplicationBoardProps) {
  const form = advisor.application
  const next = advisor.nextQuestion

  if (!form) {
    const facts = profileFacts(advisor.profile, advisor.details, advisor.documents)
    return (
      <section className="board board--application" aria-labelledby="application-title">
        <span className="board__pin board__pin--left" aria-hidden="true" />
        <span className="board__pin board__pin--right" aria-hidden="true" />
        <header className="board__header">
          <h2 id="application-title" className="board__eyebrow">
            Your application
          </h2>
          <p className="board__headline">{facts.length === 0 ? 'Starts as you talk' : 'Finding your scheme'}</p>
        </header>
        {facts.length === 0 ? (
          <p className="recs__empty">
            Tell Ishaara about yourself and your business. The application form for your best-matching scheme fills in
            here as you answer.
          </p>
        ) : (
          <ul className="form__rows" aria-live="polite">
            {facts.map((fact) => (
              <li key={`${fact.key}:${fact.value}`} className="form__row form__row--complete" data-field={fact.key}>
                <span className="form__mark" role="img" aria-label="Captured" />
                <span className="form__label">{fact.label}</span>
                <span className="form__value">{fact.value}</span>
              </li>
            ))}
          </ul>
        )}
        {next && <p className="form__next">Next: {next.question}</p>}
      </section>
    )
  }

  const { readiness } = form
  const alsoFilling = Object.keys(advisor.forms).length - 1

  return (
    <section className="board board--application" aria-labelledby="application-title" data-scheme={form.schemeId}>
      <span className="board__pin board__pin--left" aria-hidden="true" />
      <span className="board__pin board__pin--right" aria-hidden="true" />

      <header className="board__header">
        <h2 id="application-title" className="board__eyebrow">
          Your application
        </h2>
        <p className="board__headline" data-testid="application-scheme">
          {form.schemeName}
        </p>
        <p className="app__meta">
          {form.basis === 'top_match' ? (
            <span>Follows your top match{advisor.applicationMatch ? ` · ${advisor.applicationMatch.matchPercent}% match` : ''}</span>
          ) : form.schemeId === advisor.top?.id ? (
            <span>Your chosen scheme, also your top match</span>
          ) : (
            <>
              <span>Your chosen scheme</span>
              <button type="button" className="app__follow" onClick={onFollowTop}>
                Follow top match
              </button>
            </>
          )}
        </p>
      </header>

      <FormReadiness form={form} label="Application readiness" testId="application-readiness" />

      {next && (
        <p className="form__next" data-testid="next-question">
          Next: {next.question}
        </p>
      )}

      <FormFields form={form} />

      {alsoFilling > 0 && (
        <p className="app__also" data-testid="also-filling">
          Your answers are also filling {alsoFilling} other matching scheme {alsoFilling === 1 ? 'form' : 'forms'}. Tap a scheme on
          the right to see its form.
        </p>
      )}

      <LokScoreStatus advisor={advisor} compact />

      <button type="button" className="form__review" onClick={onReview} data-testid="review-application">
        {readiness.canSubmit ? 'Review and submit' : 'Review application'}
      </button>
    </section>
  )
}
