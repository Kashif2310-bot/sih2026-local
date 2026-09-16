import { describe, expect, it } from 'vitest'
import { createMemoryApplicationServices, createMemoryProfileService } from '../index'
import type { Uuid } from '../../contracts/common'

describe('memory profile service', () => {
  it('creates, patches, and reports missing fields', async () => {
    const svc = createMemoryProfileService()
    const created = await svc.create('kn')
    expect(created.id).toBeTruthy()
    expect(created.locale).toBe('kn')

    const patched = await svc.applyPatch(created.id!, {
      name: { value: 'Ravi', confidence: 'high', source: 'voice' },
      availableMargin: { value: 50_000, confidence: 'medium', source: 'voice' },
    })
    expect(patched.name.value).toBe('Ravi')
    expect(patched.availableMargin.value).toBe(50_000)

    const missing = await svc.getMissingFields(created.id!)
    expect(missing.some((m) => m.key === 'category')).toBe(true)
    expect(missing.some((m) => m.key === 'name')).toBe(false)
  })
})

describe('memory application services', () => {
  it('persists applications, versions, consent, and status views', async () => {
    const { persistence, status } = createMemoryApplicationServices()
    const userId = crypto.randomUUID() as Uuid

    const app = await persistence.create({
      userId,
      initialFields: [
        {
          key: 'business_name',
          value: 'Lakshmi Dairy',
          source: 'user',
          updatedAt: new Date().toISOString(),
        },
      ],
    })
    expect(app.status).toBe('fields_pending')

    const schemeId = '22222222-2222-4222-8222-222222222202' as Uuid
    const versionId = '33333333-3333-4333-8333-333333333302' as Uuid
    await persistence.attachScheme(app.id, schemeId, versionId, userId)
    await persistence.recordConsent(app.id, userId)

    const view = await status.getStatusView(app.id)
    expect(view).not.toBeNull()
    expect(view!.application.consentAt).toBeTruthy()
    expect(view!.application.status).toBe('ready_to_submit')
    expect(view!.latestVersion?.payload.business_name).toBe('Lakshmi Dairy')
    expect(view!.latestVersion?.payloadHash.length).toBe(64)

    const events = await status.listEvents(app.id)
    expect(events.some((e) => e.type === 'created')).toBe(true)
    expect(events.some((e) => e.type === 'consent_recorded')).toBe(true)
  })
})
