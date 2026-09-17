import { useTranslation } from 'react-i18next'
import { CloudOff, Globe, ShieldCheck } from 'lucide-react'
import clsx from 'clsx'
import type { RetrievalSourceStatus } from '../../assistant/types'

const STYLES: Record<RetrievalSourceStatus['status'], { className: string; Icon: typeof Globe }> = {
  live_official: { className: 'border-forest/25 bg-[#e8f6ee] text-forest', Icon: Globe },
  verified_local: { className: 'border-sky/25 bg-[#e8f1f8] text-sky', Icon: ShieldCheck },
  live_unavailable: { className: 'border-gold/40 bg-gold/15 text-[#8a6a00]', Icon: CloudOff },
}

/**
 * Replaces the old, alarmist "Offline reasoning — no AI model used" badge.
 * This is about DATA freshness/provenance, not which AI path answered —
 * it must accurately reflect what actually happened this turn (see
 * orchestrator.ts's attemptLiveRetrieval), never a generic reassurance.
 */
export function SourceStatusBadge({ status }: { status: RetrievalSourceStatus }) {
  const { t } = useTranslation()
  const { className, Icon } = STYLES[status.status]

  const label =
    status.status === 'live_official'
      ? t('assistant.sourceStatus.liveOfficial', {
          time: new Date(status.checkedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
        })
      : status.status === 'verified_local'
        ? t('assistant.sourceStatus.verifiedLocal')
        : t('assistant.sourceStatus.liveUnavailable')

  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold',
        className,
      )}
    >
      <Icon className="h-3 w-3" />
      {label}
    </span>
  )
}
