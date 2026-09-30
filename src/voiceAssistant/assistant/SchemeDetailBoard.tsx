import { useMemo } from 'react'
import { buildCriteriaReport, CRITERION_LABEL } from '../application/criteria'
import type { AdvisorView } from './advisor/advisor'
import { formatRupees, STATUS_LABEL } from './advisor/format'
import { FormFields, FormReadiness } from './FormFields'

interface SchemeDetailBoardProps {
  advisor: AdvisorView
  onApply: (schemeId: string) => void
  onBack: () => void
}

function loanRange(min?: number, max?: number): string | null {
  if (min !== undefined && max !== undefined) return `${formatRupees(min)} – ${formatRupees(max)}`
  if (max !== undefined) return `Up to ${formatRupees(max)}`
  if (min !== undefined) return `From ${formatRupees(min)}`
  return null
}

export function SchemeDetailBoard({ advisor, onApply, onBack }: SchemeDetailBoardProps) {
  const schemeId = advisor.detailSchemeId ?? advisor.application?.schemeId
  const focus = advisor.ranked.find((r) => r.scheme.id === schemeId)
  const criteria = useMemo(() => (focus ? buildCriteriaReport(advisor.profile, focus.scheme) : null), [focus, advisor.profile])
  if (!focus || !criteria) return null
  const { scheme, eligibility } = focus
  const loan = loanRange(scheme.loanAmount?.minRupees, scheme.loanAmount?.maxRupees)
  const isApplication = scheme.id === advisor.application?.schemeId
  const evaluated = criteria.criteria.filter((c) => c.status !== 'informational')
  const form = advisor.forms[scheme.id]
  const name = scheme.shortName ?? scheme.name
  const applicationKeys = new Set(advisor.application?.fields.map((f) => f.key))
  const ownFields = form && advisor.application ? form.fields.filter((f) => f.required && !applicationKeys.has(f.key)) : []
  const stillNeeded = form?.missing.map((item) => item.label.replace(/ \(INR\)$/, '').replace(/,.*$/, '')) ?? []

  return (
    <section className="board board--plan board--detail" aria-labelledby="detail-title" data-scheme={scheme.id}>
      <header className="board__header">
        <h2 id="detail-title" className="board__eyebrow">
          {isApplication ? 'Scheme you are applying for' : 'Scheme details'}
        </h2>
        <p className="board__headline">{scheme.shortName ?? scheme.name}</p>
        <p className="detail__ministry">{scheme.ministry}</p>
      </header>

      <p className="detail__desc">{scheme.description}</p>

      <dl className="detail__facts">
        <div>
          <dt>Match</dt>
          <dd>
            {focus.rankScore}% · {STATUS_LABEL[eligibility.status]}
          </dd>
        </div>
        <div>
          <dt>Eligibility score</dt>
          <dd>{eligibility.score} / 100</dd>
        </div>
        {loan && (
          <div>
            <dt>Loan</dt>
            <dd>{loan}</dd>
          </div>
        )}
        {scheme.interest?.ratePercent !== undefined && (
          <div>
            <dt>Interest</dt>
            <dd>{scheme.interest.ratePercent}% p.a.</dd>
          </div>
        )}
        {scheme.subsidy && (
          <div className="detail__wide">
            <dt>Subsidy</dt>
            <dd>{scheme.subsidy.description}</dd>
          </div>
        )}
      </dl>

      <ul className="detail__criteria" aria-label="Eligibility rules">
        {evaluated.map((row) => (
          <li key={row.id} data-status={row.status}>
            <span>{row.label}</span>
            <span className={`chip chip--${row.status}`}>{CRITERION_LABEL[row.status]}</span>
          </li>
        ))}
      </ul>

      {isApplication ? null : form ? (
        <section className="detail__form" aria-labelledby="detail-form-title" data-testid="scheme-form" data-scheme={scheme.id}>
          <h3 id="detail-form-title" className="detail__form-title">
            {name} application form
          </h3>
          <p className="detail__form-note">
            Filled from the same answers as your application.
            {ownFields.length > 0 && ` It also asks for ${ownFields.map((f) => f.label.replace(/ \(INR\)$/, '')).join(', ')}.`}
          </p>
          <FormReadiness form={form} label={`${name} form readiness`} testId="scheme-form-readiness" />
          {stillNeeded.length > 0 && (
            <p className="form__next" data-testid="scheme-form-needed">
              Still needed for {name}: {stillNeeded.slice(0, 5).join(', ')}
              {stillNeeded.length > 5 ? ` and ${stillNeeded.length - 5} more` : ''}
            </p>
          )}
          <FormFields form={form} />
        </section>
      ) : (
        <p className="detail__form-note" data-testid="scheme-form-none">
          No form is filled for {name}: on your current details you do not meet at least one of its rules.
        </p>
      )}

      <div className="detail__actions">
        {isApplication ? (
          <span className="detail__applying">Your application is for this scheme</span>
        ) : (
          <>
            <button type="button" className="detail__apply" onClick={() => onApply(scheme.id)} data-testid="apply-for-scheme">
              Apply for this scheme
            </button>
            <button type="button" className="app__follow" onClick={onBack}>
              Back to your application
            </button>
          </>
        )}
      </div>

      <p className="detail__source">
        Curated reference data, last verified {scheme.lastVerifiedDate}. Not a live government check.{' '}
        <a href={scheme.officialInfoUrl} target="_blank" rel="noreferrer">
          Official scheme information
        </a>
      </p>
    </section>
  )
}
