import { useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Shield } from 'lucide-react'
import clsx from 'clsx'
import { appendAudit, getApplication, setStatus, updateApplication } from '../../platform/store'
import { MINISTRIES, routeApplication } from '../../platform/ministries'
import type { ApplicationStatus, DocumentRecord } from '../../platform/types'
import { formatINR } from '../../lib/finance'
import {
  ApprovalError,
  authorizeApprovalDisbursement,
  ensureApprovalCase,
  lokScoreForApproval,
  peekApprovalCase,
  submitApprovalSignature,
} from '../../platform/approvalBridge'
import { StatusPipeline } from '../../components/StatusPipeline'
import type { ApprovalCaseView } from '../../lib/approval/views'
import { useAdminAuth } from '../useAdminAuth'

type TabId =
  | 'routing'
  | 'details'
  | 'documents'
  | 'profile'
  | 'lokscore'
  | 'approvalRequirement'
  | 'reviewers'
  | 'multisig'
  | 'status'

const TABS: TabId[] = [
  'routing',
  'details',
  'documents',
  'profile',
  'lokscore',
  'approvalRequirement',
  'reviewers',
  'multisig',
  'status',
]

export function AdminApplicationDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { t, i18n } = useTranslation()
  const kn = i18n.language === 'kn'
  const { session } = useAdminAuth()
  const [tab, setTab] = useState<TabId>('routing')
  const [version, setVersion] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [approval, setApproval] = useState<ApprovalCaseView | null>(null)

  const reload = () => setVersion((v) => v + 1)
  void version
  const app = id ? (getApplication(id) ?? null) : null

  if (!id || !app) return <Navigate to="/admin/applications" replace />

  const routing = routeApplication({
    category: app.applicant.category,
    gender: app.applicant.gender,
    community: app.applicant.community,
  })

  const actor = session?.name ?? 'Admin'
  const scoreLike = lokScoreForApproval(app)
  const caseView = approval ?? peekApprovalCase(app.id)

  const openCase = () => {
    setErr(null)
    try {
      const view = ensureApprovalCase(app)
      setApproval(view)
      if (app.status === 'submitted' || app.status === 'under_review') {
        setStatus(app.id, 'reviewer_assigned', actor, 'Jordan approval service allocated reviewers')
        reload()
      }
      return view
    } catch (e) {
      setErr(e instanceof ApprovalError ? `${e.code}: ${e.message}` : e instanceof Error ? e.message : 'Open failed')
      return null
    }
  }

  const onAssignReviewers = () => {
    openCase()
    reload()
  }

  const onSign = async (reviewerId: string) => {
    setBusy(reviewerId)
    setErr(null)
    try {
      const view = await submitApprovalSignature(app, reviewerId, actor)
      setApproval(view)
      reload()
    } catch (e) {
      setErr(e instanceof ApprovalError ? `${e.code}: ${e.message}` : e instanceof Error ? e.message : 'Sign failed')
    } finally {
      setBusy(null)
    }
  }

  const onAuthorize = () => {
    setErr(null)
    try {
      const view = authorizeApprovalDisbursement(app, actor)
      setApproval(view)
      reload()
    } catch (e) {
      setErr(e instanceof ApprovalError ? `${e.code}: ${e.message}` : e instanceof Error ? e.message : 'Authorize failed')
    }
  }

  const patchDocument = (docId: string, patch: Partial<DocumentRecord>) => {
    const documents = app.documents.map((d) => (d.id === docId ? { ...d, ...patch } : d))
    updateApplication(app.id, { documents })
    appendAudit(app.id, {
      actor: session?.name ?? 'Admin',
      action: `document_${patch.status ?? 'updated'}`,
      detail: docId,
    })
    reload()
  }

  const changeStatus = (status: ApplicationStatus, detail?: string) => {
    setStatus(app.id, status, session?.name ?? 'Admin', detail)
    reload()
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/admin/applications" className="text-sm font-semibold text-forest hover:underline">
            ← {t('admin.review.backToList')}
          </Link>
          <h1 className="mt-2 font-display text-2xl font-bold text-forest sm:text-3xl">
            {app.applicant.name}
          </h1>
          <p className="mt-1 font-mono text-xs text-ink/50">{app.id}</p>
        </div>
        <span className="rounded-full bg-mist px-3 py-1 text-sm font-semibold text-forest">
          {t(`admin.status.${app.status}`)}
        </span>
      </div>

      <div className="flex gap-1 overflow-x-auto pb-1">
        {TABS.map((idTab) => (
          <button
            key={idTab}
            type="button"
            onClick={() => setTab(idTab)}
            className={clsx(
              'shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition',
              tab === idTab ? 'bg-forest text-white' : 'bg-white text-ink/70 hover:bg-mist',
            )}
          >
            {t(`admin.review.tabs.${idTab}`)}
          </button>
        ))}
      </div>

      <div className="rounded-2xl border border-forest/10 bg-white p-5">
        {tab === 'routing' && (
          <section className="space-y-4">
            <h2 className="font-display text-xl font-bold text-forest">{t('admin.review.routing.title')}</h2>
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-ink/70">
              {t('admin.review.routing.simulatedNote')}
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border-2 border-forest bg-mist/40 p-4">
                <p className="text-[10px] font-bold uppercase tracking-wide text-forest">
                  {t('admin.review.routing.leadBadge')}
                </p>
                <p className="mt-1 font-medium">
                  {kn ? MINISTRIES[app.leadMinistryId].nameKn : MINISTRIES[app.leadMinistryId].name}
                </p>
                <p className="mt-1 text-xs text-ink/50">{t('admin.review.routing.lead')}</p>
              </div>
              {app.supportingMinistryIds.map((m) => (
                <div key={m} className="rounded-2xl border border-forest/15 bg-white p-4">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-ink/45">
                    {t('admin.review.routing.supportingBadge')}
                  </p>
                  <p className="mt-1 font-medium">{kn ? MINISTRIES[m].nameKn : MINISTRIES[m].name}</p>
                </div>
              ))}
            </div>
            <div>
              <p className="text-xs font-semibold uppercase text-ink/45">{t('admin.review.routing.rationale')}</p>
              <ul className="mt-2 space-y-1 text-sm text-ink/70">
                {(kn ? routing.rationaleKn : routing.rationaleEn).map((r) => (
                  <li key={r}>• {r}</li>
                ))}
              </ul>
            </div>
          </section>
        )}

        {tab === 'details' && (
          <section className="space-y-3">
            <h2 className="font-display text-xl font-bold text-forest">{t('admin.review.details.title')}</h2>
            <dl className="grid gap-3 sm:grid-cols-2 text-sm">
              <Field label={t('admin.review.details.scheme')} value={app.schemeName} />
              <Field label={t('admin.review.details.projectCost')} value={formatINR(app.projectCost)} />
              <Field label={t('admin.review.details.loanAmount')} value={formatINR(app.loanAmount)} />
              <Field
                label={t('admin.review.details.submittedAt')}
                value={new Date(app.createdAt).toLocaleString(kn ? 'kn-IN' : 'en-IN')}
              />
            </dl>
            <div>
              <p className="text-xs font-semibold uppercase text-ink/45">
                {t('admin.review.details.businessDescription')}
              </p>
              <p className="mt-1 text-sm text-ink/75">{app.applicant.businessDescription || '—'}</p>
            </div>
          </section>
        )}

        {tab === 'documents' && (
          <section className="space-y-4">
            <h2 className="font-display text-xl font-bold text-forest">{t('admin.review.documents.title')}</h2>
            <ul className="space-y-3">
              {app.documents.map((doc) => (
                <li key={doc.id} className="rounded-xl border border-forest/10 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-medium text-sm">{kn ? doc.labelKn : doc.labelEn}</p>
                      <p className="text-xs text-ink/50">
                        {doc.fileName ? `${doc.fileName} · ${Math.round((doc.sizeBytes ?? 0) / 1024)} KB` : '—'}
                      </p>
                      <p className="mt-1 text-xs font-semibold text-forest">
                        {t(`admin.review.documents.status.${doc.status}`)}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="rounded-full bg-forest px-3 py-1 text-xs font-semibold text-white"
                        onClick={() => patchDocument(doc.id, { status: 'verified' })}
                      >
                        {t('admin.review.documents.verify')}
                      </button>
                      <button
                        type="button"
                        className="rounded-full border border-red-300 px-3 py-1 text-xs font-semibold text-red-700"
                        onClick={() =>
                          patchDocument(doc.id, {
                            status: 'rejected',
                            reviewerNote: doc.reviewerNote || 'Rejected by reviewer',
                          })
                        }
                      >
                        {t('admin.review.documents.reject')}
                      </button>
                    </div>
                  </div>
                  <label className="mt-2 block text-xs text-ink/55">
                    {t('admin.review.documents.note')}
                    <input
                      className="mt-1 w-full rounded-lg border border-forest/15 px-2 py-1.5 text-sm"
                      defaultValue={doc.reviewerNote ?? ''}
                      onBlur={(e) => {
                        if (e.target.value !== (doc.reviewerNote ?? '')) {
                          patchDocument(doc.id, { reviewerNote: e.target.value })
                        }
                      }}
                    />
                  </label>
                </li>
              ))}
            </ul>
          </section>
        )}

        {tab === 'profile' && (
          <section className="space-y-3">
            <h2 className="font-display text-xl font-bold text-forest">{t('admin.review.profile.title')}</h2>
            <dl className="grid gap-3 sm:grid-cols-2 text-sm">
              <Field label={t('admin.review.profile.name')} value={app.applicant.name} />
              <Field label={t('admin.review.profile.age')} value={String(app.applicant.age)} />
              <Field label={t('admin.review.profile.gender')} value={app.applicant.gender} />
              <Field label={t('admin.review.profile.community')} value={app.applicant.community.toUpperCase()} />
              <Field label={t('admin.review.profile.phone')} value={app.applicant.phone} />
              <Field
                label={t('admin.review.profile.address')}
                value={`${app.applicant.address}, ${app.applicant.villageOrTown}, ${app.applicant.district}, ${app.applicant.state}`}
              />
              <Field
                label={t('admin.review.profile.bank')}
                value={`${app.applicant.bankAccountNumber} / ${app.applicant.bankIfsc}`}
              />
            </dl>
          </section>
        )}

        {tab === 'lokscore' && (
          <section className="space-y-4">
            <h2 className="font-display text-xl font-bold text-forest">{t('admin.review.lokscore.title')}</h2>
            {app.isDemoSeed && (
              <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs">
                {t('admin.review.lokscore.fixtureNote')}
              </p>
            )}
            <div className="flex items-end gap-4">
              <div>
                <p className="text-xs text-ink/45">{t('admin.review.lokscore.total')}</p>
                <p className="font-display text-4xl font-bold text-forest">{scoreLike.total}</p>
              </div>
              <div>
                <p className="text-xs text-ink/45">{t('admin.review.lokscore.grade')}</p>
                <p className="text-2xl font-bold">{scoreLike.grade}</p>
              </div>
            </div>
            <h3 className="text-sm font-bold text-forest">{t('admin.review.lokscore.breakdown')}</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              {(
                [
                  ['demand', scoreLike.demand],
                  ['competitionGap', scoreLike.competitionGap],
                  ['weatherFit', scoreLike.weatherFit],
                  ['financialFit', scoreLike.financialFit],
                  ['eligibility', scoreLike.eligibility],
                ] as const
              ).map(([key, val]) => (
                <div key={key} className="rounded-xl bg-mist/60 px-3 py-2">
                  <div className="flex justify-between text-sm">
                    <span className="capitalize text-ink/70">{key}</span>
                    <span className="font-semibold">{val}</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white">
                    <div className="h-full rounded-full bg-forest" style={{ width: `${val}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {tab === 'approvalRequirement' && (
          <section className="space-y-3">
            <h2 className="font-display text-xl font-bold text-forest">
              {t('admin.review.approvalRequirement.title')}
            </h2>
            <p className="text-sm text-ink/65">{t('admin.review.approvalRequirement.explanation')}</p>
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs">
              {t('admin.review.approvalServiceNote')}
            </p>
            <p className="text-lg font-bold text-forest">
              {t('admin.review.approvalRequirement.quorum')}:{' '}
              {caseView ? `${caseView.quorum.required} / ${caseView.quorum.pool}` : `${app.quorumRequired} / ${app.quorumPool}`}
            </p>
            {(caseView?.quorum.mentorRequired ?? app.mentorRequired) && (
              <p className="text-sm font-semibold text-amber-800">
                {t('admin.review.approvalRequirement.mentor')}
              </p>
            )}
            <ul className="list-inside list-disc text-sm text-ink/65">
              <li>{t('admin.review.approvalRequirement.thresholdHigh')}</li>
              <li>{t('admin.review.approvalRequirement.thresholdMid')}</li>
              <li>{t('admin.review.approvalRequirement.thresholdLow')}</li>
            </ul>
          </section>
        )}

        {tab === 'reviewers' && (
          <section className="space-y-4">
            <h2 className="font-display text-xl font-bold text-forest">{t('admin.review.reviewers.title')}</h2>
            <p className="text-sm text-ink/65">{t('admin.review.reviewers.subtitle')}</p>
            {!caseView ? (
              <button
                type="button"
                onClick={onAssignReviewers}
                className="rounded-full bg-forest px-4 py-2 text-sm font-bold text-white"
              >
                {t('admin.review.reviewers.openCase')}
              </button>
            ) : (
              <>
                <div>
                  <p className="text-sm font-semibold text-forest">
                    {t('admin.review.reviewers.progress', {
                      signed: caseView.validSignatures,
                      required: caseView.quorum.required,
                    })}
                  </p>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-mist">
                    <div
                      className="h-full rounded-full bg-forest"
                      style={{
                        width: `${Math.min(100, (caseView.validSignatures / Math.max(1, caseView.quorum.required)) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
                <p className="font-mono text-[10px] text-ink/45">
                  {t('admin.review.reviewers.allocationDigest')}: {caseView.allocation.allocationDigest}
                </p>
                <ul className="space-y-2">
                  {caseView.allocation.reviewers.map((r) => (
                    <li
                      key={r.reviewerId}
                      className="flex items-center justify-between rounded-xl border border-forest/10 px-3 py-2 text-sm"
                    >
                      <div>
                        <p className="font-medium">{kn ? r.displayNameKn : r.displayName}</p>
                        <p className="text-xs text-ink/50">
                          {t('admin.review.reviewers.role')}: {r.role}
                          {r.role === 'mentor' ? ' · mentor' : ''}
                        </p>
                        <p className="truncate font-mono text-[10px] text-ink/40">{r.address}</p>
                      </div>
                      <span className={clsx('text-xs font-bold', r.hasSigned ? 'text-forest' : 'text-ink/40')}>
                        {r.hasSigned ? t('admin.review.reviewers.signed') : t('admin.review.reviewers.pending')}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {err && <p className="text-sm text-red-700">{err}</p>}
          </section>
        )}

        {tab === 'multisig' && (
          <section className="space-y-4">
            <h2 className="font-display text-xl font-bold text-forest">{t('admin.review.multisig.title')}</h2>
            <p className="text-sm text-ink/65">{t('admin.review.multisig.subtitle')}</p>
            <p className="inline-block rounded-full border border-gold/40 bg-gold/20 px-3 py-1 text-xs font-semibold">
              {t('admin.review.multisig.fixtureIdentities')}
            </p>
            {!caseView ? (
              <button
                type="button"
                onClick={onAssignReviewers}
                className="rounded-full bg-forest px-4 py-2 text-sm font-bold text-white"
              >
                {t('admin.review.reviewers.openCase')}
              </button>
            ) : (
              <>
                <div className="rounded-xl bg-ink px-3 py-3 font-mono text-xs text-gold break-all">
                  <div className="mb-1 flex items-center gap-1 text-white/70">
                    <Shield className="h-3 w-3" /> {t('admin.review.multisig.hash')}
                  </div>
                  {caseView.applicationHash}
                </div>
                <p className="text-sm font-semibold">
                  {caseView.validSignatures}/{caseView.quorum.required} of {caseView.quorum.pool}
                  {caseView.quorumMet && (
                    <span className="ml-2 text-forest">· {t('admin.review.multisig.quorumMet')}</span>
                  )}
                  <span className="ml-2 text-xs font-normal text-ink/50">{caseView.status}</span>
                </p>
                {caseView.blockers.length > 0 && (
                  <ul className="list-inside list-disc text-xs text-amber-800">
                    {caseView.blockers.map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                )}
                {err && <p className="text-sm text-red-700">{err}</p>}
                <ul className="space-y-2">
                  {caseView.allocation.reviewers.map((r) => (
                    <li
                      key={r.reviewerId}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-forest/10 px-3 py-2"
                    >
                      <div className="text-sm">
                        <p className="font-medium">{kn ? r.displayNameKn : r.displayName}</p>
                        <p className="text-xs text-ink/50">{r.role}</p>
                        {r.signaturePreview && (
                          <p className="max-w-xs truncate font-mono text-[10px] text-ink/40">{r.signaturePreview}</p>
                        )}
                      </div>
                      {r.hasSigned ? (
                        <span className="text-xs font-bold text-forest">{t('admin.review.multisig.signed')}</span>
                      ) : (
                        <button
                          type="button"
                          disabled={!!busy || app.status === 'rejected'}
                          onClick={() => void onSign(r.reviewerId)}
                          className="rounded-full bg-forest px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                        >
                          {busy === r.reviewerId ? '…' : t('admin.review.multisig.sign')}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
                {caseView.quorumMet && !caseView.disbursementAuthorized && (
                  <button
                    type="button"
                    onClick={onAuthorize}
                    className="rounded-full bg-forest px-4 py-2 text-sm font-bold text-white"
                  >
                    {t('admin.review.multisig.authorize')}
                  </button>
                )}
                {caseView.disbursementAuthorized && (
                  <p className="font-semibold text-forest">{t('admin.review.multisig.approved')}</p>
                )}
                {caseView.audit.length > 0 && (
                  <ol className="max-h-40 space-y-1 overflow-auto text-[11px] text-ink/60">
                    {caseView.audit.map((e) => (
                      <li key={e.eventId} className="font-mono">
                        {e.eventType}
                        {e.actorRef ? ` · ${e.actorRef}` : ''}
                      </li>
                    ))}
                  </ol>
                )}
              </>
            )}
          </section>
        )}

        {tab === 'status' && (
          <section className="space-y-4">
            <h2 className="font-display text-xl font-bold text-forest">{t('admin.review.statusTab.title')}</h2>
            <p className="text-sm">
              {t('admin.review.statusTab.current')}:{' '}
              <strong>{t(`admin.status.${app.status}`)}</strong>
            </p>
            <div>
              <p className="mb-2 text-xs font-semibold uppercase text-ink/45">
                {t('admin.review.statusTab.pipeline')}
              </p>
              <StatusPipeline
                status={app.status}
                labels={{
                  submitted: t('admin.status.submitted'),
                  under_review: t('admin.status.under_review'),
                  reviewer_assigned: t('admin.status.reviewer_assigned'),
                  approved: t('admin.status.approved'),
                  disbursed: t('admin.status.disbursed'),
                  rejected: t('admin.status.rejected'),
                }}
              />
            </div>
            {caseView && (
              <p className="text-sm text-ink/70">
                {t('admin.review.statusTab.approvalCase')}: <strong>{caseView.status}</strong>
                {caseView.disbursementAuthorized ? ` · ${t('admin.review.multisig.approved')}` : ''}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {(['under_review', 'reviewer_assigned', 'disbursed'] as ApplicationStatus[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => changeStatus(s)}
                  className="rounded-full border border-forest/20 px-3 py-1.5 text-xs font-semibold text-forest hover:bg-mist"
                >
                  {t('admin.review.statusTab.setStatus')}: {t(`admin.status.${s}`)}
                </button>
              ))}
            </div>
            <div className="rounded-xl border border-red-200 bg-red-50 p-3">
              <label className="block text-xs font-semibold text-red-800">
                {t('admin.review.statusTab.rejectReason')}
                <input
                  className="mt-1 w-full rounded-lg border border-red-200 px-2 py-1.5 text-sm"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                />
              </label>
              <button
                type="button"
                className="mt-2 rounded-full bg-red-700 px-3 py-1.5 text-xs font-bold text-white"
                onClick={() => changeStatus('rejected', rejectReason || 'Rejected by admin')}
              >
                {t('admin.review.statusTab.reject')}
              </button>
            </div>
            <div>
              <h3 className="text-sm font-bold text-forest">{t('admin.audit.title')}</h3>
              <ul className="mt-2 max-h-64 space-y-2 overflow-y-auto text-sm">
                {[...app.auditTrail].reverse().map((e) => (
                  <li key={e.id} className="rounded-lg bg-mist/50 px-3 py-2">
                    <p className="text-xs text-ink/45">{new Date(e.at).toLocaleString()}</p>
                    <p className="font-medium">
                      {e.actor}: {e.action}
                    </p>
                    {e.detail && <p className="text-ink/65">{e.detail}</p>}
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase text-ink/45">{label}</dt>
      <dd className="mt-0.5 font-medium">{value}</dd>
    </div>
  )
}
