import { useTranslation } from 'react-i18next'
import { AlertTriangle, CheckCircle2, HelpCircle, XCircle } from 'lucide-react'
import clsx from 'clsx'
import type { EligibilityStatus } from '../../assistant/types'

const STYLES: Record<EligibilityStatus, { className: string; Icon: typeof CheckCircle2 }> = {
  likely_eligible: { className: 'bg-black text-white border-black', Icon: CheckCircle2 },
  possibly_eligible: { className: 'bg-[#e6e6e6] text-ink border-black/20', Icon: AlertTriangle },
  insufficient_data: { className: 'bg-white text-ink/70 border-dashed border-black/25', Icon: HelpCircle },
  likely_ineligible: { className: 'bg-[#f4f4f4] text-ink/50 border-black/10', Icon: XCircle },
}

export function StatusBadge({ status }: { status: EligibilityStatus }) {
  const { t } = useTranslation()
  const { className, Icon } = STYLES[status]
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold',
        className,
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {t(`assistant.status.${status}`)}
    </span>
  )
}
