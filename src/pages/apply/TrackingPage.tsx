import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { getApplication, getLastApplicationId } from '../../platform/store'
import { peekApprovalCase } from '../../platform/approvalBridge'
import { useApplicationDraft } from '../../citizen/useApplicationDraft'
import { WizardShell } from '../../components/apply/WizardShell'
import { StatusPipeline } from '../../components/StatusPipeline'

export function TrackingPage() {
  const { t, i18n } = useTranslation()
  const kn = i18n.language === 'kn'
  const { submittedId, reset } = useApplicationDraft()
  const id = submittedId ?? getLastApplicationId()
  const app = id ? getApplication(id) : undefined
  const approval = id ? peekApprovalCase(id) : null

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
            {t('apply.tracking.status')}: <strong>{t(`admin.status.${app.status}`)}</strong>
          </p>
          <div>
            <p className="mb-2 text-xs font-semibold uppercase text-ink/45">{t('apply.tracking.pipeline')}</p>
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
          {approval ? (
            <div className="rounded-xl border border-forest/10 bg-white px-4 py-3 text-sm">
              <p>
                {t('apply.tracking.approvalStatus')}: <strong>{approval.status}</strong>
              </p>
              <p className="mt-1">
                {t('apply.tracking.quorum')}:{' '}
                {t('apply.tracking.signaturesOf', {
                  signed: approval.validSignatures,
                  required: approval.quorum.required,
                })}
              </p>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-mist">
                <div
                  className="h-full rounded-full bg-forest"
                  style={{
                    width: `${Math.min(100, (approval.validSignatures / Math.max(1, approval.quorum.required)) * 100)}%`,
                  }}
                />
              </div>
              <p className="mt-2 text-xs text-ink/55">{t('apply.tracking.sessionNote')}</p>
            </div>
          ) : (
            <p className="text-sm text-ink/70">{t('apply.tracking.approvalClosed')}</p>
          )}
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
