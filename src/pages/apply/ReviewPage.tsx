import { Navigate, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { formatINR } from '../../lib/finance'
import { useApplicationDraft } from '../../citizen/useApplicationDraft'
import { useApp } from '../../state/useApp'
import { WizardActions, WizardShell } from '../../components/apply/WizardShell'

export function ReviewPage() {
  const { t, i18n } = useTranslation()
  const kn = i18n.language === 'kn'
  const navigate = useNavigate()
  const { profile, plan, score, location } = useApp()
  const { extra, documents } = useApplicationDraft()

  if (!profile || !plan || !score) return <Navigate to="/apply/profile" replace />

  return (
    <WizardShell title={t('apply.review.title')} subtitle={t('apply.review.subtitle')}>
      <div className="space-y-4 text-sm">
        <Section title={t('apply.review.applicant')}>
          {profile.name} · {profile.community.toUpperCase()} · {extra.phone}
        </Section>
        <Section title={t('apply.review.location')}>
          {extra.address || '—'}, {extra.villageOrTown || location?.name},{' '}
          {extra.district || location?.district}
        </Section>
        <Section title={t('apply.review.scheme')}>{kn ? plan.schemeNameKn : plan.schemeName}</Section>
        <Section title={t('apply.review.finance')}>
          {formatINR(plan.projectCost)} · {formatINR(plan.loanAmount)}
        </Section>
        <Section title={t('apply.review.lokScore')}>
          {score.total} / {score.grade}
        </Section>
        <Section title={t('apply.review.documents')}>
          {documents.filter((d) => d.status === 'uploaded').length}/{documents.length}
        </Section>
      </div>

      <WizardActions
        onBack={() => navigate('/apply/documents')}
        backLabel={t('apply.back')}
        onNext={() => navigate('/apply/consent')}
        nextLabel={t('apply.review.continue')}
      />
    </WizardShell>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-forest/10 bg-white px-4 py-3">
      <p className="text-xs font-semibold uppercase text-ink/45">{title}</p>
      <p className="mt-1 font-medium text-ink">{children}</p>
    </div>
  )
}
