import { useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Shield } from 'lucide-react'
import clsx from 'clsx'
import {
  appendAudit,
  getApplication,
  setStatus,
  updateApplication,
} from '../../platform/store'
import { MINISTRIES, routeApplication } from '../../platform/ministries'
import type { ApplicationStatus, DocumentRecord } from '../../platform/types'
import { formatINR } from '../../lib/finance'
import { LOKSCORE_WEIGHTS } from '../../lib/config'
import {
  buildAttestation,
  createVerifierPool,
  quorumMet,
  signAttestation,
  type Attestation,
  type SignatureRecord,
  type Verifier,
} from '../../lib/multisig'
import type { LokScoreBreakdown } from '../../lib/lokScore'
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
  const [verifiers] = useState(() => createVerifierPool())
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')

  const reload = () => setVersion((v) => v + 1)
  void version
  const app = id ? (getApplication(id) ?? null) : null

  if (!id || !app) return <Navigate to="/admin/applications" replace />

  const routing = routeApplication({
    category: app.applicant.category,
    gender: app.applicant.gender,
    community: app.applicant.community,
  })

  const scoreLike: LokScoreBreakdown = app.lokScoreBreakdown ?? {
    demand: 0,
    competitionGap: 0,
    weatherFit: 0,
    financialFit: 0,
    eligibility: 0,
    total: app.lokScore,
    grade: app.lokScore >= 80 ? 'A' : app.lokScore >= 65 ? 'B' : app.lokScore >= 50 ? 'C' : 'D',
    quorumRequired: app.quorumRequired,
    quorumPool: app.quorumPool,
    mentorRequired: app.mentorRequired,
    rationale: [],
    rationaleKn: [],
    weights: LOKSCORE_WEIGHTS,
  }

  const pool = verifiers.slice(0, app.quorumPool)
  const liveSignatures: SignatureRecord[] = app.signatures.map((s) => ({
    verifierId: s.reviewerId,
    address: s.address,
    signature: s.signature,
    signedAt: s.signedAt,
  }))
  const met = app.attestation ? quorumMet(scoreLike, liveSignatures) : liveSignatures.length >= app.quorumRequired

  const ensureAttestation = (): Attestation => {
    if (app.attestation) return app.attestation
    const attestation = buildAttestation({
      entrepreneurName: app.applicant.name,
      villageId: app.applicant.villageOrTown || 'unknown',
      lokScore: app.lokScore,
      schemeId: app.schemeId,
      projectCost: app.projectCost,
      loanAmount: app.loanAmount,
      quorumRequired: app.quorumRequired,
      quorumPool: app.quorumPool,
    })
    // Drop fixture seed signatures — they are not valid ECDSA over this attestation.
    updateApplication(app.id, { attestation, signatures: [] })
    appendAudit(app.id, {
      actor: session?.name ?? 'Admin',
      action: 'attestation_created',
      detail: `Report hash ${attestation.reportHash.slice(0, 18)}…`,
    })
    reload()
    return attestation
  }

  const onAssignReviewers = () => {
    setStatus(app.id, 'reviewer_assigned', session?.name ?? 'Admin', `Pool of ${app.quorumPool} verifiers assigned`)
    reload()
  }

  const onSign = async (verifier: Verifier) => {
    setBusy(verifier.id)
    setErr(null)
    try {
      const attestation = ensureAttestation()
      // ensureAttestation may have cleared signatures — re-read
      const fresh = getApplication(app.id)
      if (!fresh?.attestation) throw new Error('Attestation missing')
      const already = fresh.signatures.some((s) => s.reviewerId === verifier.id)
      if (already) return
      const record = await signAttestation(verifier, fresh.attestation ?? attestation)
      const nextSigs = [
        ...fresh.signatures,
        {
          reviewerId: record.verifierId,
          address: record.address,
          signature: record.signature,
          signedAt: record.signedAt,
        },
      ]
      updateApplication(app.id, { signatures: nextSigs })
      appendAudit(app.id, {
        actor: verifier.name,
        action: 'signed',
        detail: `ECDSA signature from ${verifier.role}`,
      })
      const nextLive: SignatureRecord[] = nextSigs.map((s) => ({
        verifierId: s.reviewerId,
        address: s.address,
        signature: s.signature,
        signedAt: s.signedAt,
      }))
      if (quorumMet(scoreLike, nextLive) && fresh.status !== 'approved') {
        setStatus(app.id, 'approved', session?.name ?? 'Admin', 'Signing quorum met')
      }
      reload()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Sign failed')
    } finally {
      setBusy(null)
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
            <div>
              <p className="text-xs font-semibold uppercase text-ink/45">{t('admin.review.routing.lead')}</p>
              <p className="mt-1 font-medium">
                {kn ? MINISTRIES[app.leadMinistryId].nameKn : MINISTRIES[app.leadMinistryId].name}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase text-ink/45">{t('admin.review.routing.supporting')}</p>
              <ul className="mt-1 list-inside list-disc text-sm">
                {app.supportingMinistryIds.map((m) => (
                  <li key={m}>{kn ? MINISTRIES[m].nameKn : MINISTRIES[m].name}</li>
                ))}
              </ul>
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
            <p className="text-lg font-bold text-forest">
              {t('admin.review.approvalRequirement.quorum')}: {app.quorumRequired} / {app.quorumPool}
            </p>
            {app.mentorRequired && (
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
            <ul className="space-y-2">
              {pool.map((v) => {
                const signed = app.signatures.some((s) => s.reviewerId === v.id)
                return (
                  <li
                    key={v.id}
                    className="flex items-center justify-between rounded-xl border border-forest/10 px-3 py-2 text-sm"
                  >
                    <div>
                      <p className="font-medium">{kn ? v.nameKn : v.name}</p>
                      <p className="text-xs text-ink/50">
                        {t('admin.review.reviewers.role')}: {kn ? v.roleKn : v.role}
                      </p>
                    </div>
                    <span className={clsx('text-xs font-bold', signed ? 'text-forest' : 'text-ink/40')}>
                      {signed ? t('admin.review.reviewers.signed') : t('admin.review.reviewers.pending')}
                    </span>
                  </li>
                )
              })}
            </ul>
            {(app.status === 'submitted' || app.status === 'under_review') && (
              <button
                type="button"
                onClick={onAssignReviewers}
                className="rounded-full bg-forest px-4 py-2 text-sm font-bold text-white"
              >
                {t('admin.review.tabs.reviewers')}
              </button>
            )}
          </section>
        )}

        {tab === 'multisig' && (
          <section className="space-y-4">
            <h2 className="font-display text-xl font-bold text-forest">{t('admin.review.multisig.title')}</h2>
            <p className="text-sm text-ink/65">{t('admin.review.multisig.subtitle')}</p>
            <p className="inline-block rounded-full border border-gold/40 bg-gold/20 px-3 py-1 text-xs font-semibold">
              {t('admin.review.multisig.fixtureIdentities')}
            </p>
            {app.attestation && (
              <div className="rounded-xl bg-ink px-3 py-3 font-mono text-xs text-gold break-all">
                <div className="mb-1 flex items-center gap-1 text-white/70">
                  <Shield className="h-3 w-3" /> Hash
                </div>
                {app.attestation.reportHash}
              </div>
            )}
            <p className="text-sm font-semibold">
              {liveSignatures.length}/{app.quorumRequired} of {app.quorumPool}
              {met && (
                <span className="ml-2 text-forest">· {t('admin.review.multisig.quorumMet')}</span>
              )}
            </p>
            {err && <p className="text-sm text-red-700">{err}</p>}
            <ul className="space-y-2">
              {pool.map((v) => {
                const signed = app.signatures.some((s) => s.reviewerId === v.id)
                return (
                  <li
                    key={v.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-forest/10 px-3 py-2"
                  >
                    <div className="text-sm">
                      <p className="font-medium">{kn ? v.nameKn : v.name}</p>
                      <p className="text-xs text-ink/50">{kn ? v.roleKn : v.role}</p>
                    </div>
                    {signed ? (
                      <span className="text-xs font-bold text-forest">{t('admin.review.multisig.signed')}</span>
                    ) : (
                      <button
                        type="button"
                        disabled={busy === v.id || app.status === 'approved' || app.status === 'rejected'}
                        onClick={() => void onSign(v)}
                        className="rounded-full bg-forest px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                      >
                        {busy === v.id ? '…' : t('admin.review.multisig.sign')}
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
            {app.status === 'approved' && (
              <p className="font-semibold text-forest">{t('admin.review.multisig.approved')}</p>
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
