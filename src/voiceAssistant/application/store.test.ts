import { describe, expect, it, vi } from 'vitest'
import { ApplicationStore, STORE_KEY, type StorageLike } from './store'
import type { SubmittedApplication } from './submission'

function memory(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return { data, getItem: (key) => data.get(key) ?? null, setItem: (key, value) => void data.set(key, value) }
}

const app = (applicationId: string): SubmittedApplication =>
  ({
    version: 1,
    applicationId,
    trackingId: `T-${applicationId}`,
    submittedAt: '2026-09-30T10:00:00.000Z',
    schemeId: 'pm-mudra-yojana',
    schemeName: 'PM Mudra',
    status: 'submitted',
    auditTrail: [],
    applicationSnapshot: { payload: { applicationId }, snapshotHash: 'a', frozenAt: 'x' },
    reportSnapshot: { payload: { applicationId }, snapshotHash: 'b', frozenAt: 'x' },
  }) as unknown as SubmittedApplication

describe('application store', () => {
  it('saves newest first and replaces a resubmitted id', () => {
    const store = new ApplicationStore(memory())
    store.save(app('A'))
    store.save(app('B'))
    expect(store.list().map((a) => a.applicationId)).toEqual(['B', 'A'])
    store.save({ ...app('A'), schemeName: 'changed' })
    expect(store.list().map((a) => a.applicationId)).toEqual(['A', 'B'])
  })

  it('admin decisions change status and audit trail only, never the frozen snapshots', () => {
    const store = new ApplicationStore(memory())
    store.save(app('A'))
    const before = store.get('A')!
    store.setStatus('A', 'approved', 'Documents verified.', '2026-10-01T00:00:00.000Z')
    const after = store.get('A')!
    expect(after.status).toBe('approved')
    expect(after.auditTrail.at(-1)).toEqual({ at: '2026-10-01T00:00:00.000Z', actor: 'admin', action: 'approved', note: 'Documents verified.' })
    expect(after.applicationSnapshot).toEqual(before.applicationSnapshot)
    expect(after.reportSnapshot).toEqual(before.reportSnapshot)
  })

  it('snapshot() keeps the same array until the data changes, and subscribers hear about writes', () => {
    const storage = memory()
    const store = new ApplicationStore(storage)
    const listener = vi.fn()
    store.subscribe(listener)
    const first = store.snapshot()
    expect(store.snapshot()).toBe(first)
    store.save(app('A'))
    expect(listener).toHaveBeenCalledTimes(1)
    const second = store.snapshot()
    expect(second).not.toBe(first)
    expect(store.snapshot()).toBe(second)
    storage.setItem(STORE_KEY, '[]')
    expect(store.snapshot()).toEqual([])
  })

  it('ignores corrupt data and refuses to save without storage', () => {
    const storage = memory()
    storage.setItem(STORE_KEY, '{not json')
    expect(new ApplicationStore(storage).list()).toEqual([])
    expect(() => new ApplicationStore(null).save(app('A'))).toThrow()
  })
})
