import { useEffect, useRef, useState } from 'react'
import { GROUP_LABEL, type FieldGroup, type FormField } from '../application/requirements'
import { consentTextFor } from '../../apply/channels'
import type { DocumentDeclaration } from '../../apply/types'
import { CriteriaReportView, LokScoreReportView } from '../reports/ReportViews'
import type { AdvisorView } from './advisor/advisor'
import type { SubmissionState } from './advisor/advisorSession'
import type { ApplicationCallbacks } from './types'

interface ReviewPanelProps extends Pick<ApplicationCallbacks, 'onCorrectField' | 'onSetDocument' | 'onSubmitApplication' | 'onClearSubmission'> {
  advisor: AdvisorView
  submission: SubmissionState
  onClose: () => void
}

const GROUPS: FieldGroup[] = ['applicant', 'location', 'business', 'finance']

function EditableField({
  fieldKey,
  label,
  display,
  status,
  note,
  required,
  onCorrect,
}: {
  fieldKey: string
  label: string
  display: string | null
  status: FormField['status']
  note?: string
  required: boolean
  onCorrect: ApplicationCallbacks['onCorrectField']
}) {
  const [value, setValue] = useState(display ?? '')
  const [error, setError] = useState<string | undefined>()

  const commit = () => {
    if (value.trim() === (display ?? '')) return
    setError(onCorrect(fieldKey, value))
  }

  return (
    <div className={`review__field review__field--${status}`} data-field={fieldKey}>
      <label htmlFor={`review-${fieldKey}`}>
        {label.replace(/ \(INR\)$/, '')}
        {!required && <span className="review__optional"> optional</span>}
      </label>
      <input
        id={`review-${fieldKey}`}
        value={value}
        placeholder={required ? 'Required' : ''}
        onChange={(event) => setValue(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit()
        }}
        aria-invalid={Boolean(error) || status === 'missing'}
      />
      {error ? <p className="review__error">{error}</p> : note ? <p className="review__note">{note}</p> : null}
    </div>
  )
}

