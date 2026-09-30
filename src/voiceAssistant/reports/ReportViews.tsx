import { CRITERION_LABEL, type CriteriaReport } from '../application/criteria'
import type { FeasibilityReport } from '../application/feasibility'
import { formatRupees } from '../application/requirements'
import type { ReportSnapshotPayload } from '../application/submission'
import './reports.css'

const ELIGIBILITY_LABEL: Record<string, string> = {
  likely_eligible: 'Likely eligible',
  possibly_eligible: 'Possibly eligible',
  insufficient_data: 'Needs more details',
  likely_ineligible: 'Not eligible on current details',
}

/** Government criteria: the scheme's own rules, from curated scheme data. No score of Ishaara's own. */
export function CriteriaReportView({ report }: { report: CriteriaReport }) {
  return (
    <div className="report" data-testid="criteria-report">
      <header className="report__head">
        <div>
          <p className="report__kicker">Government criteria report</p>
          <h3 className="report__title">{report.schemeName}</h3>
          <p className="report__sub">{report.ministry}</p>
        </div>
        <div className="report__verdict">
          <span className="report__verdict-label">Matcher result</span>
          <strong>{ELIGIBILITY_LABEL[report.eligibility.status] ?? report.eligibility.status}</strong>
          <span className="report__verdict-sub">
            Eligibility score {report.eligibility.score}/100 · {report.eligibility.confidence} confidence
          </span>
        </div>
      </header>

      <p className="report__counts">
        {report.counts.satisfied} met · {report.counts.not_met} not met · {report.counts.needs_information} need information ·{' '}
        {report.counts.needs_verification} need verification
      </p>

      <table className="report__table">
        <thead>
          <tr>
            <th scope="col">Criterion</th>
            <th scope="col">Scheme requirement</th>
            <th scope="col">Applicant</th>
            <th scope="col">Result</th>
          </tr>
        </thead>
        <tbody>
          {report.criteria.map((row) => (
            <tr key={row.id} data-criterion={row.id} data-status={row.status}>
              <th scope="row">{row.label}</th>
              <td>
                {row.requirement}
                {row.note && <span className="report__note">{row.note}</span>}
              </td>
              <td>{row.applicantValue ?? '—'}</td>
              <td>
                <span className={`chip chip--${row.status}`}>{CRITERION_LABEL[row.status]}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {(report.benefits.loan || report.benefits.subsidy || report.benefits.interest) && (
        <dl className="report__facts">
          {report.benefits.loan && (
            <div>
              <dt>Loan</dt>
              <dd>{report.benefits.loan}</dd>
            </div>
          )}
          {report.benefits.subsidy && (
            <div>
              <dt>Subsidy</dt>
              <dd>{report.benefits.subsidy}</dd>
            </div>
          )}
          {report.benefits.interest && (
            <div>
              <dt>Interest</dt>
              <dd>{report.benefits.interest}</dd>
            </div>
          )}
        </dl>
      )}
      {report.schemeNotes.map((note) => (
        <p key={note} className="report__para">
          {note}
        </p>
      ))}
      <p className="report__source">
        Source: {report.source.name}. {report.source.dataStatus}. Last verified {report.source.lastVerifiedDate}.
      </p>
    </div>
  )
}

const WEATHER_SOURCE: Record<string, string> = { live: 'Live (Open-Meteo)', unavailable: 'Unavailable' }

/** Ishaara's own feasibility assessment: the main prototype's LokScore and its matrix. */
export function LokScoreReportView({ feasibility }: { feasibility: ReportSnapshotPayload['feasibility'] | { status: 'computing' } }) {
  if (feasibility.status !== 'ready') {
    return (
      <div className="report" data-testid="lokscore-report">
        <p className="report__kicker">Ishaara LokScore / feasibility report</p>
        <p className="report__para">
          {feasibility.status === 'computing' ? 'Checking the local market, weather and repayment plan…' : feasibility.reason}
        </p>
      </div>
    )
  }
  const report: FeasibilityReport = feasibility.report
  const { lokScore, plan, location } = report
  return (
    <div className="report" data-testid="lokscore-report">
      <header className="report__head">
        <div>
          <p className="report__kicker">Ishaara LokScore / feasibility report</p>
          <h3 className="report__title">
            {report.inputs.categoryLabel} in {location.name}
          </h3>
          <p className="report__sub">{location.provenanceLabel}</p>
        </div>
        <div className="report__score">
          <strong data-testid="lokscore-total">{lokScore.total}</strong>
          <span>/100 · Grade {lokScore.grade}</span>
          <span className="report__verdict-sub">
            Review quorum {lokScore.quorumRequired} of {lokScore.quorumPool}
            {lokScore.mentorRequired ? ' + mentor' : ''}
          </span>
        </div>
      </header>

      <table className="report__table">
        <thead>
          <tr>
            <th scope="col">Component</th>
            <th scope="col">Weight</th>
            <th scope="col">Score</th>
            <th scope="col">Weighted</th>
            <th scope="col">Basis</th>
          </tr>
        </thead>
        <tbody>
          {report.matrix.map((row) => (
            <tr key={row.id} data-component={row.id}>
              <th scope="row">{row.label}</th>
              <td>{row.weightPercent}%</td>
              <td>{row.score}</td>
              <td>{row.weighted}</td>
              <td className="report__basis">{row.basis.join(' ')}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <dl className="report__facts">
        <div>
          <dt>Repayment plan</dt>
          <dd>{plan.schemeName}</dd>
        </div>
        <div>
          <dt>Project / loan</dt>
          <dd>
            {formatRupees(plan.projectCost)} / {formatRupees(plan.loanAmount)}
          </dd>
        </div>
        <div>
          <dt>Margin</dt>
          <dd>
            {formatRupees(report.inputs.availableMargin)} · {report.inputs.marginBasisLabel}
          </dd>
        </div>
        {plan.quarterlyEmi > 0 && (
          <div>
            <dt>Quarterly instalment</dt>
            <dd>
              {formatRupees(plan.quarterlyEmi)} at {plan.interestRate}% over {plan.tenureYears} years
            </dd>
          </div>
        )}
        <div>
          <dt>Competitors</dt>
          <dd>
            {location.competitorQueryOk ? `${location.competitorCount} within ${location.radiusKm} km · ${report.saturationLabel}` : 'Live competitor data unavailable'}
          </dd>
        </div>
        <div>
          <dt>Weather</dt>
          <dd>
            {report.weather.source === 'live'
              ? `${report.weather.summary}, ${report.weather.tempMin}–${report.weather.tempMax}°C, rain chance ${report.weather.precipProb}%`
              : 'Unavailable'}{' '}
            · {WEATHER_SOURCE[report.weather.source]}
          </dd>
        </div>
        <div>
          <dt>Mandi signal</dt>
          <dd>
            {report.mandi ? `${report.mandi.commodity} ₹${report.mandi.modalPrice} ${report.mandi.unit}, ${report.mandi.trend} (curated seed)` : 'Not available for this location'}
          </dd>
        </div>
        <div>
          <dt>Experience</dt>
          <dd>{report.inputs.experienceYears} years</dd>
        </div>
      </dl>

      <div className="report__swot">
        {(['strengths', 'weaknesses', 'opportunities', 'threats'] as const).map((key) => (
          <div key={key}>
            <h4>{key.charAt(0).toUpperCase() + key.slice(1)}</h4>
            <ul>
              {report.swot[key].map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {report.failedSources.length > 0 && (
        <p className="report__warn">Live sources unavailable during this check: {report.failedSources.join(', ')}. Affected components use neutral values.</p>
      )}
      {report.notes.map((note) => (
        <p key={note} className="report__source">
          {note}
        </p>
      ))}
      <p className="report__source">Computed {new Date(report.computedAt).toLocaleString('en-IN')}.</p>
    </div>
  )
}

const FIELD_STATUS_LABEL: Record<string, string> = {
  complete: 'Complete',
  missing: 'Missing',
  optional: 'Optional',
  needs_confirmation: 'Confirm',
}

const DECLARATION_LABEL: Record<string, string> = {
  declared_available: 'Applicant has it',
  will_submit_on_portal: 'Will attach at filing',
  missing: 'Not yet',
}

/** The submitted application form, read-only, exactly as frozen. */
export function ApplicationFormView({ form, values }: { form: ReportSnapshotPayload['form']; values: Record<string, unknown> }) {
  const groups = ['applicant', 'location', 'business', 'finance']
  return (
    <div className="report" data-testid="application-form">
      <p className="report__kicker">Application form</p>
      <p className="report__counts">
        {form.readiness.fieldsDone}/{form.readiness.fieldsTotal} required fields · {form.readiness.documentsDone}/
        {form.readiness.documentsTotal} documents · {form.readiness.percent}% complete at submission
      </p>
      {groups.map((group) => {
        const fields = form.fields.filter((field) => field.group === group)
        if (fields.length === 0) return null
        return (
          <section key={group} className="report__section">
            <h4>{group.charAt(0).toUpperCase() + group.slice(1)}</h4>
            <dl className="report__fields">
              {fields.map((field) => (
                <div key={field.key} data-field={field.key}>
                  <dt>
                    {field.label}
                    {field.required ? '' : ' (optional)'}
                  </dt>
                  <dd>
                    {field.display ?? (values[field.key] !== undefined ? String(values[field.key]) : '—')}
                    {field.status === 'needs_confirmation' && <span className="chip chip--needs_verification">{FIELD_STATUS_LABEL[field.status]}</span>}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        )
      })}
      <section className="report__section">
        <h4>Documents</h4>
        <dl className="report__fields">
          {form.documents.map((doc) => (
            <div key={doc.key}>
              <dt>{doc.label}</dt>
              <dd>{doc.status === 'not_applicable' ? 'Not applicable' : DECLARATION_LABEL[doc.declaration]}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  )
}
