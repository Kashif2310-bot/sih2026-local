import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { BUSINESS_META, VILLAGES, type BusinessCategory } from '../data/villages'
import { defaultProfile } from '../lib/demoProfile'
import { useApp } from '../state/useApp'
import type { EntrepreneurProfile } from '../lib/lokScore'
import { Loader2, MapPin, Crosshair, WifiOff } from 'lucide-react'
import { REACH_KM } from '../lib/config'
import { NSFDC } from '../lib/config'

const DEMO_MODE_STORAGE_KEY = 'lokpulse:offlineDemoMode'

function readStoredDemoMode(): boolean {
  try {
    return localStorage.getItem(DEMO_MODE_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function writeStoredDemoMode(value: boolean) {
  try {
    if (value) localStorage.setItem(DEMO_MODE_STORAGE_KEY, '1')
    else localStorage.removeItem(DEMO_MODE_STORAGE_KEY)
  } catch {
    // Private-browsing / storage-blocked contexts — the toggle still works
    // for the current page load, it just won't persist across a reload.
  }
}

export function ScanPage() {
  const { t, i18n } = useTranslation()
  const kn = i18n.language === 'kn'
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { setProfileAndScan, loading, error, errorKn } = useApp()
  const demo = params.get('demo') === '1'

  const [form, setForm] = useState<EntrepreneurProfile>(() => ({
    ...defaultProfile(),
    demoMode: readStoredDemoMode(),
  }))
  const [geoBusy, setGeoBusy] = useState(false)
  const [localErr, setLocalErr] = useState<string | null>(null)

  const toggleDemoMode = (on: boolean) => {
    writeStoredDemoMode(on)
    setForm((f) => ({
      ...f,
      demoMode: on,
      // Offline Demo Mode guarantees zero network calls — force curated
      // (seeded-village) mode so the live-search UI can't be used while it's on.
      locationMode: on ? 'curated' : f.locationMode,
    }))
  }

  const villages = useMemo(() => VILLAGES, [])

  const update = <K extends keyof EntrepreneurProfile>(key: K, value: EntrepreneurProfile[K]) => {
    setForm((f) => ({ ...f, [key]: value }))
  }

  const useMyLocation = () => {
    setLocalErr(null)
    if (!navigator.geolocation) {
      setLocalErr(kn ? 'ಜಿಯೋಲೊಕೇಶನ್ ಬೆಂಬಲವಿಲ್ಲ' : 'Geolocation not supported')
      return
    }
    setGeoBusy(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setForm((f) => ({
          ...f,
          locationMode: 'live',
          liveLat: pos.coords.latitude,
          liveLng: pos.coords.longitude,
          liveQuery: '',
        }))
        setGeoBusy(false)
      },
      () => {
        setLocalErr(kn ? 'ಸ್ಥಳ ಪಡೆಯಲಾಗಲಿಲ್ಲ' : 'Could not read device location')
        setGeoBusy(false)
      },
      { enableHighAccuracy: false, timeout: 12_000 },
    )
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLocalErr(null)
    // These three mirror what the removed native `required`/`min`/`max`
    // attributes used to silently enforce with an unstyled browser tooltip
    // (the same failure class as the margin-field bug: form has noValidate
    // so the app's own bilingual role=alert message must be authoritative
    // for every field, not just margin).
    if (!form.name.trim()) {
      setLocalErr(kn ? 'ಪೂರ್ಣ ಹೆಸರು ಅಗತ್ಯ' : 'Full name is required')
      return
    }
    if (!Number.isFinite(form.age) || form.age < 18 || form.age > 70) {
      setLocalErr(kn ? 'ವಯಸ್ಸು 18 ಮತ್ತು 70 ರ ನಡುವೆ ಇರಬೇಕು' : 'Age must be between 18 and 70')
      return
    }
    if (!Number.isFinite(form.experienceYears) || form.experienceYears < 0) {
      setLocalErr(kn ? 'ಅನುಭವದ ವರ್ಷಗಳು ಋಣಾತ್ಮಕವಾಗಿರಬಾರದು' : 'Years of experience cannot be negative')
      return
    }
    if (form.availableMargin <= 0) {
      setLocalErr(kn ? 'ಮಾರ್ಜಿನ್ ಧನಾತ್ಮಕವಾಗಿರಬೇಕು' : 'Margin capital must be positive')
      return
    }
    if (form.availableMargin > NSFDC.maxMarginRupees) {
      setLocalErr(
        kn
          ? `ಗರಿಷ್ಠ ಮಾರ್ಜಿನ್ ₹${NSFDC.maxMarginRupees.toLocaleString('en-IN')} (ಯೋಜನೆ ₹50 ಲಕ್ಷ)`
          : `Max margin ₹${NSFDC.maxMarginRupees.toLocaleString('en-IN')} (₹50L project cap)`,
      )
      return
    }
    if (form.locationMode === 'live' && !form.liveQuery?.trim() && form.liveLat == null) {
      setLocalErr(kn ? 'ಸ್ಥಳ ನಮೂದಿಸಿ ಅಥವಾ GPS ಬಳಸಿ' : 'Enter a place or use GPS')
      return
    }
    const id = await setProfileAndScan(form)
    if (id) navigate(`/pulse/${id}`)
  }

  const field =
    'mt-1 w-full rounded-xl border border-forest/15 bg-white px-3 py-2.5 text-sm outline-none ring-forest/30 focus:ring-2'

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold text-forest">{t('wizard.title')}</h1>
          <p className="mt-2 text-ink/65">{t('wizard.subtitle')}</p>
        </div>
        <label
          className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold transition ${
            form.demoMode
              ? 'border-gold bg-gold/20 text-ink'
              : 'border-forest/20 bg-white text-ink/60'
          }`}
          title={t('wizard.offlineDemoModeHint')}
        >
          <WifiOff className="h-3.5 w-3.5" />
          {t('wizard.offlineDemoMode')}
          <input
            type="checkbox"
            className="h-3.5 w-3.5"
            checked={!!form.demoMode}
            onChange={(e) => toggleDemoMode(e.target.checked)}
          />
        </label>
      </div>
      {form.demoMode && (
        <p className="mt-2 text-xs font-semibold text-clay">{t('wizard.offlineDemoModeHint')}</p>
      )}
      {demo && (
        <p className="mt-2 text-xs font-semibold text-sky">{t('wizard.demoHint')}</p>
      )}

      {/* noValidate: the app's own validation (onSubmit below) owns rejection
          messaging so it's bilingual and role=alert — native browser
          constraint validation would otherwise silently block submission
          with an unstyled, English-only tooltip before onSubmit ever runs. */}
      <form
        onSubmit={(e) => void onSubmit(e)}
        noValidate
        className="glass mt-8 space-y-5 rounded-[1.5rem] p-6 shadow-sm"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium">
            {t('wizard.name')}
            <input className={field} value={form.name} onChange={(e) => update('name', e.target.value)} required />
          </label>
          <label className="text-sm font-medium">
            {t('wizard.age')}
            <input
              className={field}
              type="number"
              min={18}
              max={70}
              value={form.age}
              onChange={(e) => update('age', Number(e.target.value))}
            />
          </label>
          <label className="text-sm font-medium">
            {t('wizard.gender')}
            <select
              className={field}
              value={form.gender}
              onChange={(e) => update('gender', e.target.value as EntrepreneurProfile['gender'])}
            >
              <option value="female">{t('wizard.female')}</option>
              <option value="male">{t('wizard.male')}</option>
              <option value="other">{t('wizard.other')}</option>
            </select>
          </label>
          <label className="text-sm font-medium">
            {t('wizard.community')}
            <select
              className={field}
              value={form.community}
              onChange={(e) => update('community', e.target.value as EntrepreneurProfile['community'])}
            >
              <option value="sc">{t('wizard.sc')}</option>
              <option value="st">{t('wizard.st')}</option>
              <option value="obc">{t('wizard.obc')}</option>
              <option value="general">{t('wizard.general')}</option>
            </select>
          </label>
          <label className="text-sm font-medium">
            {t('wizard.income')}
            <input
              className={field}
              type="number"
              value={form.annualIncome}
              onChange={(e) => update('annualIncome', Number(e.target.value))}
            />
          </label>
          <label className="text-sm font-medium">
            {t('wizard.experience')}
            <input
              className={field}
              type="number"
              min={0}
              value={form.experienceYears}
              onChange={(e) => update('experienceYears', Number(e.target.value))}
            />
          </label>
        </div>

        <fieldset className="rounded-2xl border border-forest/10 bg-mist/40 p-4">
          <legend className="px-1 text-sm font-semibold text-forest">{t('wizard.locationMode')}</legend>
          <div className="mt-2 flex flex-wrap gap-3 text-sm">
            <label className="inline-flex items-center gap-2">
              <input
                type="radio"
                name="locMode"
                checked={form.locationMode === 'curated'}
                onChange={() => update('locationMode', 'curated')}
              />
              {t('wizard.curated')}
            </label>
            <label
              className={`inline-flex items-center gap-2 ${form.demoMode ? 'opacity-40' : ''}`}
              title={form.demoMode ? t('wizard.offlineDemoModeHint') : undefined}
            >
              <input
                type="radio"
                name="locMode"
                disabled={form.demoMode}
                checked={form.locationMode === 'live'}
                onChange={() => update('locationMode', 'live')}
              />
              {t('wizard.live')}
            </label>
          </div>

          {form.locationMode === 'curated' ? (
            <label className="mt-3 block text-sm font-medium">
              {t('wizard.village')}
              <select className={field} value={form.villageId} onChange={(e) => update('villageId', e.target.value)}>
                {villages.map((v) => (
                  <option key={v.id} value={v.id}>
                    {kn ? `${v.nameKn}, ${v.districtKn}` : `${v.name}, ${v.district}`} — {v.block}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div className="mt-3 space-y-3">
              <label className="block text-sm font-medium">
                {t('wizard.livePlace')}
                <input
                  className={field}
                  placeholder={kn ? 'ಉದಾ: ಹಾಸನ, ಕರ್ನಾಟಕ' : 'e.g. Hassan, Karnataka'}
                  value={form.liveQuery ?? ''}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      liveQuery: e.target.value,
                      liveLat: undefined,
                      liveLng: undefined,
                    }))
                  }
                />
              </label>
              <button
                type="button"
                onClick={useMyLocation}
                disabled={geoBusy}
                className="inline-flex items-center gap-2 rounded-full border border-forest/20 bg-white px-3 py-1.5 text-xs font-semibold text-forest"
              >
                {geoBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Crosshair className="h-3.5 w-3.5" />}
                {t('wizard.useGps')}
              </button>
              {form.liveLat != null && (
                <p className="text-xs text-sky">
                  <MapPin className="mr-1 inline h-3 w-3" />
                  GPS {form.liveLat.toFixed(4)}, {form.liveLng?.toFixed(4)}
                </p>
              )}
            </div>
          )}

          <label className="mt-3 block text-sm font-medium">
            {t('wizard.radius')} ({REACH_KM.min}–{REACH_KM.max} km)
            <input
              className={field}
              type="range"
              min={REACH_KM.min}
              max={REACH_KM.max}
              step={0.5}
              value={form.radiusKm}
              onChange={(e) => update('radiusKm', Number(e.target.value))}
            />
            <span className="text-xs text-ink/55">{form.radiusKm} km</span>
          </label>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium">
            {t('wizard.category')}
            <select
              className={field}
              value={form.category}
              onChange={(e) => update('category', e.target.value as BusinessCategory)}
            >
              {(Object.keys(BUSINESS_META) as BusinessCategory[]).map((k) => (
                <option key={k} value={k}>
                  {kn ? BUSINESS_META[k].labelKn : BUSINESS_META[k].label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium">
            {t('wizard.margin')}
            <input
              className={field}
              type="number"
              min={1000}
              step={1000}
              max={NSFDC.maxMarginRupees}
              value={form.availableMargin}
              onChange={(e) => update('availableMargin', Number(e.target.value))}
            />
          </label>
        </div>

        {(localErr || error) && (
          <p className="rounded-xl bg-[#ffece8] px-3 py-2 text-sm text-danger" role="alert">
            {localErr || (kn ? errorKn : error)}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-forest px-5 py-3 text-sm font-bold text-white transition hover:bg-leaf disabled:opacity-60 sm:w-auto"
        >
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          {t('wizard.next')}
        </button>
      </form>
    </div>
  )
}
