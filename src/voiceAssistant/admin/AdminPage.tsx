import { useEffect, useState, useSyncExternalStore } from 'react'
import type { ApplicationStore } from '../application/store'
import {
  ADMIN_STATUS_LABEL,
  checkIntegrity,
  type AdminStatus,
  type IntegrityCheck,
  type ReportSnapshotPayload,
  type SubmittedApplication,
} from '../application/submission'
import { ApplicationFormView, CriteriaReportView, LokScoreReportView } from '../reports/ReportViews'
import './admin.css'

interface AdminPageProps {
  store: ApplicationStore
  applicationId: string | null
}

type Tab = 'form' | 'criteria' | 'lokscore' | 'audit'

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'form', label: 'Application form' },
  { id: 'criteria', label: 'Government criteria report' },
  { id: 'lokscore', label: 'Ishaara LokScore report' },
  { id: 'audit', label: 'Status & audit' },
]

function useApplications(store: ApplicationStore): SubmittedApplication[] {
  return useSyncExternalStore(
    (listener) => {
      const unsubscribe = store.subscribe(listener)
      window.addEventListener('storage', listener)
      return () => {
        unsubscribe()
        window.removeEventListener('storage', listener)
      }
    },
    () => store.snapshot(),
  )
}

const payloadOf = (app: SubmittedApplication) => app.reportSnapshot.payload as unknown as ReportSnapshotPayload

function lokScoreText(payload: ReportSnapshotPayload): string {
  return payload.feasibility.status === 'ready'
    ? `${payload.feasibility.report.lokScore.total} · ${payload.feasibility.report.lokScore.grade}`
    : 'Not computed'
}

