import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { getApplication } from '../../platform/store'
import { useApplicationDraft } from '../../citizen/useApplicationDraft'
import { WizardShell } from '../../components/apply/WizardShell'

export function TrackingPage() {
  const { t, i18n } = useTranslation()
  const kn = i18n.language === 'kn'
  const { submittedId, reset } = useApplicationDraft()
  const app = submittedId ? getApplication(submittedId) : undefined

  return (
    <WizardShell title={t('apply.tracking.title')} subtitle={t('apply.tracking.subtitle')}>
      {!app ? (
        <div className="space-y-3">
          <p className="text-sm text-ink/60">{t('apply.tracking.notFound')}</p>
          <Link
            to="/apply"
            onClick={() => reset()}
            className="inline-block rounded-full bg-forest px-4 py-2 text-sm font-bold text-white"
          >
            {t('apply.tracking.startNew')}
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="font-mono text-sm text-ink/50">{app.id}</p>
          <p className="text-sm">
            {t('apply.tracking.status')}:{' '}
            <strong>{t(`admin.status.${app.status}`)}</strong>
          </p>
          <p className="text-sm">
            {t('apply.tracking.quorum')}:{' '}
            {t('apply.tracking.signaturesOf', {
              signed: app.signatures.length,
              required: app.quorumRequired,
            })}
          </p>
          <div>
            <h3 className="text-sm font-bold text-forest">{t('apply.tracking.auditTitle')}</h3>
            <ul className="mt-2 space-y-2">
              {[...app.auditTrail].reverse().map((e) => (
                <li key={e.id} className="rounded-lg bg-mist/60 px-3 py-2 text-sm">
                  <p className="text-xs text-ink/45">
                    {new Date(e.at).toLocaleString(kn ? 'kn-IN' : 'en-IN')}
                  </p>
                  <p>
                    {e.actor}: {e.action}
                  </p>
                  {e.detail && <p className="text-ink/65">{e.detail}</p>}
                </li>
              ))}
            </ul>
          </div>
          <Link to="/apply/final-report" className="inline-block text-sm font-semibold text-forest hover:underline">
            {t('apply.tracking.finalReport')}
          </Link>
        </div>
      )}
    </WizardShell>
  )
}
