import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { MINISTRIES } from '../../platform/ministries'
import { useApplicationDraft } from '../../citizen/useApplicationDraft'
import { useApp } from '../../state/useApp'
import { WizardShell } from '../../components/apply/WizardShell'

export function SubmissionPage() {
  const { t, i18n } = useTranslation()
  const kn = i18n.language === 'kn'
  const navigate = useNavigate()
  const { profile, plan, score } = useApp()
  const { consentGiven, submit, submittedId } = useApplicationDraft()
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<{ id: string; ministry: string } | null>(null)

  if (!profile || !plan || !score) return <Navigate to="/apply/profile" replace />
  if (!consentGiven && !submittedId && !created) return <Navigate to="/apply/consent" replace />

  const onSubmit = () => {
    setBusy(true)
    try {
      const app = submit()
      if (!app) return
      setCreated({
        id: app.id,
        ministry: kn ? MINISTRIES[app.leadMinistryId].nameKn : MINISTRIES[app.leadMinistryId].name,
      })
    } finally {
      setBusy(false)
    }
  }

  const id = created?.id ?? submittedId

  return (
    <WizardShell title={t('apply.submission.title')} subtitle={t('apply.submission.subtitle')}>
      <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-ink/70">
        {t('apply.submission.storageNote')}
      </p>

      {!id ? (
        <button
          type="button"
          disabled={busy}
          onClick={onSubmit}
          className="rounded-full bg-forest px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50"
        >
          {busy ? '…' : t('apply.submission.submit')}
        </button>
      ) : (
        <div className="space-y-3 rounded-2xl border border-forest/10 bg-white p-5">
          <p className="font-semibold text-forest">{t('apply.submission.submitted')}</p>
          <p className="text-sm">
            {t('apply.submission.idLabel')}: <span className="font-mono font-bold">{id}</span>
          </p>
          {created && (
            <p className="text-sm">
              {t('apply.submission.routedTo')}: {created.ministry}
            </p>
          )}
          <div className="flex flex-wrap gap-3 pt-2">
            <button
              type="button"
              className="rounded-full bg-forest px-4 py-2 text-sm font-bold text-white"
              onClick={() => navigate('/apply/tracking')}
            >
              {t('apply.submission.trackButton')}
            </button>
            <button
              type="button"
              className="rounded-full border border-forest/20 px-4 py-2 text-sm font-semibold text-forest"
              onClick={() => navigate('/apply/final-report')}
            >
              {t('apply.submission.reportButton')}
            </button>
            <Link to="/admin/login" className="self-center text-sm font-semibold text-forest hover:underline">
              Admin
            </Link>
          </div>
        </div>
      )}
    </WizardShell>
  )
}