function ApplicationList({ applications }: { applications: SubmittedApplication[] }) {
  return (
    <section className="admin__panel">
      <header className="admin__head">
        <div>
          <p className="admin__kicker">Ishaara review desk</p>
          <h1 className="admin__title">Submitted applications</h1>
        </div>
        <p className="admin__note">Stored in this browser. Applications submitted from the assistant on this device appear here.</p>
      </header>
      {applications.length === 0 ? (
        <p className="admin__empty">
          No applications yet. Complete one with the <a href="#assistant">assistant</a> and submit it.
        </p>
      ) : (
        <table className="admin__table" data-testid="admin-list">
          <thead>
            <tr>
              <th scope="col">Application</th>
              <th scope="col">Applicant</th>
              <th scope="col">Scheme</th>
              <th scope="col">Criteria</th>
              <th scope="col">LokScore</th>
              <th scope="col">Submitted</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {applications.map((app) => {
              const payload = payloadOf(app)
              const counts = payload.criteriaReport.counts
              return (
                <tr key={app.applicationId}>
                  <td>
                    <a href={`#admin/${app.applicationId}`}>{app.applicationId}</a>
                  </td>
                  <td>{app.applicantName}</td>
                  <td>{app.schemeName}</td>
                  <td>
                    {counts.satisfied} met{counts.not_met > 0 ? ` · ${counts.not_met} not met` : ''}
                  </td>
                  <td>{lokScoreText(payload)}</td>
                  <td>{new Date(app.submittedAt).toLocaleString('en-IN')}</td>
                  <td>
                    <span className={`admin__status admin__status--${app.status}`}>{ADMIN_STATUS_LABEL[app.status]}</span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </section>
  )
}

function IntegrityBadges({ check }: { check: IntegrityCheck | null }) {
  if (!check) return <span className="admin__badge">Verifying snapshots…</span>
  const ok = check.applicationSnapshotValid && check.reportSnapshotValid && check.reportsBoundToApplication
  return (
    <span className={`admin__badge ${ok ? 'is-ok' : 'is-bad'}`} data-testid="integrity">
      {ok
        ? 'Snapshots verified: form and reports unchanged since submission'
        : `Integrity problem: ${[
            !check.applicationSnapshotValid && 'application snapshot altered',
            !check.reportSnapshotValid && 'report snapshot altered',
            !check.reportsBoundToApplication && 'reports do not belong to this application',
          ]
            .filter(Boolean)
            .join(', ')}`}
    </span>
  )
}

const ACTIONS: AdminStatus[] = ['under_review', 'needs_correction', 'approved', 'rejected']

function ApplicationDetail({ app, store }: { app: SubmittedApplication; store: ApplicationStore }) {
  const [tab, setTab] = useState<Tab>('form')
  const [check, setCheck] = useState<IntegrityCheck | null>(null)
  const [note, setNote] = useState('')
  const payload = payloadOf(app)

  useEffect(() => {
    let active = true
    void checkIntegrity(app).then((result) => {
      if (active) setCheck(result)
    })
    return () => {
      active = false
    }
  }, [app])

  return (
    <section className="admin__panel" data-testid="admin-detail">
      <a className="admin__back" href="#admin">
        ← All applications
      </a>
      <header className="admin__head">
        <div>
          <p className="admin__kicker">
            {app.applicationId} · tracking {app.trackingId}
          </p>
          <h1 className="admin__title">
            {app.applicantName} · {app.schemeName}
          </h1>
          <p className="admin__note">
            Submitted {new Date(app.submittedAt).toLocaleString('en-IN')} · {payload.implementingMinistry} · match {payload.match.matchPercent}% (rank{' '}
            {payload.match.rank}, {payload.match.basis === 'top_match' ? 'top match' : 'chosen by applicant'})
          </p>
        </div>
        <span className={`admin__status admin__status--${app.status}`}>{ADMIN_STATUS_LABEL[app.status]}</span>
      </header>
      <IntegrityBadges check={check} />

      <div className="admin__tabs" role="tablist" aria-label="Application package">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={`admin__tab ${tab === item.id ? 'is-active' : ''}`}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="admin__sheet" role="tabpanel">
        {tab === 'form' && (
          <ApplicationFormView form={payload.form} values={app.applicationSnapshot.payload.fields as Record<string, unknown>} />
        )}
        {tab === 'criteria' && <CriteriaReportView report={payload.criteriaReport} />}
        {tab === 'lokscore' && (
          <>
            <LokScoreReportView feasibility={payload.feasibility} />
            {payload.routing && (
              <div className="report">
                <p className="report__kicker">Ministry routing (main prototype rules)</p>
                <p className="report__para">
                  Lead: {payload.routing.leadMinistry}. Supporting: {payload.routing.supportingMinistries.join(', ')}.
                </p>
                <ul className="report__list">
                  {payload.routing.rationale.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
        {tab === 'audit' && (
          <div className="report">
            <p className="report__kicker">Status & audit</p>
            <dl className="report__fields">
              <div>
                <dt>Filing outcome</dt>
                <dd>
                  {app.honestLabel}. {app.filedWithGovernment ? 'Filed with a government system.' : 'Not filed with any government system.'}
                </dd>
              </div>
              <div>
                <dt>Consent</dt>
                <dd>
                  “{app.consent.text}” — accepted {app.consent.acceptedAt ? new Date(app.consent.acceptedAt).toLocaleString('en-IN') : 'no'}
                </dd>
              </div>
              <div>
                <dt>Application snapshot</dt>
                <dd className="admin__hash">{app.applicationSnapshot.snapshotHash}</dd>
              </div>
              <div>
                <dt>Report snapshot</dt>
                <dd className="admin__hash">{app.reportSnapshot.snapshotHash}</dd>
              </div>
            </dl>
            <div className="admin__actions">
              <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Reviewer note (optional)" aria-label="Reviewer note" />
              {ACTIONS.map((status) => (
                <button
                  key={status}
                  type="button"
                  className="admin__action"
                  disabled={app.status === status}
                  onClick={() => {
                    store.setStatus(app.applicationId, status, note.trim() || `Marked ${ADMIN_STATUS_LABEL[status].toLowerCase()}.`)
                    setNote('')
                  }}
                >
                  {ADMIN_STATUS_LABEL[status]}
                </button>
              ))}
            </div>
            <ol className="admin__audit">
              {[...app.auditTrail].reverse().map((entry, index) => (
                <li key={`${entry.at}:${index}`}>
                  <time>{new Date(entry.at).toLocaleString('en-IN')}</time>
                  <strong>{entry.action.replace(/_/g, ' ')}</strong>
                  <span>{entry.note}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </section>
  )
}

export function AdminPage({ store, applicationId }: AdminPageProps) {
  const applications = useApplications(store)
  const selected = applicationId ? applications.find((app) => app.applicationId === applicationId) : undefined
  return (
    <main className="admin">
      {applicationId && !selected ? (
        <section className="admin__panel">
          <a className="admin__back" href="#admin">
            ← All applications
          </a>
          <p className="admin__empty">No application {applicationId} is stored in this browser.</p>
        </section>
      ) : selected ? (
        <ApplicationDetail key={selected.applicationId} app={selected} store={store} />
      ) : (
        <ApplicationList applications={applications} />
      )}
    </main>
  )
}
