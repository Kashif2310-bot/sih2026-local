import { useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  ExternalLink,
  FileText,
  ShieldAlert,
} from 'lucide-react'
import clsx from 'clsx'
import { EMPTY_PROFILE, type UserProfile } from '../assistant/types'
import { listApplySchemes } from '../apply/catalog'
import { consentTextFor } from '../apply/channels'
import { loadHandoff, loadTrackedApplications, saveHandoff, saveTrackedApplication } from '../apply/store'
import { newApplicationId } from '../apply/application'
import type { ConversationPayload, DocumentDeclaration, FilingChannel, MappedField, TrackedApplication } from '../apply/types'
import { prepareApplication, submitApplication } from '../apply/workflow'
import { useApp } from '../state/useApp'
import { WorkflowStepper } from '../components/apply/WorkflowStepper'

const CHANNELS: FilingChannel[] = ['guided', 'assisted', 'government_api']

function emptyOverrides(): Record<string, string | number | boolean | undefined> {
  return {}
}

export function ApplyWizard({ schemeId, initialProfile }: { schemeId: string; initialProfile: UserProfile }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { profile: scan } = useApp()

  const [profile] = useState<UserProfile>(initialProfile)
  const [overrides, setOverrides] = useState<Record<string, string | number | boolean | undefined>>(() => {
    const seed: Record<string, string | number | boolean | undefined> = { ...emptyOverrides() }
    if (scan?.name) seed.applicant_name = scan.name
    if (scan?.phone) seed.mobile = scan.phone
    return seed
  })
  const [docs, setDocs] = useState<Record<string, DocumentDeclaration>>({})
  const [channel, setChannel] = useState<FilingChannel | null>(null)
  const [simulate, setSimulate] = useState(false)
  const [consent, setConsent] = useState(false)
  const [stage, setStage] = useState<1 | 2 | 3 | 4>(1)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [applicationId] = useState(() => newApplicationId())
  const conversation: ConversationPayload | undefined = loadHandoff()?.conversation

  const prepared = useMemo(
    () =>
      prepareApplication({
        schemeId,
        profile,
        fieldOverrides: overrides,
        documentDeclarations: docs,
        channel: channel ?? undefined,
      }),
    [schemeId, profile, overrides, docs, channel],
  )

  const activeChannel = channel ?? prepared.scheme.channel.recommended

  const updateField = (field: MappedField, raw: string) => {
    if (field.fieldType === 'integer') {
      setOverrides((prev) => ({ ...prev, [field.key]: raw === '' ? undefined : Number(raw) }))
      return
    }
    if (field.fieldType === 'boolean') {
      setOverrides((prev) => ({ ...prev, [field.key]: raw === 'true' }))
      return
    }
    setOverrides((prev) => ({ ...prev, [field.key]: raw }))
  }

  const onSubmit = async () => {
    setSubmitting(true)
    setError(null)
    try {
      const result = await submitApplication({
        prepared,
        channel: activeChannel,
        consentAccepted: consent,
        simulate,
        applicationId,
        conversation,
      })
      if (result.outcome !== 'consent_required' && result.outcome !== 'blocked_by_validation') {
        saveTrackedApplication(result)
      }
      navigate(`/apply/track/${encodeURIComponent(result.trackingId)}`, { state: { application: result } })
    } catch (e) {
      setError(e instanceof Error ? e.message : t('apply.errorGeneric'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="glass rounded-2xl p-4">
        <h2 className="text-xs font-bold uppercase tracking-wide text-ink/45">{t('apply.engineTitle')}</h2>
        <p className="mt-1 text-[11px] text-ink/50">{t('apply.engineHint')}</p>
        <div className="mt-3">
          <WorkflowStepper prepared={prepared} />
        </div>
      </aside>

      <div className="space-y-4">
        <div className="glass rounded-2xl p-5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink/45">
            {prepared.scheme.displayName}
          </p>
          <h1 className="mt-1 font-display text-2xl font-bold text-forest">{t('apply.wizardTitle')}</h1>
          <p className="mt-2 text-sm text-ink/65">{t('apply.wizardSubtitle')}</p>
          <p className="mt-3 rounded-xl border border-gold/30 bg-gold/10 px-3 py-2 text-xs text-[#6b5300]">
            {prepared.scheme.channel.rationale}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {([1, 2, 3, 4] as const).map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setStage(n)}
              className={clsx(
                'rounded-full px-3 py-1.5 text-xs font-semibold',
                stage === n ? 'bg-forest text-white' : 'bg-white text-ink/60 ring-1 ring-forest/10',
              )}
            >
              {t(`apply.stage.${n}`)}
            </button>
          ))}
        </div>

        {stage === 1 && (
          <section className="glass rounded-2xl p-5">
            <h2 className="flex items-center gap-2 font-display text-lg font-bold text-forest">
              <ClipboardList className="h-4 w-4" />
              {t('apply.fieldsTitle')}
            </h2>
            <p className="mt-1 text-xs text-ink/50">{t('apply.fieldsHint')}</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {prepared.mappedFields.map((field) => (
                <label key={field.key} className="block text-sm">
                  <span className="mb-1 flex items-center justify-between gap-2 font-medium text-ink/80">
                    {field.label}
                    {field.required && <span className="text-[10px] uppercase text-clay">{t('apply.required')}</span>}
                  </span>
                  {field.fieldType === 'boolean' ? (
                    <select
                      value={field.value === undefined ? '' : String(field.value)}
                      onChange={(e) => updateField(field, e.target.value)}
                      className="w-full rounded-xl border border-forest/15 bg-white px-3 py-2 text-sm outline-none ring-forest/30 focus:ring-2"
                    >
                      <option value="">{t('apply.select')}</option>
                      <option value="true">{t('apply.yes')}</option>
                      <option value="false">{t('apply.no')}</option>
                    </select>
                  ) : (
                    <input
                      type={field.fieldType === 'integer' ? 'number' : 'text'}
                      value={field.value === undefined ? '' : String(field.value)}
                      onChange={(e) => updateField(field, e.target.value)}
                      className="w-full rounded-xl border border-forest/15 bg-white px-3 py-2 text-sm outline-none ring-forest/30 focus:ring-2"
                    />
                  )}
                  <span className="mt-1 block text-[11px] text-ink/40">
                    {field.source === 'profile' || field.source === 'derived'
                      ? t('apply.mappedFromProfile')
                      : field.helpText}
                  </span>
                </label>
              ))}
            </div>
            {prepared.missingFields.length > 0 && (
              <p className="mt-4 rounded-xl bg-[#ffece8] px-3 py-2 text-xs text-danger">
                {t('apply.missingCount', { count: prepared.missingFields.length })}
              </p>
            )}
            <button
              type="button"
              onClick={() => setStage(2)}
              className="mt-4 inline-flex items-center gap-2 rounded-full bg-forest px-4 py-2 text-sm font-bold text-white"
            >
              {t('apply.nextDocuments')} <ArrowRight className="h-4 w-4" />
            </button>
          </section>
        )}

        {stage === 2 && (
          <section className="glass rounded-2xl p-5">
            <h2 className="flex items-center gap-2 font-display text-lg font-bold text-forest">
              <FileText className="h-4 w-4" />
              {t('apply.docsTitle')}
            </h2>
            <p className="mt-1 text-xs text-ink/50">{t('apply.docsHint')}</p>
            <ul className="mt-4 space-y-3">
              {prepared.documents.map((doc) => (
                <li key={doc.key} className="rounded-xl border border-forest/10 bg-white/70 p-3">
                  <p className="text-sm font-semibold text-ink">{doc.label}</p>
                  {doc.notes && <p className="mt-0.5 text-[11px] text-ink/45">{doc.notes}</p>}
                  <select
                    aria-label={doc.label}
                    value={doc.declaration}
                    onChange={(e) =>
                      setDocs((prev) => ({ ...prev, [doc.key]: e.target.value as DocumentDeclaration }))
                    }
                    className="mt-2 w-full rounded-xl border border-forest/15 bg-white px-3 py-2 text-sm"
                  >
                    <option value="missing">{t('apply.docMissing')}</option>
                    <option value="declared_available">{t('apply.docAvailable')}</option>
                    <option value="will_submit_on_portal">{t('apply.docOnPortal')}</option>
                  </select>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => setStage(3)}
              className="mt-4 inline-flex items-center gap-2 rounded-full bg-forest px-4 py-2 text-sm font-bold text-white"
            >
              {t('apply.nextReview')} <ArrowRight className="h-4 w-4" />
            </button>
          </section>
        )}

        {stage === 3 && (
          <section className="glass rounded-2xl p-5">
            <h2 className="font-display text-lg font-bold text-forest">{t('apply.reviewTitle')}</h2>
            <p className="mt-1 text-xs text-ink/50">{t('apply.reviewHint')}</p>

            {prepared.issues.filter((i) => i.blocking).length > 0 && (
              <div className="mt-3 rounded-xl bg-[#ffece8] px-3 py-2 text-sm text-danger">
                <p className="flex items-center gap-1.5 font-semibold">
                  <AlertTriangle className="h-4 w-4" />
                  {t('apply.blockingTitle')}
                </p>
                <ul className="mt-1 list-disc pl-5 text-xs">
                  {prepared.issues
                    .filter((i) => i.blocking)
                    .map((i) => (
                      <li key={`${i.code}-${i.field}`}>{i.message}</li>
                    ))}
                </ul>
              </div>
            )}

            {prepared.packet ? (
              <dl className="mt-4 grid gap-2 sm:grid-cols-2">
                {Object.entries(prepared.packet.fields).map(([k, v]) => (
                  <div key={k} className="rounded-xl bg-mist/60 px-3 py-2">
                    <dt className="text-[11px] uppercase tracking-wide text-ink/45">{k}</dt>
                    <dd className="text-sm font-medium text-ink">{String(v)}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="mt-4 text-sm text-ink/60">{t('apply.packetBlocked')}</p>
            )}

            <button
              type="button"
              onClick={() => setStage(1)}
              className="mt-3 mr-2 rounded-full border border-forest/20 bg-white px-4 py-2 text-sm font-semibold text-forest"
            >
              {t('apply.correct')}
            </button>
            <button
              type="button"
              onClick={() => setStage(4)}
              disabled={!prepared.canPreparePacket}
              className="mt-3 inline-flex items-center gap-2 rounded-full bg-forest px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
            >
              {t('apply.nextConsent')} <ArrowRight className="h-4 w-4" />
            </button>
          </section>
        )}

        {stage === 4 && (
          <section className="glass rounded-2xl p-5">
            <h2 className="font-display text-lg font-bold text-forest">{t('apply.consentTitle')}</h2>
            <p className="mt-1 text-xs text-ink/50">{t('apply.channelHint')}</p>

            <fieldset className="mt-4 space-y-2">
              <legend className="text-sm font-semibold text-ink">{t('apply.channelLabel')}</legend>
              {CHANNELS.map((c) => (
                <label key={c} className="flex items-start gap-2 rounded-xl border border-forest/10 bg-white/70 p-3 text-sm">
                  <input
                    type="radio"
                    name="channel"
                    checked={activeChannel === c}
                    onChange={() => setChannel(c)}
                    className="mt-1"
                  />
                  <span>
                    <span className="font-semibold">{t(`apply.channel.${c}`)}</span>
                    <span className="mt-0.5 block text-xs text-ink/55">{t(`apply.channelHelp.${c}`)}</span>
                  </span>
                </label>
              ))}
            </fieldset>

            <label className="mt-4 flex items-start gap-2 rounded-xl border border-gold/40 bg-gold/10 p-3 text-sm">
              <input
                type="checkbox"
                checked={simulate}
                onChange={(e) => {
                  setSimulate(e.target.checked)
                  setConsent(false)
                }}
              />
              <span>
                <span className="font-semibold text-[#6b5300]">{t('apply.simulateLabel')}</span>
                <span className="mt-0.5 block text-xs text-[#6b5300]">{t('apply.simulateHint')}</span>
              </span>
            </label>

            <label className="mt-3 flex items-start gap-2 rounded-xl border border-forest/15 bg-white p-3 text-sm">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              <span>{consentTextFor(activeChannel, simulate)}</span>
            </label>

            {error && <p className="mt-3 text-sm text-danger">{error}</p>}

            <button
              type="button"
              onClick={() => void onSubmit()}
              disabled={submitting}
              className="mt-4 inline-flex items-center gap-2 rounded-full bg-forest px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50"
            >
              {submitting ? t('common.loading') : t('apply.submitCta')}
            </button>
            <p className="mt-2 text-[11px] text-ink/45">{t('apply.submitDisclaimer')}</p>
          </section>
        )}
      </div>
    </div>
  )
}

export function ApplyHub() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const schemes = listApplySchemes()
  const tracked = loadTrackedApplications()
  const handoff = loadHandoff()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold text-forest">{t('apply.title')}</h1>
        <p className="mt-2 max-w-2xl text-ink/65">{t('apply.subtitle')}</p>
      </div>
      <p className="rounded-xl border border-gold/30 bg-gold/10 px-3.5 py-2.5 text-xs text-[#6b5300]">
        {t('apply.honestyNote')}
      </p>

      {handoff && (
        <div className="glass rounded-2xl p-4">
          <p className="text-sm text-ink/70">{t('apply.resumeHandoff', { scheme: handoff.schemeId })}</p>
          <button
            type="button"
            onClick={() => navigate(`/apply/start/${handoff.schemeId}`)}
            className="mt-2 rounded-full bg-forest px-4 py-2 text-sm font-bold text-white"
          >
            {t('apply.continueHandoff')}
          </button>
        </div>
      )}

      <section>
        <h2 className="font-display text-lg font-bold text-forest">{t('apply.pickScheme')}</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {schemes.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                const existing = loadHandoff()
                saveHandoff({
                  schemeId: s.id,
                  profile: existing?.profile ?? { ...EMPTY_PROFILE },
                })
                navigate(`/apply/start/${s.id}`)
              }}
              className="glass rounded-2xl p-4 text-left hover:ring-2 hover:ring-forest/20"
            >
              <p className="font-display font-bold text-forest">{s.name}</p>
              <p className="mt-1 text-xs text-ink/50">
                {t('apply.recommendedChannel')}: {t(`apply.channel.${s.recommended}`)}
              </p>
            </button>
          ))}
        </div>
      </section>

      <section>
        <h2 className="font-display text-lg font-bold text-forest">{t('apply.trackedTitle')}</h2>
        {tracked.length === 0 ? (
          <p className="mt-2 text-sm text-ink/50">{t('apply.trackedEmpty')}</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {tracked.map((app) => (
              <li key={app.trackingId}>
                <Link
                  to={`/apply/track/${encodeURIComponent(app.trackingId)}`}
                  className="glass flex items-center justify-between rounded-2xl p-4 text-sm hover:ring-2 hover:ring-forest/20"
                >
                  <span>
                    <span className="font-semibold text-forest">{app.schemeName}</span>
                    <span className="mt-0.5 block text-xs text-ink/50">{app.trackingId}</span>
                  </span>
                  <span className="text-xs font-semibold text-ink/70">{app.honestLabel}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

export function ApplyPage() {
  return <ApplyHub />
}

export function ApplyStartPage() {
  const { schemeId } = useParams()
  const handoff = loadHandoff()
  if (!schemeId) return <ApplyHub />
  const profile = handoff && handoff.schemeId === schemeId ? handoff.profile : { ...EMPTY_PROFILE }
  return <ApplyWizard schemeId={schemeId} initialProfile={profile} />
}

export function ApplyTrackPage() {
  const { trackingId } = useParams()
  const location = useLocation()
  const fallback = (location.state as { application?: TrackedApplication } | null)?.application
  return <ApplicationTrackView trackingId={trackingId ?? ''} fallback={fallback} />
}

export function ApplicationTrackView({
  trackingId,
  fallback,
}: {
  trackingId: string
  fallback?: TrackedApplication
}) {
  const { t } = useTranslation()
  const stored = loadTrackedApplications().find((a) => a.trackingId === trackingId)
  const app = fallback ?? stored

  if (!app) {
    return (
      <div className="space-y-3">
        <h1 className="font-display text-2xl font-bold text-forest">{t('apply.trackTitle')}</h1>
        <p className="text-sm text-ink/60">{t('apply.trackMissing')}</p>
        <Link to="/apply/hub" className="text-sm font-semibold text-forest hover:underline">
          {t('apply.backToHub')}
        </Link>
      </div>
    )
  }

  const bannerClass = app.simulation
    ? 'border-gold/40 bg-gold/15 text-[#6b5300]'
    : app.filedWithGovernment
      ? 'border-forest/20 bg-mist text-forest'
      : 'border-clay/30 bg-[#fff4ee] text-clay'

  return (
    <div className="space-y-5">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink/45">{app.schemeName}</p>
        <h1 className="font-display text-3xl font-bold text-forest">{t('apply.trackTitle')}</h1>
      </div>

      <div className={clsx('rounded-2xl border px-4 py-3 text-sm font-semibold', bannerClass)}>
        {app.simulation && <ShieldAlert className="mb-1 h-4 w-4" />}
        {app.filedWithGovernment && <CheckCircle2 className="mb-1 h-4 w-4" />}
        {app.honestLabel}
        <p className="mt-1 font-normal">{app.detail}</p>
      </div>

      <dl className="glass grid gap-3 rounded-2xl p-5 sm:grid-cols-2">
        <div>
          <dt className="text-[11px] uppercase text-ink/45">{t('apply.applicationId')}</dt>
          <dd className="font-mono text-sm font-semibold">{app.applicationId}</dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase text-ink/45">{t('apply.trackingId')}</dt>
          <dd className="font-mono text-sm font-semibold">{app.trackingId}</dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase text-ink/45">{t('apply.channelLabel')}</dt>
          <dd className="text-sm font-semibold">{t(`apply.channel.${app.channel}`)}</dd>
        </div>
        {app.governmentApplicationId && (
          <div>
            <dt className="text-[11px] uppercase text-ink/45">{t('apply.govId')}</dt>
            <dd className="font-mono text-sm font-semibold">{app.governmentApplicationId}</dd>
          </div>
        )}
        <div>
          <dt className="text-[11px] uppercase text-ink/45">{t('apply.filedWithGov')}</dt>
          <dd className="text-sm font-semibold">{app.filedWithGovernment ? t('apply.yes') : t('apply.no')}</dd>
        </div>
      </dl>

      {app.package && (
        <section className="glass rounded-2xl p-5">
          <h2 className="font-display text-lg font-bold text-forest">{t('apply.packageTitle')}</h2>
          <p className="mt-1 text-xs text-ink/50">{t('apply.packageHint')}</p>
          <dl className="mt-3 grid gap-2 sm:grid-cols-2 text-sm">
            <div>
              <dt className="text-[11px] uppercase text-ink/45">{t('apply.snapshotHash')}</dt>
              <dd className="break-all font-mono text-xs">{app.package.snapshotHash}</dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase text-ink/45">{t('apply.readyForApproval')}</dt>
              <dd className="font-semibold">{app.package.readyForApproval ? t('apply.yes') : t('apply.no')}</dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase text-ink/45">{t('apply.nextOwner')}</dt>
              <dd>
                {app.package.handoff.nextOwner} · {app.package.handoff.nextService}
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-ink/55">{app.package.handoff.note}</p>
        </section>
      )}

      <section className="glass rounded-2xl p-5">
        <h2 className="font-display text-lg font-bold text-forest">{t('apply.nextSteps')}</h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-ink/75">
          {app.nextSteps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
        {app.officialPortalUrl && (
          <a
            href={app.officialPortalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-forest/20 bg-white px-3 py-1.5 text-sm font-semibold text-forest"
          >
            {t('apply.openPortal')} <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </section>

      <section className="glass rounded-2xl p-5">
        <h2 className="font-display text-lg font-bold text-forest">{t('apply.historyTitle')}</h2>
        <ol className="mt-3 space-y-2 text-sm">
          {app.statusHistory.map((h, i) => (
            <li key={`${h.step}-${i}`} className="border-l-2 border-forest/20 pl-3">
              <p className="font-semibold text-forest">{t(`apply.steps.${h.step}`)}</p>
              <p className="text-xs text-ink/55">{h.note}</p>
            </li>
          ))}
        </ol>
      </section>

      <Link to="/apply/hub" className="inline-block text-sm font-semibold text-forest hover:underline">
        {t('apply.backToHub')}
      </Link>
    </div>
  )
}
