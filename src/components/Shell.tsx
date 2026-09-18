import { NavLink, Link, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Radar } from 'lucide-react'
import clsx from 'clsx'
import { readLastAssessmentId } from '../lib/assessmentSnapshot'
import { useAuth } from '../state/AuthContext'
import { useApp } from '../state/useApp'
import { citizenApplyNavPath } from '../apply/resumePath'
import { isCitizenNavActive } from '../nav/citizenNavState'

export function Shell({ children }: { children: React.ReactNode }) {
  const { t, i18n } = useTranslation()
  const kn = i18n.language === 'kn'
  const { assessmentId } = useApp()
  const { user, logout } = useAuth()
  const caseId = assessmentId ?? readLastAssessmentId()
  const who = user?.name || user?.phone || null
  const location = useLocation()
  const applyHref = citizenApplyNavPath()

  const toggle = () => {
    void i18n.changeLanguage(kn ? 'en' : 'kn')
  }

  const withCase = (page: string) => (caseId ? `/${page}/${caseId}` : `/${page}`)

  const links = [
    { to: '/', label: t('nav.home'), apply: false },
    { to: applyHref, label: t('nav.apply'), apply: true },
    { to: '/scan', label: t('nav.scan'), apply: false },
    { to: '/history', label: t('nav.history'), apply: false },
    { to: withCase('pulse'), label: t('nav.pulse'), apply: false },
    { to: withCase('report'), label: t('nav.report'), apply: false },
    { to: withCase('finance'), label: t('nav.finance'), apply: false },
    { to: withCase('sanction'), label: t('nav.sanction'), apply: false },
    { to: withCase('export'), label: t('nav.export'), apply: false },
    { to: caseId ? `/assistant/${caseId}` : '/assistant', label: t('nav.assistant'), apply: false },
  ]

  const isNavActive = (to: string, apply: boolean) => isCitizenNavActive(location.pathname, to, apply)

  return (
    <div className={clsx('min-h-screen', kn && 'kn')}>
      <header className="no-print sticky top-0 z-40 isolate border-b border-forest/10 bg-[#f7faf8]/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <Link to="/" className="flex items-center gap-2 text-forest">
            <span className="relative grid h-9 w-9 place-items-center rounded-xl bg-forest text-gold">
              <Radar className="h-5 w-5" />
              <span className="pulse-ring absolute inset-0 rounded-xl border border-gold/60" />
            </span>
            <span className="font-display text-lg font-bold tracking-tight sm:text-xl">
              {t('brand')}
            </span>
          </Link>

          <nav className="hidden items-center gap-1 md:flex">
            {links.map((l) => (
              <NavLink
                key={l.label}
                to={l.to}
                className={() =>
                  clsx(
                    'rounded-lg px-3 py-1.5 text-sm font-medium transition',
                    isNavActive(l.to, l.apply)
                      ? 'bg-forest text-white'
                      : 'text-ink/70 hover:bg-mist hover:text-forest',
                  )
                }
              >
                {l.label}
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            {user ? (
              <>
                <span
                  className="hidden max-w-[10rem] truncate text-xs font-semibold text-ink/70 sm:inline"
                  title={who ?? undefined}
                  data-testid="header-user"
                >
                  {t('auth.loggedInAs', { who: who ?? user.id })}
                </span>
                <button
                  type="button"
                  onClick={logout}
                  className="rounded-full border border-forest/20 bg-white px-3 py-1.5 text-sm font-semibold text-forest shadow-sm transition hover:border-forest/40"
                >
                  {t('nav.logout')}
                </button>
              </>
            ) : (
              <Link
                to="/login"
                className="rounded-full border border-forest/20 bg-white px-3 py-1.5 text-sm font-semibold text-forest shadow-sm transition hover:border-forest/40"
              >
                {t('nav.login')}
              </Link>
            )}
            <button
              type="button"
              onClick={toggle}
              className="rounded-full border border-forest/20 bg-white px-3 py-1.5 text-sm font-semibold text-forest shadow-sm transition hover:border-forest/40"
            >
              {t('lang')}
            </button>
            <Link
              to="/admin/login"
              className="hidden rounded-full border border-forest/20 bg-white px-3 py-1.5 text-sm font-semibold text-forest shadow-sm transition hover:border-forest/40 sm:inline-block"
            >
              {t('nav.admin')}
            </Link>
          </div>
        </div>
        <div className="flex gap-1 overflow-x-auto px-4 pb-2 md:hidden">
          {links.map((l) => (
            <NavLink
              key={l.label}
              to={l.to}
              className={() =>
                clsx(
                  'shrink-0 rounded-full px-3 py-1 text-xs font-medium',
                  isNavActive(l.to, l.apply) ? 'bg-forest text-white' : 'bg-white text-ink/70',
                )
              }
            >
              {l.label}
            </NavLink>
          ))}
        </div>
      </header>
      <main className="relative z-0 mx-auto max-w-6xl px-4 py-6 sm:py-10">{children}</main>
    </div>
  )
}
