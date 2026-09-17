import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { WORKFLOW_STEPS, type PreparedApplication, type TrackedApplication } from '../../apply/types'
import { stepStatus } from '../../apply/workflow'

export function WorkflowStepper({
  prepared,
  submitted,
}: {
  prepared: PreparedApplication | null
  submitted?: TrackedApplication
}) {
  const { t } = useTranslation()
  const items = useMemo(() => WORKFLOW_STEPS, [])

  return (
    <ol className="space-y-1.5">
      {items.map((step) => {
        const status = prepared ? stepStatus(step, prepared, submitted) : 'pending'
        return (
          <li key={step} className="flex items-center gap-2 text-xs">
            <span
              className={clsx(
                'grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-bold',
                status === 'done' && 'bg-forest text-white',
                status === 'current' && 'bg-gold text-ink',
                status === 'blocked' && 'bg-danger text-white',
                status === 'pending' && 'bg-mist text-ink/45',
              )}
            >
              {status === 'done' ? '✓' : status === 'blocked' ? '!' : ''}
            </span>
            <span
              className={clsx(
                status === 'done' && 'text-forest',
                status === 'current' && 'font-semibold text-ink',
                status === 'blocked' && 'font-semibold text-danger',
                status === 'pending' && 'text-ink/45',
              )}
            >
              {t(`apply.steps.${step}`)}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

