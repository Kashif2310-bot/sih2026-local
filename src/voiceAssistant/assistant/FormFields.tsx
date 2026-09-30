import { GROUP_LABEL, type ApplicationForm, type FieldGroup, type FieldStatus, type FormField } from '../application/requirements'

const GROUPS: FieldGroup[] = ['applicant', 'location', 'business', 'finance']

const STATUS_TEXT: Record<FieldStatus, string> = {
  complete: 'Complete',
  missing: 'Required, missing',
  optional: 'Optional',
  needs_confirmation: 'Please confirm',
}

function FieldRow({ field }: { field: FormField }) {
  return (
    <li
      className={`form__row form__row--${field.status}`}
      data-field={field.key}
      data-status={field.status}
      title={field.note}
    >
      <span className="form__mark" role="img" aria-label={STATUS_TEXT[field.status]} />
      <span className="form__label">{field.label.replace(/ \(INR\)$/, '')}</span>
      <span className="form__value">{field.display ?? (field.required ? 'Needed' : '—')}</span>
    </li>
  )
}

export function FormReadiness({ form, label, testId }: { form: ApplicationForm; label: string; testId: string }) {
  const { readiness } = form
  return (
    <>
      <div className="form__readiness" data-testid={testId}>
        <span>
          <strong>
            {readiness.fieldsDone}/{readiness.fieldsTotal}
          </strong>{' '}
          required fields
        </span>
        <span>
          <strong>
            {readiness.documentsDone}/{readiness.documentsTotal}
          </strong>{' '}
          documents
        </span>
        <span className="form__percent">{readiness.percent}%</span>
      </div>
      <div
        className="board__progress"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={readiness.percent}
      >
        <span style={{ transform: `scaleX(${readiness.percent / 100})` }} />
      </div>
    </>
  )
}

/** A scheme's form fields by group, then its documents, as filled from the citizen's answers. */
export function FormFields({ form }: { form: ApplicationForm }) {
  const docsApplying = form.documents.filter((doc) => doc.status !== 'not_applicable')
  return (
    <div className="form__groups" aria-live="polite">
      {GROUPS.map((group) => {
        const fields = form.fields.filter((field) => field.group === group)
        if (fields.length === 0) return null
        return (
          <div key={group} className="form__group">
            <h3 className="form__group-title">{GROUP_LABEL[group]}</h3>
            <ul className="form__rows">
              {fields.map((field) => (
                // Remounting on a new value replays the one-shot fill highlight.
                <FieldRow key={`${field.key}:${field.display ?? ''}`} field={field} />
              ))}
            </ul>
          </div>
        )
      })}

      <div className="form__group">
        <h3 className="form__group-title">Documents</h3>
        <ul className="form__rows">
          {docsApplying.map((doc) => (
            <li
              key={`${doc.key}:${doc.declaration}`}
              className={`form__row form__row--${doc.status === 'complete' ? 'complete' : doc.required ? 'missing' : 'optional'}`}
              data-document={doc.kind ?? doc.key}
            >
              <span className="form__mark" role="img" aria-label={doc.status === 'complete' ? 'Declared' : 'Not declared'} />
              <span className="form__label">{doc.label.replace(/,.*$/, '')}</span>
              <span className="form__value">
                {doc.declaration === 'declared_available' ? 'Have it' : doc.declaration === 'will_submit_on_portal' ? 'Will attach' : 'Needed'}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
