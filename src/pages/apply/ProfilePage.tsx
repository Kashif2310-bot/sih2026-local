import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { BUSINESS_META, VILLAGES, type BusinessCategory } from '../../data/villages'
import { defaultProfile } from '../../lib/demoProfile'
import type { EntrepreneurProfile } from '../../lib/lokScore'
import { useApp } from '../../state/useApp'
import { useApplicationDraft } from '../../citizen/useApplicationDraft'
import { WizardActions, WizardShell } from '../../components/apply/WizardShell'

export function ProfilePage() {
  const { t, i18n } = useTranslation()
  const kn = i18n.language === 'kn'
  const navigate = useNavigate()
  const { setProfileAndScan, loading, error, errorKn, profile } = useApp()
  const { transcript, updateExtra } = useApplicationDraft()

  const [form, setForm] = useState<EntrepreneurProfile>(() => ({
    ...defaultProfile(),
    name: profile?.name ?? defaultProfile().name,
    demoMode: true,
  }))
  const [localErr, setLocalErr] = useState<string | null>(null)

  const update = <K extends keyof EntrepreneurProfile>(key: K, value: EntrepreneurProfile[K]) => {
    setForm((f) => ({ ...f, [key]: value }))
  }

  const onContinue = async () => {
    setLocalErr(null)
    if (!form.name.trim()) {
      setLocalErr(t('apply.application.requiredField'))
      return
    }
    if (transcript.trim()) {
      updateExtra({ businessDescription: transcript.trim() })
    }
    const ok = await setProfileAndScan({ ...form, demoMode: true })
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
            onChange={(e) => update('name', e.target.value)}
          />
        </label>
        <label className="text-sm font-semibold text-forest">
          {t('wizard.age')}
          <input
            type="number"
            className="mt-1 w-full rounded-xl border border-forest/20 px-3 py-2 font-normal text-ink"
            value={form.age}
            onChange={(e) => update('age', Number(e.target.value))}
          />
        </label>
        <label className="text-sm font-semibold text-forest">
          {t('wizard.gender')}
          <select
            className="mt-1 w-full rounded-xl border border-forest/20 px-3 py-2 font-normal text-ink"
            value={form.gender}
            onChange={(e) => update('gender', e.target.value as EntrepreneurProfile['gender'])}
          >
            <option value="female">{t('wizard.female')}</option>
            <option value="male">{t('wizard.male')}</option>
            <option value="other">{t('wizard.other')}</option>
          </select>
        </label>
        <label className="text-sm font-semibold text-forest">
          {t('wizard.community')}
          <select
            className="mt-1 w-full rounded-xl border border-forest/20 px-3 py-2 font-normal text-ink"
            value={form.community}
            onChange={(e) => update('community', e.target.value as EntrepreneurProfile['community'])}
          >
            <option value="sc">{t('wizard.sc')}</option>
            <option value="st">{t('wizard.st')}</option>
            <option value="obc">{t('wizard.obc')}</option>
            <option value="general">{t('wizard.general')}</option>
          </select>
        </label>
        <label className="text-sm font-semibold text-forest">
          {t('wizard.category')}
          <select
            className="mt-1 w-full rounded-xl border border-forest/20 px-3 py-2 font-normal text-ink"
            value={form.category}
            onChange={(e) => update('category', e.target.value as BusinessCategory)}
          >
            {(Object.keys(BUSINESS_META) as BusinessCategory[]).map((c) => (
              <option key={c} value={c}>
                {kn ? BUSINESS_META[c].labelKn : BUSINESS_META[c].label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-semibold text-forest">
          {t('wizard.margin')}
          <input
            type="number"
            className="mt-1 w-full rounded-xl border border-forest/20 px-3 py-2 font-normal text-ink"
            value={form.availableMargin}
            onChange={(e) => update('availableMargin', Number(e.target.value))}
          />
        </label>
        <label className="text-sm font-semibold text-forest sm:col-span-2">
          {t('wizard.village')}
          <select
            className="mt-1 w-full rounded-xl border border-forest/20 px-3 py-2 font-normal text-ink"
            value={form.villageId}
            onChange={(e) => update('villageId', e.target.value)}
          >
            {VILLAGES.map((v) => (
              <option key={v.id} value={v.id}>
                {kn ? v.nameKn : v.name} ({v.district})
              </option>
            ))}
          </select>
        </label>
      </div>

      {(localErr || error) && (
        <p className="mt-3 text-sm text-red-700" role="alert">
          {localErr || (kn ? errorKn : error)}
        </p>
      )}

      <p className="mt-3 text-xs text-ink/50">{t('wizard.offlineDemoModeHint')}</p>

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
