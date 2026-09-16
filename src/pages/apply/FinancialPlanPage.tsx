import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { formatINR } from '../../lib/finance'
import { useApp } from '../../state/useApp'
import { WizardActions, WizardShell } from '../../components/apply/WizardShell'

export function FinancialPlanPage() {
  const { t, i18n } = useTranslation()
  const kn = i18n.language === 'kn'
  const navigate = useNavigate()
  const { plan, workingCapital } = useApp()

  if (!plan) return <Navigate to="/apply/profile" replace />

  return (
    <WizardShell title={t('apply.financialPlan.title')} subtitle={t('apply.financialPlan.subtitle')}>
      <div className="rounded-2xl border border-forest/10 bg-white p-5 space-y-3 text-sm">
        <p>
          <span className="text-ink/45">{kn ? plan.schemeNameKn : plan.schemeName}</span>
        </p>
        <p>
          Loan <strong>{formatINR(plan.loanAmount)}</strong> · EMI/quarter{' '}
          <strong>{formatINR(plan.quarterlyEmi)}</strong>
        </p>
        <p>
          Rate {plan.interestRate}% · Tenure {plan.tenureYears}y · Moratorium {plan.moratoriumMonths} mo
        </p>
        {workingCapital && (
          <p>
            Working capital <strong>{formatINR(workingCapital.workingCapital)}</strong>
          </p>
        )}
        <Link to="/finance" className="inline-block font-semibold text-forest hover:underline">
          /finance
        </Link>
      </div>

      <WizardActions
        onBack={() => navigate('/apply/schemes')}
        backLabel={t('apply.back')}
        onNext={() => navigate('/apply/application')}
        nextLabel={t('apply.financialPlan.continue')}
      />
    </WizardShell>
  )
}
