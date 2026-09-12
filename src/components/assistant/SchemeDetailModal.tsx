import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, ExternalLink, FileText, Globe, Info, ListChecks, X } from 'lucide-react'
import { StatusBadge } from './StatusBadge'
import type { RankedScheme, UserProfile } from '../../assistant/types'
import { saveHandoff } from '../../apply/store'

function formatRupees(n: number): string {
  return `₹${n.toLocaleString('en-IN')}`
}

export function SchemeDetailModal({
  ranked,
  profile,
  onClose,
}: {
  ranked: RankedScheme | null
  profile: UserProfile
  onClose: () => void
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()

  useEffect(() => {
    if (!ranked) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [ranked, onClose])

  if (!ranked) return null
  const { scheme, eligibility } = ranked

  const loanLine =
    scheme.loanAmount &&
    [
      scheme.loanAmount.minRupees !== undefined && scheme.loanAmount.maxRupees !== undefined
        ? `${formatRupees(scheme.loanAmount.minRupees)} – ${formatRupees(scheme.loanAmount.maxRupees)}`
        : scheme.loanAmount.maxRupees !== undefined
          ? `${t('assistant.detail.loanAmount')}: ${formatRupees(scheme.loanAmount.maxRupees)}`
          : undefined,
      scheme.loanAmount.notes,
    ]
      .filter(Boolean)
      .join(' — ')

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={scheme.name}
      onClick={onClose}
    >
      <div
        className="glass max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-t-[1.5rem] p-6 shadow-lg sm:rounded-[1.5rem]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink/45">
              {scheme.scope === 'state' ? scheme.state : t('assistant.detail.central')} · {scheme.ministry}
            </p>
            <h2 className="mt-1 font-display text-xl font-bold text-forest">{scheme.name}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('assistant.detail.close')}
            className="shrink-0 rounded-full p-1.5 text-ink/50 hover:bg-mist hover:text-ink"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-3">
          <StatusBadge status={eligibility.status} />
          <span className="ml-2 text-xs text-ink/50">
            {t('assistant.matchScore')}: <strong className="text-ink/80">{eligibility.score}/100</strong>
          </span>
        </div>

        <Section title={t('assistant.detail.description')} icon={Info}>
          <p className="text-sm text-ink/75">{scheme.description}</p>
        </Section>

        {eligibility.reasons.length > 0 && (
          <Section title={t('assistant.whyMatch')} icon={ListChecks}>
            <ul className="space-y-1 text-sm text-forest">
              {eligibility.reasons.map((r) => (
                <li key={r}>✓ {r}</li>
              ))}
            </ul>
          </Section>
        )}

        {(eligibility.mismatchReasons.length > 0 || eligibility.missingInfo.length > 0) && (
          <Section title={t('assistant.concerns')} icon={AlertTriangle}>
            {eligibility.mismatchReasons.length > 0 && (
              <ul className="space-y-1 text-sm text-clay">
                {eligibility.mismatchReasons.map((r) => (
                  <li key={r}>! {r}</li>
                ))}
              </ul>
            )}
            {eligibility.missingInfo.length > 0 && (
              <p className="mt-2 text-xs text-ink/50">
                {t('assistant.missingForThis')}: {eligibility.missingInfo.join(', ')}
              </p>
            )}
          </Section>
        )}

        {ranked.liveEvidence && ranked.liveEvidence.length > 0 && (
          <Section title={t('assistant.detail.liveEvidence')} icon={Globe}>
            <ul className="space-y-3">
              {ranked.liveEvidence.map((live) => (
                <li key={`${live.sourceUrl}-${live.retrievedAt}`} className="rounded-xl bg-[#e8f6ee] p-3 text-sm">
                  <p className="text-ink/80">{live.summary}</p>
                  <p className="mt-1.5 text-[11px] text-ink/50">
                    {live.sourceName} · {t('assistant.detail.retrievedAt')}:{' '}
                    {new Date(live.retrievedAt).toLocaleString()}
                    {live.publishedAt ? ` · ${t('assistant.detail.publishedAt')}: ${live.publishedAt}` : ''}
                  </p>
                  <a
                    href={live.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-forest hover:underline"
                  >
                    {live.sourceUrl} <ExternalLink className="h-3 w-3" />
                  </a>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {(loanLine || scheme.subsidy || scheme.interest) && (
          <Section title={t('assistant.detail.loanAmount')} icon={FileText}>
            <dl className="space-y-1.5 text-sm text-ink/75">
              {loanLine && <p>{loanLine}</p>}
              {scheme.subsidy && (
                <p>
                  <span className="font-semibold">{t('assistant.detail.subsidy')}:</span> {scheme.subsidy.description}
                </p>
              )}
              {scheme.interest?.ratePercent !== undefined && (
                <p>
                  <span className="font-semibold">{t('assistant.detail.interest')}:</span> {scheme.interest.ratePercent}%
                  {scheme.interest.notes ? ` — ${scheme.interest.notes}` : ''}
                </p>
              )}
            </dl>
          </Section>
        )}

        {scheme.documents.length > 0 && (
          <Section title={t('assistant.detail.documents')}>
            <ul className="list-disc space-y-1 pl-4 text-sm text-ink/75">
              {scheme.documents.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          </Section>
        )}

        {scheme.applicationSteps.length > 0 && (
          <Section title={t('assistant.detail.applicationSteps')}>
            <ol className="list-decimal space-y-1 pl-4 text-sm text-ink/75">
              {scheme.applicationSteps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          </Section>
        )}

        <Section title={t('assistant.detail.officialInfo')}>
          <div className="flex flex-wrap gap-3 text-sm">
            <a
              href={scheme.officialInfoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full border border-forest/20 bg-white px-3 py-1.5 font-semibold text-forest hover:border-forest/40"
            >
              {t('assistant.detail.officialInfo')} <ExternalLink className="h-3.5 w-3.5" />
            </a>
            {scheme.officialApplicationUrl !== scheme.officialInfoUrl && (
              <a
                href={scheme.officialApplicationUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full border border-forest/20 bg-white px-3 py-1.5 font-semibold text-forest hover:border-forest/40"
              >
                {t('assistant.detail.officialApplication')} <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
          </div>
          <p className="mt-3 text-xs text-ink/50">
            {t('assistant.detail.source')}: {scheme.source} · {t('assistant.detail.lastVerified')}: {scheme.lastVerifiedDate}
          </p>
          <p className="mt-1 text-xs font-medium text-clay">{t('assistant.detail.referenceNote')}</p>
          <button
            type="button"
            onClick={() => {
              saveHandoff({
                schemeId: scheme.id,
                profile,
                conversation: {
                  source: 'assistant',
                  extractedProfile: { ...profile },
                  citedScheme: scheme.id,
                },
              })
              onClose()
              navigate(`/apply/start/${scheme.id}`)
            }}
            className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-forest px-4 py-2 text-sm font-bold text-white hover:bg-leaf"
          >
            {t('assistant.startApplication')}
          </button>
        </Section>
      </div>
    </div>
  )
}

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string
  icon?: typeof Info
  children: React.ReactNode
}) {
  return (
    <div className="mt-5 border-t border-forest/10 pt-4 first:mt-4 first:border-0 first:pt-0">
      <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-ink/50">
        {Icon && <Icon className="h-3.5 w-3.5" />}
        {title}
      </h3>
      <div className="mt-2">{children}</div>
    </div>
  )
}
