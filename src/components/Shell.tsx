import { NavLink, Link, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { BrandLogo } from './BrandLogo'
import { readLastAssessmentId } from '../lib/assessmentSnapshot'
import { useAuth } from '../state/useAuth'
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
    { to: '/home', label: t('nav.home'), apply: false },
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
      <header className="no-print sticky top-0 z-40 isolate border-b border-white/10 bg-black/90 text-white backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <Link to="/home" className="flex shrink-0 items-center" aria-label={t('brand')}>
            <BrandLogo variant="white" className="h-9 w-auto sm:h-10" alt={t('brand')} />
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
                      ? 'bg-white text-black'
                      : 'text-white/70 hover:bg-white/10 hover:text-white',
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
                  className="hidden max-w-[10rem] truncate text-xs font-semibold text-white/70 sm:inline"
                  title={who ?? undefined}
                  data-testid="header-user"
                >
                  {t('auth.loggedInAs', { who: who ?? user.id })}
                </span>
                <button
                  type="button"
                  onClick={logout}
                  className="rounded-full border border-white/25 bg-transparent px-3 py-1.5 text-sm font-semibold text-white transition hover:border-white/60 hover:bg-white/10"
                >
                  {t('nav.logout')}
                </button>
              </>
            ) : (
              <Link
                to="/login"
                className="rounded-full border border-white/25 bg-transparent px-3 py-1.5 text-sm font-semibold text-white transition hover:border-white/60 hover:bg-white/10"
              >
                {t('nav.login')}
              </Link>
            )}
            <button
              type="button"
              onClick={toggle}
              className="rounded-full border border-white/25 bg-transparent px-3 py-1.5 text-sm font-semibold text-white transition hover:border-white/60 hover:bg-white/10"
            >
              {t('lang')}
            </button>
            <Link
              to="/admin/login"
              className="hidden rounded-full bg-white px-3 py-1.5 text-sm font-semibold text-black transition hover:bg-white/85 sm:inline-block"
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
                  isNavActive(l.to, l.apply) ? 'bg-white text-black' : 'bg-white/10 text-white/75',
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
