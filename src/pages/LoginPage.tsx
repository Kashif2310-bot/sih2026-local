import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ApiError, claimAssessment } from '../lib/api'
import { readLastAssessmentId } from '../lib/assessmentSnapshot'
import { useAuth } from '../state/useAuth'
import { useApp } from '../state/useApp'

export function LoginPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { user, requestOtp, verifyOtp } = useAuth()
  const { assessmentId } = useApp()
  const [step, setStep] = useState<'phone' | 'otp'>('phone')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const field =
    'mt-1 w-full rounded-xl border border-forest/15 bg-white px-3 py-2.5 text-sm outline-none ring-forest/30 focus:ring-2'

  const sendCode = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = phone.trim()
    if (!trimmed) {
      setError(t('auth.phoneRequired'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      await requestOtp(trimmed)
      setStep('otp')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('auth.failed'))
    } finally {
      setBusy(false)
    }
  }

  const confirmCode = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!code.trim()) {
      setError(t('auth.otpRequired'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      const session = await verifyOtp(phone.trim(), code.trim())
      const id = assessmentId ?? readLastAssessmentId()
      if (id) {
        try {
          await claimAssessment(id, session.token)
        } catch {
          // Guest scans that never reached the server stay local.
        }
      }
      navigate('/history')
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError(t('auth.wrongCode'))
      } else {
        setError(err instanceof ApiError ? err.message : t('auth.failed'))
      }
    } finally {
      setBusy(false)
    }
  }

  if (user) {
    return (
      <div className="mx-auto max-w-md">
        <h1 className="font-display text-3xl font-bold text-forest">{t('auth.title')}</h1>
        <p className="mt-3 text-sm text-ink/70">
          {t('auth.loggedInAs', { who: user.name || user.phone || user.id })}
        </p>
        <p className="mt-4 text-sm font-semibold text-forest">{t('auth.demoOtp')}</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            to="/history"
            className="rounded-full bg-forest px-5 py-2.5 text-sm font-bold text-white"
          >
            {t('nav.history')}
          </Link>
          <Link
            to="/scan"
            className="rounded-full border border-forest/20 bg-white px-5 py-2.5 text-sm font-semibold text-forest"
          >
            {t('auth.continueAsGuest')}
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-md">
      <h1 className="font-display text-3xl font-bold text-forest">{t('auth.title')}</h1>
      <p className="mt-2 text-ink/65">{t('auth.subtitle')}</p>
      <p className="mt-3 text-sm font-semibold text-forest" data-testid="demo-otp-hint">
        {t('auth.demoOtp')}
      </p>
      <p className="mt-2 text-xs text-ink/55">{t('auth.guestNote')}</p>

      {step === 'phone' ? (
        <form onSubmit={(e) => void sendCode(e)} className="glass mt-6 space-y-4 rounded-[1.5rem] p-6" noValidate>
          <label className="text-sm font-medium">
            {t('auth.phone')}
            <input
              className={field}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={phone}
              placeholder={t('auth.phonePlaceholder')}
              onChange={(e) => {
                setPhone(e.target.value)
                setError(null)
              }}
            />
          </label>
          {error && (
            <p className="text-sm text-danger" role="alert">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-full bg-forest px-5 py-2.5 text-sm font-bold text-white disabled:opacity-60"
          >
            {busy ? t('common.loading') : t('auth.sendOtp')}
          </button>
        </form>
      ) : (
        <form onSubmit={(e) => void confirmCode(e)} className="glass mt-6 space-y-4 rounded-[1.5rem] p-6" noValidate>
          <p className="text-sm text-ink/70">
            {t('auth.codeSent', { phone })}
          </p>
          <label className="text-sm font-medium">
            {t('auth.otp')}
            <input
              className={field}
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              placeholder={t('auth.otpPlaceholder')}
              onChange={(e) => {
                setCode(e.target.value)
                setError(null)
              }}
            />
          </label>
          {error && (
            <p className="text-sm text-danger" role="alert">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-full bg-forest px-5 py-2.5 text-sm font-bold text-white disabled:opacity-60"
          >
            {busy ? t('common.loading') : t('auth.verify')}
          </button>
          <button
            type="button"
            className="w-full text-sm font-semibold text-forest"
            onClick={() => {
              setStep('phone')
              setCode('')
              setError(null)
            }}
          >
            {t('auth.changePhone')}
          </button>
        </form>
      )}

      <p className="mt-6 text-center text-sm">
        <Link to="/scan" className="font-semibold text-forest underline-offset-2 hover:underline">
          {t('auth.continueAsGuest')}
        </Link>
      </p>
    </div>
  )
}
