import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useApplicationDraft } from '../../citizen/useApplicationDraft'
import { useApp } from '../../state/useApp'
import { WizardActions, WizardShell } from '../../components/apply/WizardShell'

export function ApplicationPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { profile, location } = useApp()
  const { extra, updateExtra, ensureDocuments } = useApplicationDraft()

  useEffect(() => {
    const patch: Partial<typeof extra> = {}
    if (!extra.phone && profile?.phone) patch.phone = profile.phone
    if (!extra.villageOrTown && location?.name) patch.villageOrTown = location.name
    if (!extra.district && location?.district) patch.district = location.district
    if (Object.keys(patch).length) updateExtra(patch)
  }, [profile, location, extra.phone, extra.villageOrTown, extra.district, updateExtra])

  const fields: Array<{ key: keyof typeof extra; label: string; required?: boolean }> = [
    { key: 'phone', label: t('apply.application.phone'), required: true },
    { key: 'email', label: t('apply.application.email') },
    { key: 'address', label: t('apply.application.address'), required: true },
    { key: 'villageOrTown', label: t('apply.application.villageOrTown'), required: true },
    { key: 'district', label: t('apply.application.district'), required: true },
    { key: 'state', label: t('apply.application.state'), required: true },
    { key: 'bankAccountNumber', label: t('apply.application.bankAccountNumber'), required: true },
    { key: 'bankIfsc', label: t('apply.application.bankIfsc'), required: true },
    { key: 'businessDescription', label: t('apply.application.businessDescription'), required: true },
  ]

  const missingRequired = fields.some((f) => f.required && !String(extra[f.key] ?? '').trim())

  return (
    <WizardShell title={t('apply.application.title')} subtitle={t('apply.application.subtitle')}>
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((f) => (
          <label
            key={f.key}
            className={`text-sm font-semibold text-forest ${f.key === 'businessDescription' || f.key === 'address' ? 'sm:col-span-2' : ''}`}
          >
            {f.label}
            {f.key === 'businessDescription' || f.key === 'address' ? (
              <textarea
                className="mt-1 w-full rounded-xl border border-forest/20 px-3 py-2 font-normal text-ink"
                rows={3}
                value={extra[f.key]}
                onChange={(e) => updateExtra({ [f.key]: e.target.value })}
              />
            ) : (
              <input
                className="mt-1 w-full rounded-xl border border-forest/20 px-3 py-2 font-normal text-ink"
                value={extra[f.key]}
                onChange={(e) => updateExtra({ [f.key]: e.target.value })}
              />
            )}
          </label>
        ))}
      </div>

      <WizardActions
        onBack={() => navigate('/apply/financial-plan')}
        backLabel={t('apply.back')}
        onNext={() => {
          ensureDocuments()
          navigate('/apply/documents')
        }}
        nextLabel={t('apply.application.continue')}
        nextDisabled={missingRequired}
      />
    </WizardShell>
  )
}
