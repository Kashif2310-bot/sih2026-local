import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { BUSINESS_META, VILLAGES, type BusinessCategory } from '../../data/villages'
import type { EntrepreneurProfile } from '../../lib/lokScore'
import { useApp } from '../../state/useApp'
import { useApplicationDraft } from '../../citizen/useApplicationDraft'
import {
  OTHER_LOCATION,
  profileFormDraftFromTranscript,
  validateProfileForm,
  type FieldError,
  type ProfileFormDraft,
  type ProfileFormField,
} from '../../citizen/profileFormDraft'
import { WizardActions, WizardShell } from '../../components/apply/WizardShell'

/** '' (a cleared input) is blank, not 0. */
function numberOrNull(raw: string): number | null {
  return raw.trim() === '' ? null : Number(raw)
}

export function ProfilePage() {
  const { t, i18n } = useTranslation()
  const kn = i18n.language === 'kn'
  const navigate = useNavigate()
  const { setProfileAndScan, loading, error, errorKn } = useApp()
  const { transcript, updateExtra } = useApplicationDraft()

  const [form, setForm] = useState<ProfileFormDraft>(() => profileFormDraftFromTranscript(transcript))
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<ProfileFormField, FieldError>>>({})

  const update = <K extends ProfileFormField>(key: K, value: ProfileFormDraft[K]) => {
    setForm((f) => ({ ...f, [key]: value }))
    setFieldErrors((prev) => ({ ...prev, [key]: undefined }))
  }

  const fieldError = (key: ProfileFormField) => {
    const err = fieldErrors[key]
    return err ? (
      <span role="alert" className="mt-1 block text-xs font-normal text-red-700">
        {t(err.key, err.values)}
      </span>
    ) : null
  }

  const onContinue = async () => {
    const result = validateProfileForm(form)
    if (!result.ok) {
      setFieldErrors(result.errors)
      return
    }
    setFieldErrors({})
    if (transcript.trim()) {
      updateExtra({ businessDescription: transcript.trim() })
    }
    const ok = await setProfileAndScan(result.profile)
    if (ok) navigate('/apply/conversation')
  }

  return (
    <WizardShell title={t('apply.steps.profile')} subtitle={t('apply.profile.intro')}>
      {transcript && (
        <p className="mb-4 rounded-xl bg-mist/70 px-3 py-2 text-sm text-ink/70">
          “{transcript}”
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-semibold text-forest sm:col-span-2">
          {t('wizard.name')}
          <input
            className="mt-1 w-full rounded-xl border border-forest/20 px-3 py-2 font-normal text-ink"
            value={form.name}
            aria-invalid={Boolean(fieldErrors.name)}
            onChange={(e) => update('name', e.target.value)}
          />
          {fieldError('name')}
        </label>
        <label className="text-sm font-semibold text-forest">
          {t('wizard.age')}
          <input
            type="number"
            className="mt-1 w-full rounded-xl border border-forest/20 px-3 py-2 font-normal text-ink"
            value={form.age ?? ''}
            aria-invalid={Boolean(fieldErrors.age)}
            onChange={(e) => update('age', numberOrNull(e.target.value))}
          />
          {fieldError('age')}
        </label>
        <label className="text-sm font-semibold text-forest">
          {t('wizard.gender')}
          <select
            className="mt-1 w-full rounded-xl border border-forest/20 px-3 py-2 font-normal text-ink"
            value={form.gender ?? ''}
            aria-invalid={Boolean(fieldErrors.gender)}
            onChange={(e) => update('gender', (e.target.value || null) as EntrepreneurProfile['gender'] | null)}
          >
            <option value="">{t('apply.profile.choose')}</option>
            <option value="female">{t('wizard.female')}</option>
            <option value="male">{t('wizard.male')}</option>
            <option value="other">{t('wizard.other')}</option>
          </select>
          {fieldError('gender')}
        </label>
        <label className="text-sm font-semibold text-forest">
          {t('wizard.community')}
          <select
            className="mt-1 w-full rounded-xl border border-forest/20 px-3 py-2 font-normal text-ink"
            value={form.community ?? ''}
            aria-invalid={Boolean(fieldErrors.community)}
            onChange={(e) =>
              update('community', (e.target.value || null) as EntrepreneurProfile['community'] | null)
            }
          >
            <option value="">{t('apply.profile.choose')}</option>
            <option value="sc">{t('wizard.sc')}</option>
            <option value="st">{t('wizard.st')}</option>
            <option value="obc">{t('wizard.obc')}</option>
            <option value="general">{t('wizard.general')}</option>
          </select>
          {fieldError('community')}
        </label>
        <label className="text-sm font-semibold text-forest">
          {t('wizard.category')}
          <select
            className="mt-1 w-full rounded-xl border border-forest/20 px-3 py-2 font-normal text-ink"
            value={form.category ?? ''}
            aria-invalid={Boolean(fieldErrors.category)}
            onChange={(e) => update('category', (e.target.value || null) as BusinessCategory | null)}
          >
            <option value="">{t('apply.profile.choose')}</option>
            {(Object.keys(BUSINESS_META) as BusinessCategory[]).map((c) => (
              <option key={c} value={c}>
                {kn ? BUSINESS_META[c].labelKn : BUSINESS_META[c].label}
              </option>
            ))}
          </select>
          {fieldError('category')}
        </label>
        <label className="text-sm font-semibold text-forest">
          {t('wizard.margin')}
          <input
            type="number"
            className="mt-1 w-full rounded-xl border border-forest/20 px-3 py-2 font-normal text-ink"
            value={form.availableMargin ?? ''}
            aria-invalid={Boolean(fieldErrors.availableMargin)}
            onChange={(e) => update('availableMargin', numberOrNull(e.target.value))}
          />
          {fieldError('availableMargin')}
        </label>
        <label className="text-sm font-semibold text-forest">
          {t('wizard.income')}
          <input
            type="number"
            className="mt-1 w-full rounded-xl border border-forest/20 px-3 py-2 font-normal text-ink"
            value={form.annualIncome ?? ''}
            aria-invalid={Boolean(fieldErrors.annualIncome)}
            onChange={(e) => update('annualIncome', numberOrNull(e.target.value))}
          />
          {fieldError('annualIncome')}
        </label>
        <label className="text-sm font-semibold text-forest">
          {t('wizard.experience')}
          <input
            type="number"
            className="mt-1 w-full rounded-xl border border-forest/20 px-3 py-2 font-normal text-ink"
            value={form.experienceYears ?? ''}
            aria-invalid={Boolean(fieldErrors.experienceYears)}
            onChange={(e) => update('experienceYears', numberOrNull(e.target.value))}
          />
          {fieldError('experienceYears')}
        </label>
        <label className="text-sm font-semibold text-forest sm:col-span-2">
          {t('wizard.village')}
          <select
            className="mt-1 w-full rounded-xl border border-forest/20 px-3 py-2 font-normal text-ink"
            value={form.villageId ?? ''}
            aria-invalid={Boolean(fieldErrors.villageId)}
            onChange={(e) => update('villageId', e.target.value || null)}
          >
            <option value="">{t('apply.profile.choose')}</option>
            {VILLAGES.map((v) => (
              <option key={v.id} value={v.id}>
                {kn ? v.nameKn : v.name} ({v.district})
              </option>
            ))}
            <option value={OTHER_LOCATION}>{t('apply.profile.otherLocation')}</option>
          </select>
          {fieldError('villageId')}
        </label>
        {form.villageId === OTHER_LOCATION && (
          <div className="sm:col-span-2">
            <label className="text-sm font-semibold text-forest">
              {t('apply.profile.otherLocationPlace')}
              <input
                className="mt-1 w-full rounded-xl border border-forest/20 px-3 py-2 font-normal text-ink"
                value={form.otherLocation}
                aria-invalid={Boolean(fieldErrors.otherLocation)}
                aria-describedby="other-location-note"
                onChange={(e) => update('otherLocation', e.target.value)}
              />
              {fieldError('otherLocation')}
            </label>
            <p
              id="other-location-note"
              className="mt-2 rounded-xl border border-gold/30 bg-gold/10 px-3 py-2 text-xs text-[#3a3a3a]"
            >
              {t('apply.profile.otherLocationNote')}
            </p>
          </div>
        )}
      </div>

      {error && (
        <p className="mt-3 text-sm text-red-700" role="alert">
          {kn ? errorKn : error}
        </p>
      )}

      <WizardActions
        onBack={() => navigate('/apply')}
        backLabel={t('apply.back')}
        onNext={() => void onContinue()}
        nextLabel={loading ? '…' : t('wizard.next')}
        nextDisabled={loading}
        nextBusy={loading}
      />
      {loading && (
        <p className="mt-2 flex items-center gap-2 text-sm text-ink/55">
          <Loader2 className="h-4 w-4 animate-spin" /> {t('common.loading')}
        </p>
      )}
    </WizardShell>
  )
}
