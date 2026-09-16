import { describe, expect, it } from 'vitest'
import { flattenAuditTrail, isPendingStatus } from './auditHelpers'
import type { Application } from '../platform/types'

describe('admin/auditHelpers', () => {
  const base = (id: string, status: Application['status'], at: number): Application =>
    ({
      id,
      createdAt: at,
      updatedAt: at,
      applicant: { name: `Person ${id}` },
      status,
      auditTrail: [
        { id: `${id}-1`, at, actor: 'A', action: 'submitted' },
        { id: `${id}-2`, at: at + 10, actor: 'B', action: 'reviewed' },
      ],
    }) as Application

  it('flattens and sorts audit events newest first', () => {
    const rows = flattenAuditTrail([base('a', 'submitted', 1000), base('b', 'approved', 2000)])
    expect(rows[0]?.applicationId).toBe('b')
    expect(rows[0]?.action).toBe('reviewed')
    expect(rows).toHaveLength(4)
  })

  it('classifies pending statuses', () => {
    expect(isPendingStatus('submitted')).toBe(true)
    expect(isPendingStatus('under_review')).toBe(true)
    expect(isPendingStatus('reviewer_assigned')).toBe(true)
    expect(isPendingStatus('approved')).toBe(false)
    expect(isPendingStatus('rejected')).toBe(false)
  })
})
