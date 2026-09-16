import { useEffect, type ReactNode } from 'react'
import { Link, NavLink, Navigate, Outlet, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Radar } from 'lucide-react'
import clsx from 'clsx'
import { seedDemoApplicationsOnce } from '../platform/store'
import { useAdminAuth } from './useAdminAuth'

export function AdminShell() {
  const { t, i18n } = useTranslation()
  const kn = i18n.language === 'kn'
  const { session, logout } = useAdminAuth()
  const location = useLocation()

  useEffect(() => {
    seedDemoApplicationsOnce()
  }, [])

  if (!session && location.pathname !== '/admin/login') {
    return <Navigate to="/admin/login" replace state={{ from: location.pathname }} />
  }

  if (session && location.pathname === '/admin/login') {
    return <Navigate to="/admin" replace />
  }

  if (!session) {
    return <Outlet />
  }

  const links = [
    { to: '/admin', label: t('admin.nav.dashboard'), end: true },
    { to: '/admin/applications', label: t('admin.nav.applications'), end: false },
    { to: '/admin/audit', label: t('admin.nav.audit'), end: false },
  ]

  const toggle = () => {
    void i18n.changeLanguage(kn ? 'en' : 'kn')
  }

  return (
    <div className={clsx('min-h-screen bg-[#f0f4f2]', kn && 'kn')}>
      <header className="sticky top-0 z-40 border-b border-forest/15 bg-[#e8f0eb]/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <Link to="/admin" className="flex items-center gap-2 text-forest">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-forest text-gold">
              <Radar className="h-5 w-5" />
            </span>
            <span className="font-display text-lg font-bold tracking-tight">{t('admin.brand')}</span>
          </Link>

          <nav className="hidden items-center gap-1 md:flex">
            {links.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.end}
                className={({ isActive }) =>
                  clsx(
                    'rounded-lg px-3 py-1.5 text-sm font-medium transition',
                    isActive ? 'bg-forest text-white' : 'text-ink/70 hover:bg-white hover:text-forest',
                  )
                }
              >
                {l.label}
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggle}
              className="rounded-full border border-forest/20 bg-white px-3 py-1.5 text-sm font-semibold text-forest"
            >
              {t('lang')}
            </button>
            <button
              type="button"
              onClick={logout}
              className="rounded-full border border-forest/20 bg-white px-3 py-1.5 text-sm font-semibold text-forest"
            >
              {t('admin.nav.logout')}
            </button>
          </div>
        </div>
        <div className="flex gap-1 overflow-x-auto px-4 pb-2 md:hidden">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              className={({ isActive }) =>
                clsx(
                  'shrink-0 rounded-full px-3 py-1 text-xs font-medium',
                  isActive ? 'bg-forest text-white' : 'bg-white text-ink/70',
                )
              }
            >
              {l.label}
            </NavLink>
          ))}
        </div>
      </header>

      <div className="border-b border-amber-200/80 bg-amber-50 px-4 py-2 text-center text-xs text-ink/70">
        {t('admin.storageNote')}
      </div>

      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 pt-3 text-xs">
        <span className="text-ink/55">{session.name}</span>
        <Link to="/" className="font-semibold text-forest hover:underline">
          {t('admin.backToCitizen')}
        </Link>
      </div>

      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  )
}

export function AdminRouteFallback({ children }: { children?: ReactNode }) {
  const { t } = useTranslation()
  return children ?? <div className="py-16 text-center text-sm text-ink/50">{t('common.loading')}</div>
}
