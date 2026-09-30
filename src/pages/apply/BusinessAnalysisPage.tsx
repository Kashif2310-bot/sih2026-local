import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useApp } from '../../state/useApp'
import { WizardActions, WizardShell } from '../../components/apply/WizardShell'
import { CompetitionAnalysis } from '../../components/CompetitionAnalysis'

export function BusinessAnalysisPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { profile, score, location, competition, analyzeCompetition } = useApp()

  if (!profile || !score) return <Navigate to="/apply/profile" replace />

  return (
    <WizardShell title={t('apply.businessAnalysis.title')} subtitle={t('apply.businessAnalysis.subtitle')}>
      <div className="rounded-2xl border border-forest/10 bg-white p-5 space-y-3">
        <p className="text-sm">
          <span className="text-ink/50">LokScore</span>{' '}
          <strong className="text-forest">
            {score.total} / {score.grade}
          </strong>
        </p>
        {location && (
          <p className="text-sm text-ink/70">
            {location.name}, {location.district} · {profile.category}
          </p>
        )}
        <ul className="list-inside list-disc text-sm text-ink/70">
          {(score.rationale ?? []).slice(0, 4).map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        <Link to="/report" className="inline-block text-sm font-semibold text-forest hover:underline">
          /report
        </Link>
      </div>

      {location && (
        <div className="rounded-2xl border border-forest/10 bg-white p-5">
          <h2 className="font-display text-xl font-bold text-forest">Local competition analysis</h2>
          <p className="mb-4 mt-1 text-sm text-ink/60">Google Places evidence near the confirmed business location.</p>
          <CompetitionAnalysis
            state={competition}
            latitude={location.lat}
            longitude={location.lng}
            locationName={location.name}
            onAnalyze={analyzeCompetition}
          />
        </div>
      )}

      <WizardActions
        onBack={() => navigate('/apply/recommendations')}
        backLabel={t('apply.back')}
        onNext={() => navigate('/apply/schemes')}
        nextLabel={t('apply.businessAnalysis.continue')}
      />
    </WizardShell>
  )
}
