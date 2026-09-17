import { describe, expect, it } from 'vitest'
import { buildSubmissionPackage, freezeSnapshot, newApplicationId } from '../../../apply/application'
import type { TrackedApplication, WorkflowStep } from '../../../apply/types'
import { BackendError } from '../../errors'
import { createMemoryAditaApplicationPersistence } from '../aditaApplicationPersistence'
import { createAdminApplicationQueries } from '../adminApplicationQueries'
import { createMemoryApplicationStatusStore } from '../applicationStatus/memoryApplicationStatusStore'
import { withCanonicalStatusPersistence } from '../applicationStatus/withCanonicalStatusPersistence'
import { getApplicationPackage } from './getApplicationPackage'

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
    honestLabel: 'Guided packet ready',
    detail: 'test',
    nextSteps: [],
    packet: {
      schemeId: 'nsfdc-micro-finance',
      schemeName: 'NSFDC Micro Finance',
      channel: 'guided',
      fields: { name: 'Test Applicant' },
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
  const store = createMemoryApplicationStatusStore()
  const inner = createMemoryAditaApplicationPersistence()
  const persistence = withCanonicalStatusPersistence(inner, store)
  const admin = createAdminApplicationQueries(persistence)
  return { persistence, store, admin }
}

describe('getApplicationPackage', () => {
  it('returns the package for a valid, existing application', async () => {
    const { persistence, admin, store } = setup()
    const id = newApplicationId()
    await persistence.save(buildApp(id, 'generated_application'))

    const result = await getApplicationPackage({ admin, canonicalApplicationStatus: store }, id)
    expect(result).not.toBeNull()
    expect(result?.applicationId).toBe(id)
    expect(result?.applicationStatus).toBe('draft')
  })

  it('rejects an invalid LP-APP-* id before touching persistence', async () => {
    const { admin, store } = setup()
    await expect(getApplicationPackage({ admin, canonicalApplicationStatus: store }, 'not-an-lp-app-id')).rejects.toThrow(
      BackendError,
    )
  })

  it('returns null for a well-formed id that does not exist', async () => {
    const { admin, store } = setup()
    const result = await getApplicationPackage({ admin, canonicalApplicationStatus: store }, newApplicationId())
    expect(result).toBeNull()
  })

  it('submissionPackage is null until the application is frozen/consented, then reflects the real package', async () => {
    const { persistence, admin, store } = setup()
    const id = newApplicationId()
    await persistence.save(buildApp(id, 'generated_application'))

    const notYet = await getApplicationPackage({ admin, canonicalApplicationStatus: store }, id)
    expect(notYet?.submissionPackage).toBeNull()

    const snapshot = await freezeSnapshot({ name: 'Test Applicant' }, new Date().toISOString())
    const submissionPackage = buildSubmissionPackage({ applicationId: id, filedWithGovernment: false, snapshot })
    await persistence.save(buildApp(id, 'application_id', { snapshot, package: submissionPackage }))

    const ready = await getApplicationPackage({ admin, canonicalApplicationStatus: store }, id)
    expect(ready?.submissionPackage).not.toBeNull()
    expect(ready?.submissionPackage?.applicationId).toBe(id)
    expect(ready?.submissionPackage?.readyForApproval).toBe(true)
  })

  it('a "submitted" canonical status never implies government acceptance', async () => {
    const { persistence, admin, store } = setup()
    const id = newApplicationId()
    await persistence.save(
      buildApp(id, 'submission', { outcome: 'guided_packet_ready', filedWithGovernment: false }),
    )

    const result = await getApplicationPackage({ admin, canonicalApplicationStatus: store }, id)
    expect(result?.applicationStatus).toBe('submitted')
    expect(result?.filedWithGovernment).toBe(false)
    expect(result?.outcome).not.toBe('submitted_to_government')
    expect(result?.governmentApplicationId).toBeNull()
  })

  it('never fabricates a government application id — echoes null when none was ever recorded', async () => {
    const { persistence, admin, store } = setup()
    const id = newApplicationId()
    await persistence.save(buildApp(id, 'status_tracking', { governmentApplicationId: undefined }))

    const result = await getApplicationPackage({ admin, canonicalApplicationStatus: store }, id)
    expect(result?.governmentApplicationId).toBeNull()
  })

  it('package contains the authoritative application data, byte-for-byte from what was saved', async () => {
    const { persistence, admin, store } = setup()
    const id = newApplicationId()
    const app = buildApp(id, 'user_review', {
      honestLabel: 'Custom honest label',
      detail: 'Custom detail text',
      nextSteps: ['step_one', 'step_two'],
    })
    await persistence.save(app)

    const result = await getApplicationPackage({ admin, canonicalApplicationStatus: store }, id)
    expect(result?.schemeId).toBe(app.schemeId)
    expect(result?.schemeName).toBe(app.schemeName)
    expect(result?.channel).toBe(app.channel)
    expect(result?.honestLabel).toBe('Custom honest label')
    expect(result?.detail).toBe('Custom detail text')
    expect(result?.nextSteps).toEqual(['step_one', 'step_two'])
    expect(result?.packet).toEqual(app.packet)
    expect(result?.consent).toEqual(app.consent)
    expect(result?.statusHistory).toEqual(app.statusHistory)
    expect(result?.createdAt).toBe(app.createdAt)
    expect(result?.updatedAt).toBe(app.updatedAt)
  })
})
