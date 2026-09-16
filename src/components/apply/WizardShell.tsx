import { useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { ReactNode } from 'react'
import { WIZARD_STEPS, stepIndexForPath } from '../../citizen/steps'

export function WizardShell({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: ReactNode
}) {
  const { t } = useTranslation()
  const location = useLocation()
  const index = stepIndexForPath(location.pathname)
  const total = WIZARD_STEPS.length
  const pct = Math.round(((index + 1) / total) * 100)

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-2 flex items-center justify-between text-xs font-semibold text-ink/50">
        <span>{t('apply.stepOf', { current: index + 1, total })}</span>
        <span>{pct}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-mist">
        <div className="h-full rounded-full bg-forest transition-all" style={{ width: `${pct}%` }} />
      </div>

      <div className="mt-6">
        <h1 className="font-display text-2xl font-bold text-forest sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-2 text-ink/65">{subtitle}</p>}
      </div>

      <div className="mt-6">{children}</div>
    </div>
  )
}

export function WizardActions({
  onBack,
  backLabel,
  onNext,
  nextLabel,
  nextDisabled,
  nextBusy,
}: {
  onBack?: () => void
  backLabel?: string
  onNext?: () => void
  nextLabel: string
  nextDisabled?: boolean
  nextBusy?: boolean
}) {
  return (
    <div className="mt-6 flex items-center justify-between gap-3">
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          className="rounded-full border border-forest/20 bg-white px-4 py-2.5 text-sm font-semibold text-forest hover:border-forest/40"
        >
          {backLabel}
        </button>
      ) : (
        <span />
      )}
      {onNext && (
        <button
          type="button"
          onClick={onNext}
          disabled={nextDisabled || nextBusy}
          className="inline-flex items-center gap-2 rounded-full bg-forest px-5 py-2.5 text-sm font-bold text-white transition hover:bg-leaf disabled:opacity-50"
        >
          {nextLabel}
        </button>
      )}
    </div>
  )
}
