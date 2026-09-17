import clsx from 'clsx'
import type { ApplicationStatus } from '../platform/types'

const PIPELINE: ApplicationStatus[] = [
  'submitted',
  'under_review',
  'reviewer_assigned',
  'approved',
  'disbursed',
]

export function StatusPipeline({
  status,
  labels,
}: {
  status: ApplicationStatus
  labels: Record<string, string>
}) {
  const rejected = status === 'rejected'
  const idx = PIPELINE.indexOf(status)

  return (
    <ol className="flex flex-wrap gap-2">
      {PIPELINE.map((s, i) => {
        const done = !rejected && idx >= i
        const current = s === status
        return (
          <li
            key={s}
            className={clsx(
              'rounded-full px-3 py-1 text-xs font-semibold',
              current ? 'bg-forest text-white' : done ? 'bg-forest/15 text-forest' : 'bg-mist text-ink/45',
            )}
          >
            {labels[s] ?? s}
          </li>
        )
      })}
      {rejected && (
        <li className="rounded-full bg-red-700 px-3 py-1 text-xs font-bold text-white">
          {labels.rejected ?? 'Rejected'}
        </li>
      )}
    </ol>
  )
}
