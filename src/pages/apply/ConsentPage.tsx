import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useApplicationDraft } from '../../citizen/useApplicationDraft'
import { useApp } from '../../state/useApp'
import { WizardActions, WizardShell } from '../../components/apply/WizardShell'

export function ConsentPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { profile } = useApp()
  const { consentName, setConsent } = useApplicationDraft()
  const [accuracy, setAccuracy] = useState(false)
  const [share, setShare] = useState(false)
  const [name, setName] = useState(consentName || profile?.name || '')
  const [mismatch, setMismatch] = useState(false)

  if (!profile) return <Navigate to="/apply/profile" replace />

  const onNext = () => {
    const expected = profile.name.trim().toLowerCase()
    if (name.trim().toLowerCase() !== expected) {
      setMismatch(true)
      return
    }
    if (!accuracy || !share) return
    setConsent(true, name.trim())
    navigate('/apply/submission')
  }

  return (
    <WizardShell title={t('apply.consent.title')} subtitle={t('apply.consent.subtitle')}>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={accuracy} onChange={(e) => setAccuracy(e.target.checked)} className="mt-1" />
        <span>{t('apply.consent.accuracy')}</span>
      </label>
      <label className="mt-3 flex items-start gap-2 text-sm">
        <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} className="mt-1" />
        <span>{t('apply.consent.share')}</span>
      </label>
      <label className="mt-4 block text-sm font-semibold text-forest">
        {t('apply.consent.signLabel')}
        <input
          className="mt-1 w-full rounded-xl border border-forest/20 px-3 py-2 font-normal text-ink"
          placeholder={t('apply.consent.signPlaceholder')}
          value={name}
          onChange={(e) => {
            setName(e.target.value)
            setMismatch(false)
          }}
        />
      </label>
      {mismatch && <p className="mt-2 text-sm text-red-700">{t('apply.consent.signMismatch')}</p>}

      <WizardActions
        onBack={() => navigate('/apply/review')}
        backLabel={t('apply.back')}
        onNext={onNext}
        nextLabel={t('apply.consent.continue')}
        nextDisabled={!accuracy || !share || !name.trim()}
      />
    </WizardShell>
  )
}
