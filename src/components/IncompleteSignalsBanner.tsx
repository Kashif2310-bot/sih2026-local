import { useTranslation } from 'react-i18next'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { useApp } from '../state/useApp'
import type { LiveSourceId } from '../lib/liveSignals'

export function IncompleteSignalsBanner() {
  const { t } = useTranslation()
  const { dataStatus, failedSources, retryLiveSignals, retryingSignals } = useApp()
  if (dataStatus !== 'incomplete' || failedSources.length === 0) return null

  const sources = failedSources.map((id: LiveSourceId) => t(`signals.source.${id}`)).join(', ')

  return (
    <div
      role="alert"
      className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-danger/30 bg-[#ffece8] px-4 py-3 text-sm text-danger"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <p className="font-medium">{t('signals.banner', { sources })}</p>
      </div>
      <button
        type="button"
        onClick={() => void retryLiveSignals()}
        disabled={retryingSignals}
        className="inline-flex items-center gap-1.5 rounded-full bg-danger px-3 py-1.5 text-xs font-bold text-white disabled:opacity-60"
      >
        {retryingSignals ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
        {retryingSignals ? t('signals.retrying') : t('signals.retry')}
      </button>
    </div>
  )
}
