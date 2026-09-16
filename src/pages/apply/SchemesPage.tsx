import { Navigate, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { getDocumentChecklist } from '../../lib/documentChecklist'
import { formatINR } from '../../lib/finance'
import { useApp } from '../../state/useApp'
import { WizardActions, WizardShell } from '../../components/apply/WizardShell'

export function SchemesPage() {
  const { t, i18n } = useTranslation()
  const kn = i18n.language === 'kn'
  const navigate = useNavigate()
  const { plan } = useApp()

  if (!plan) return <Navigate to="/apply/profile" replace />

  const checklist = getDocumentChecklist(plan.schemeId)

  return (
    <WizardShell title={t('apply.schemes.title')} subtitle={t('apply.schemes.subtitle')}>
      <div className="rounded-2xl border border-forest/10 bg-white p-5 space-y-3">
        <h2 className="font-display text-xl font-bold text-forest">
          {kn ? plan.schemeNameKn : plan.schemeName}
        </h2>
        <dl className="grid gap-2 sm:grid-cols-2 text-sm">
          <div>
            <dt className="text-ink/45">Project</dt>
            <dd className="font-semibold">{formatINR(plan.projectCost)}</dd>
          </div>
          <div>
            <dt className="text-ink/45">Loan</dt>
            <dd className="font-semibold">{formatINR(plan.loanAmount)}</dd>
          </div>
        </dl>
        <div>
          <p className="text-xs font-semibold uppercase text-ink/45">{t('apply.schemes.checklistPreview')}</p>
          <ul className="mt-2 list-inside list-disc text-sm text-ink/70">
            {checklist.slice(0, 5).map((item) => (
              <li key={item.en}>{kn ? item.kn : item.en}</li>
            ))}
          </ul>
        </div>
      </div>

      <WizardActions
        onBack={() => navigate('/apply/business-analysis')}
        backLabel={t('apply.back')}
        onNext={() => navigate('/apply/financial-plan')}
        nextLabel={t('apply.schemes.continue')}
      />
    </WizardShell>
  )
}
