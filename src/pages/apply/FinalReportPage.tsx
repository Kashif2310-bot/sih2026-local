import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { formatINR } from '../../lib/finance'
import { getApplication, getLastApplicationId } from '../../platform/store'
import { MINISTRIES } from '../../platform/ministries'
import { useApplicationDraft } from '../../citizen/useApplicationDraft'
import { useApp } from '../../state/useApp'
import { WizardShell } from '../../components/apply/WizardShell'

export function FinalReportPage() {
  const { t, i18n } = useTranslation()
  const kn = i18n.language === 'kn'
  const { submittedId } = useApplicationDraft()
  const { plan, score, profile, location } = useApp()
  const app = getApplication(submittedId ?? getLastApplicationId() ?? '')

  return (
    <WizardShell title={t('apply.finalReport.title')} subtitle={t('apply.finalReport.subtitle')}>
      <p className="mb-4 text-xs text-ink/55">{t('apply.finalReport.disclaimer')}</p>

      <div className="space-y-3 rounded-2xl border border-forest/10 bg-white p-5 text-sm print:border-0">
        {app && (
          <>
            <p>
              {t('apply.finalReport.applicationId')}: <strong className="font-mono">{app.id}</strong>
            </p>
            <p>
              {t('apply.finalReport.status')}: <strong>{t(`admin.status.${app.status}`)}</strong>
            </p>
            <p>
              {kn ? MINISTRIES[app.leadMinistryId].nameKn : MINISTRIES[app.leadMinistryId].name}
            </p>
          </>
        )}
        {profile && (
          <p>
            {profile.name} · {profile.category} · {location?.name}
          </p>
        )}
        {plan && (
          <p>
            {kn ? plan.schemeNameKn : plan.schemeName}: {formatINR(plan.loanAmount)}
          </p>
        )}
        {score && (
          <p>
            LokScore {score.total} / {score.grade}
          </p>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded-full bg-forest px-4 py-2 text-sm font-bold text-white"
        >
          {t('apply.finalReport.print')}
        </button>
        <Link to="/export" className="rounded-full border border-forest/20 px-4 py-2 text-sm font-semibold text-forest">
          /export
        </Link>
      </div>
    </WizardShell>
  )
}