export function ReviewPanel({ advisor, submission, onCorrectField, onSetDocument, onSubmitApplication, onClearSubmission, onClose }: ReviewPanelProps) {
  const form = advisor.application
  const [consent, setConsent] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    dialogRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  if (submission.status === 'submitted') {
    const app = submission.application
    return (
      <div className="review" role="dialog" aria-modal="true" aria-labelledby="review-title">
        <div className="review__sheet review__sheet--done" ref={dialogRef} tabIndex={-1}>
          <p className="report__kicker">Submitted to Ishaara</p>
          <h2 id="review-title" className="review__title">
            {app.schemeName} application sent for review
          </h2>
          <dl className="review__receipt" data-testid="submission-receipt">
            <div>
              <dt>Application ID</dt>
              <dd data-testid="application-id">{app.applicationId}</dd>
            </div>
            <div>
              <dt>Tracking ID</dt>
              <dd>{app.trackingId}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{app.honestLabel}</dd>
            </div>
          </dl>
          <p className="review__para">
            Your application form, its government criteria report and its Ishaara LokScore report were sealed together and
            sent to the Ishaara review team. Nothing has been filed with a government office yet.
          </p>
          <div className="review__actions">
            <a className="review__secondary" href={`#admin/${app.applicationId}`}>
              Open in admin
            </a>
            <button
              type="button"
              className="review__primary"
              onClick={() => {
                onClearSubmission()
                onClose()
              }}
            >
              Done
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (!form) return null
  const consentText = consentTextFor(form.channel, false)
  const blocking = form.readiness.blocking
  const canSubmit = form.readiness.canSubmit && consent && submission.status !== 'submitting'

  return (
    <div className="review" role="dialog" aria-modal="true" aria-labelledby="review-title" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="review__sheet" ref={dialogRef} tabIndex={-1}>
        <header className="review__head">
          <div>
            <p className="report__kicker">Review your application</p>
            <h2 id="review-title" className="review__title">
              {form.schemeName}
            </h2>
            <p className="review__para">
              Check every detail. Changes here update the same application Ishaara is filling with you.
            </p>
          </div>
          <button type="button" className="review__close" onClick={onClose} aria-label="Close review">
            ×
          </button>
        </header>

        <p className="form__readiness">
          <span>
            <strong>
              {form.readiness.fieldsDone}/{form.readiness.fieldsTotal}
            </strong>{' '}
            required fields
          </span>
          <span>
            <strong>
              {form.readiness.documentsDone}/{form.readiness.documentsTotal}
            </strong>{' '}
            documents
          </span>
          <span className="form__percent">{form.readiness.percent}% ready</span>
        </p>

        <section className="review__section" aria-labelledby="review-form">
          <h3 id="review-form" className="review__h">
            Application form
          </h3>
          {GROUPS.map((group) => {
            const fields = form.fields.filter((field) => field.group === group)
            if (fields.length === 0) return null
            return (
              <fieldset key={group} className="review__group">
                <legend>{GROUP_LABEL[group]}</legend>
                <div className="review__grid">
                  {fields.map((field) => (
                    <EditableField
                      key={`${field.key}:${field.display ?? ''}`}
                      fieldKey={field.key}
                      label={field.label}
                      display={field.display}
                      status={field.status}
                      note={field.note}
                      required={field.required}
                      onCorrect={onCorrectField}
                    />
                  ))}
                </div>
              </fieldset>
            )
          })}
          <fieldset className="review__group">
            <legend>For the Ishaara feasibility report</legend>
            <div className="review__grid">
              <EditableField
                key={`experience:${advisor.details.experienceYears ?? ''}`}
                fieldKey="experience_years"
                label="Years of experience"
                display={advisor.details.experienceYears !== undefined ? String(advisor.details.experienceYears) : null}
                status={advisor.details.experienceYears !== undefined ? 'complete' : 'optional'}
                note="Not part of the scheme form. Used only for the LokScore report."
                required={false}
                onCorrect={onCorrectField}
              />
            </div>
          </fieldset>
          <fieldset className="review__group">
            <legend>Documents</legend>
            <div className="review__docs">
              {form.documents.map((doc) => (
                <label key={doc.key} className={`review__doc review__doc--${doc.status}`} data-document={doc.kind ?? doc.key}>
                  <span>{doc.label}</span>
                  {doc.status === 'not_applicable' ? (
                    <em>Not applicable to you</em>
                  ) : (
                    <select
                      value={doc.declaration}
                      disabled={!doc.kind}
                      onChange={(event) => doc.kind && onSetDocument(doc.kind, event.target.value as DocumentDeclaration)}
                    >
                      <option value="missing">Not yet</option>
                      <option value="declared_available">I have it</option>
                      <option value="will_submit_on_portal">Will attach when filing</option>
                    </select>
                  )}
                </label>
              ))}
            </div>
            <p className="review__note">Ishaara records what you declare. No files are uploaded from here.</p>
          </fieldset>
        </section>

        {advisor.criteria && (
          <section className="review__section">
            <CriteriaReportView report={advisor.criteria} />
          </section>
        )}

        <section className="review__section">
          <LokScoreReportView
            feasibility={
              advisor.feasibility.status === 'ready'
                ? { status: 'ready', report: advisor.feasibility.report }
                : advisor.feasibility.status === 'computing'
                  ? { status: 'computing' }
                  : {
                      status: 'unavailable',
                      reason:
                        advisor.feasibility.status === 'waiting'
                          ? `Needs ${advisor.feasibility.missing.map((m) => m.label.toLowerCase()).join(', ')} before it can be computed. You can still submit; the report will say it was not computed.`
                          : advisor.feasibility.reason,
                    }
            }
          />
        </section>

        <section className="review__section review__submit">
          {blocking.length > 0 && (
            <div className="review__blocking" data-testid="blocking-issues">
              <p>Before you can submit:</p>
              <ul>
                {blocking.slice(0, 8).map((issue) => (
                  <li key={`${issue.code}:${issue.field}`}>{issue.message}</li>
                ))}
              </ul>
            </div>
          )}
          <label className="review__consent">
            <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} disabled={!form.readiness.canSubmit} />
            <span>{consentText}</span>
          </label>
          {submission.status === 'failed' && <p className="review__error">{submission.error}</p>}
          <div className="review__actions">
            <button type="button" className="review__secondary" onClick={onClose}>
              Keep talking
            </button>
            <button
              type="button"
              className="review__primary"
              disabled={!canSubmit}
              data-testid="submit-application"
              onClick={() => void onSubmitApplication(consent)}
            >
              {submission.status === 'submitting' ? 'Submitting…' : 'Submit to Ishaara'}
            </button>
          </div>
          <p className="review__note">
            Official scheme information:{' '}
            <a href={form.officialInfoUrl} target="_blank" rel="noreferrer">
              {form.officialInfoUrl.replace(/^https?:\/\//, '').split('/')[0]}
            </a>
          </p>
        </section>
      </div>
    </div>
  )
}
