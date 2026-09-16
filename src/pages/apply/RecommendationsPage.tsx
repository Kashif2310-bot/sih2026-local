import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { SchemeCard } from '../../components/assistant/SchemeCard'
import { useApplicationDraft } from '../../citizen/useApplicationDraft'
import { WizardActions, WizardShell } from '../../components/apply/WizardShell'

export function RecommendationsPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { rankedSchemes } = useApplicationDraft()

  return (
    <WizardShell title={t('apply.recommendations.title')} subtitle={t('apply.recommendations.subtitle')}>
      {rankedSchemes.length === 0 ? (
        <p className="text-sm text-ink/55">{t('apply.recommendations.empty')}</p>
      ) : (
        <div className="space-y-3">
          {rankedSchemes.slice(0, 5).map((r) => (
            <SchemeCard key={r.scheme.id} ranked={r} onViewDetails={() => undefined} />
          ))}
        </div>
      )}

      <WizardActions
        onBack={() => navigate('/apply/conversation')}
        backLabel={t('apply.back')}
        onNext={() => navigate('/apply/business-analysis')}
        nextLabel={t('apply.recommendations.continueNsfdc')}
      />
    </WizardShell>
  )
}
