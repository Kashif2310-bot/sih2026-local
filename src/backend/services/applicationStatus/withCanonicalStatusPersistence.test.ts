import { describe, expect, it } from 'vitest'
import { newApplicationId } from '../../../apply/application'
import { WORKFLOW_STEPS } from '../../../apply/types'
import type { TrackedApplication, WorkflowStep } from '../../../apply/types'
import { BackendError } from '../../errors'
import { createMemoryAditaApplicationPersistence } from '../aditaApplicationPersistence'
import { createMemoryApplicationStatusStore } from './memoryApplicationStatusStore'
import { withCanonicalStatusPersistence } from './withCanonicalStatusPersistence'

function buildApp(applicationId: string, step: WorkflowStep, overrides: Partial<TrackedApplication> = {}): TrackedApplication {
  const now = new Date().toISOString()
  return {
    applicationId,
    trackingId: `TRK-${applicationId}`,
    schemeId: 'nsfdc-micro-finance',
    schemeName: 'NSFDC Micro Finance',
    channel: 'guided',
    outcome: 'guided_packet_ready',
    filedWithGovernment: false,
    simulation: false,
    honestLabel: 'test',
    detail: 'test',
    nextSteps: [],
    packet: {
      schemeId: 'nsfdc-micro-finance',
      schemeName: 'NSFDC Micro Finance',
      channel: 'guided',
      fields: {},
      documents: [],
      officialApplicationUrl: 'https://nsfdc.nic.in/',
      generatedAt: now,
    },
    consent: { accepted: false, text: '', channel: 'guided', simulate: false },
    statusHistory: [{ at: now, step, note: 'test' }],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function setup() {
  const inner = createMemoryAditaApplicationPersistence()
  const store = createMemoryApplicationStatusStore()
  const service = withCanonicalStatusPersistence(inner, store)
  return { inner, store, service }
}

describe('withCanonicalStatusPersistence', () => {
  it('a new application starts draft', async () => {
    const { service, store } = setup()
    const id = newApplicationId()
    await service.save(buildApp(id, 'profile_and_scheme'))
    expect(await store.getStatus(id)).toBe('draft')
  })

  it('reaching explicit_consent persists awaiting_consent', async () => {
    const { service, store } = setup()
    const id = newApplicationId()
    await service.save(buildApp(id, 'explicit_consent'))
    expect(await store.getStatus(id)).toBe('awaiting_consent')
  })

  it('reaching submission persists submitted', async () => {
    const { service, store } = setup()
    const id = newApplicationId()
    await service.save(buildApp(id, 'submission'))
    expect(await store.getStatus(id)).toBe('submitted')
  })

  it('reaching status_tracking persists tracked', async () => {
    const { service, store } = setup()
    const id = newApplicationId()
    await service.save(buildApp(id, 'status_tracking'))
    expect(await store.getStatus(id)).toBe('tracked')
  })

  it('persisted status survives reload — repeated reads return the stored value, not a recomputation', async () => {
    const { service, store } = setup()
    const id = newApplicationId()
    await service.save(buildApp(id, 'explicit_consent'))
    expect(await store.getStatus(id)).toBe('awaiting_consent')
    expect(await store.getStatus(id)).toBe('awaiting_consent')
  })

  it('maps all 13 WorkflowStep values exhaustively through an actual save()', async () => {
    expect(WORKFLOW_STEPS).toHaveLength(13)
    const { service, store } = setup()
    for (const step of WORKFLOW_STEPS) {
      const id = newApplicationId()
      await service.save(buildApp(id, step))
      expect(['draft', 'awaiting_consent', 'submitted', 'tracked']).toContain(await store.getStatus(id))
    }
  })

  it('changing statusHistory alone (without calling save again) does not change the persisted canonical status', async () => {
    const { service, store } = setup()
    const id = newApplicationId()
    const app = buildApp(id, 'profile_and_scheme')
    await service.save(app)
    expect(await store.getStatus(id)).toBe('draft')

    // Mutate the same in-memory object's statusHistory directly — no save() call follows.
    app.statusHistory.push({ at: new Date().toISOString(), step: 'status_tracking', note: 'local mutation only' })

    expect(await store.getStatus(id)).toBe('draft')
  })

  it('a subsequent save() with a new step does update the persisted status', async () => {
    const { service, store } = setup()
    const id = newApplicationId()
    await service.save(buildApp(id, 'profile_and_scheme'))
    expect(await store.getStatus(id)).toBe('draft')

    await service.save(buildApp(id, 'submission'))
    expect(await store.getStatus(id)).toBe('submitted')
  })

  it('rejects an invalid canonical status at the store boundary', async () => {
    const { store } = setup()
    const id = newApplicationId()
    await expect(store.setStatus(id, 'approved' as never)).rejects.toThrow(BackendError)
  })

  it('LP-APP-* remains the only application identity accepted by the store', async () => {
    const { store } = setup()
    await expect(store.getStatus('not-an-lp-app-id')).rejects.toThrow(BackendError)
    await expect(store.setStatus('not-an-lp-app-id', 'draft')).rejects.toThrow(BackendError)
  })

  it('"submitted" reflects only that submission was attempted, never a government confirmation', async () => {
    const { service, store } = setup()
    const id = newApplicationId()
    // Guided channel: packet prepared, citizen files it themselves — honestly
    // never claims government acceptance. Reaches the submission workflow
    // step regardless.
    await service.save(
      buildApp(id, 'submission', { outcome: 'guided_packet_ready', filedWithGovernment: false }),
    )
    const app = await service.get(id)
    expect(await store.getStatus(id)).toBe('submitted')
    expect(app?.filedWithGovernment).toBe(false)
    expect(app?.outcome).not.toBe('submitted_to_government')
  })

  it('passes through every other AditaApplicationPersistence method unchanged', async () => {
    const { inner, service } = setup()
    const id = newApplicationId()
    await service.save(buildApp(id, 'profile_and_scheme'))
    expect(await service.get(id)).toEqual(await inner.get(id))
    expect(await service.list()).toEqual(await inner.list())
  })
})
