import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { listUserAssessments, type AssessmentOut } from '../lib/api'
import { fromPaise } from '../lib/finance'
import { useAuth } from '../state/useAuth'

function newestFirst(rows: AssessmentOut[]): AssessmentOut[] {
  return [...rows].sort((a, b) => {
    const byDate = b.created_at.localeCompare(a.created_at)
    if (byDate !== 0) return byDate
    return b.id.localeCompare(a.id)
  })
}

export function HistoryPage() {
  const { t, i18n } = useTranslation()
  const { user, token } = useAuth()
  const [rows, setRows] = useState<AssessmentOut[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // No setRows(null) here: the render below already returns the
    // logged-out prompt unconditionally when `!user || !token`, without
    // ever reading `rows`, so this effect only needs to skip the fetch.
    if (!user || !token) return
    let cancelled = false
    // Intentional: clears a stale error from a previous failed attempt the
    // instant a new fetch starts (triggered by user/token actually
    // changing), rather than leaving old error text visible during the new
    // request. Not derivable at render time — it depends on the outcome of
    // the previous async attempt, which only the effect knows about.
    // eslint-disable-next-line react/set-state-in-effect
    setError(null)
    void listUserAssessments(user.id, token)
      .then((list) => {
        if (!cancelled) setRows(newestFirst(list))
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : t('history.loadFailed'))
      })
    return () => {
      cancelled = true
    }
  }, [user, token, t])

  if (!user || !token) {
    return (
      <div className="mx-auto max-w-lg">
        <h1 className="font-display text-3xl font-bold text-forest">{t('history.title')}</h1>
        <p className="mt-3 text-ink/65">{t('history.loginPrompt')}</p>
        <p className="mt-2 text-sm text-ink/55">{t('history.guestHint')}</p>
        <Link
          to="/login"
          className="mt-6 inline-flex rounded-full bg-forest px-5 py-2.5 text-sm font-bold text-white"
        >
          {t('nav.login')}
        </Link>
      </div>
    )
  }

  const locale = i18n.language === 'kn' ? 'kn-IN' : 'en-IN'

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="font-display text-3xl font-bold text-forest">{t('history.title')}</h1>
      <p className="mt-2 text-sm text-ink/65">
        {t('auth.loggedInAs', { who: user.name || user.phone || user.id })}
      </p>
      {error && (
        <p className="mt-4 text-sm text-danger" role="alert">
          {error}
        </p>
      )}
      {rows === null && !error && <p className="mt-6 text-sm text-ink/50">{t('common.loading')}</p>}
      {rows && rows.length === 0 && <p className="mt-6 text-sm text-ink/60">{t('history.empty')}</p>}
      {rows && rows.length > 0 && (
        <ul className="mt-6 space-y-3" data-testid="history-list">
          {rows.map((row) => (
            <li key={row.id}>
              <Link
                to={`/pulse/${row.id}`}
                className="glass block rounded-2xl p-4 transition hover:border-forest/30"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-display text-lg font-bold text-forest">{row.location_label}</p>
                  <p className="text-xs font-semibold text-ink/50">
                    {new Date(row.created_at).toLocaleString(locale)}
                  </p>
                </div>
                <p className="mt-1 text-sm text-ink/70">
                  {row.business_category} · {t('history.lokscore')} {Math.round(row.lokscore)} ·{' '}
                  {t('history.margin')} ₹{fromPaise(row.margin_paise).toLocaleString('en-IN')}
                </p>
                <p className="mt-2 text-xs font-bold text-forest">{t('history.open')}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
