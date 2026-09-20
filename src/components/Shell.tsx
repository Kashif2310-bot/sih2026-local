import { NavLink, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Radar } from 'lucide-react'
import clsx from 'clsx'
import { readLastAssessmentId } from '../lib/assessmentSnapshot'
import { useApp } from '../state/useApp'

export function Shell({ children }: { children: React.ReactNode }) {
  const { t, i18n } = useTranslation()
  const kn = i18n.language === 'kn'
  const { assessmentId } = useApp()
  const caseId = assessmentId ?? readLastAssessmentId()

  const toggle = () => {
    void i18n.changeLanguage(kn ? 'en' : 'kn')
  }

  const withCase = (page: string) => (caseId ? `/${page}/${caseId}` : `/${page}`)

  const links = [
    { to: '/', label: t('nav.home') },
    { to: '/scan', label: t('nav.scan') },
    { to: withCase('pulse'), label: t('nav.pulse') },
    { to: withCase('report'), label: t('nav.report') },
    { to: withCase('finance'), label: t('nav.finance') },
    { to: withCase('sanction'), label: t('nav.sanction') },
    { to: withCase('export'), label: t('nav.export') },
    { to: caseId ? `/assistant/${caseId}` : '/assistant', label: t('nav.assistant') },
  ]

  return (
    <div className={clsx('min-h-screen', kn && 'kn')}>
      <header className="no-print sticky top-0 z-40 border-b border-forest/10 bg-[#f7faf8]/85 backdrop-blur-md">
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
                key={l.to}
                to={l.to}
                className={({ isActive }) =>
                  clsx(
                    'rounded-lg px-3 py-1.5 text-sm font-medium transition',
                    isActive ? 'bg-forest text-white' : 'text-ink/70 hover:bg-mist hover:text-forest',
                  )
                }
                end={l.to === '/'}
              >
                {l.label}
              </NavLink>
            ))}
          </nav>

          <button
            type="button"
            onClick={toggle}
            className="rounded-full border border-forest/20 bg-white px-3 py-1.5 text-sm font-semibold text-forest shadow-sm transition hover:border-forest/40"
          >
            {t('lang')}
          </button>
        </div>
        <div className="flex gap-1 overflow-x-auto px-4 pb-2 md:hidden">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              className={({ isActive }) =>
                clsx(
                  'shrink-0 rounded-full px-3 py-1 text-xs font-medium',
                  isActive ? 'bg-forest text-white' : 'bg-white text-ink/70',
                )
              }
              end={l.to === '/'}
            >
              {l.label}
            </NavLink>
          ))}
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:py-10">{children}</main>
    </div>
  )
}
