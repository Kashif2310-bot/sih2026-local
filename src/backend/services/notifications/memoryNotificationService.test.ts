import { describe, expect, it } from 'vitest'
import { BackendError } from '../../errors'
import { createMemoryNotificationService } from './memoryNotificationService'
import type { NotificationProvider } from './provider'

const APPLICATION_ID = 'LP-APP-0123456789ABCDEF'

describe('createMemoryNotificationService', () => {
  it('queues a notification when no provider is registered for the channel', async () => {
    const svc = createMemoryNotificationService()
    const record = await svc.notify({
      applicationId: APPLICATION_ID,
      applicationStatus: 'submitted',
      templateCode: 'status_update',
      channel: 'email',
    })
    expect(record.status).toBe('queued')
    expect(record.applicationStatus).toBe('submitted')
  })

  it('sends via a registered provider and records the provider ref', async () => {
    const provider: NotificationProvider = {
      channel: 'sms',
      send: async () => ({ ok: true, providerRef: 'sms-123' }),
    }
    const svc = createMemoryNotificationService({ sms: provider })
    const record = await svc.notify({
      applicationId: APPLICATION_ID,
      applicationStatus: 'tracked',
      templateCode: 'status_update',
      channel: 'sms',
    })
    expect(record.status).toBe('sent')
    expect(record.providerRef).toBe('sms-123')
  })

  it('records failed when a provider reports failure, never claims sent', async () => {
    const provider: NotificationProvider = {
      channel: 'whatsapp',
      send: async () => ({ ok: false, errorMessage: 'vendor timeout' }),
    }
    const svc = createMemoryNotificationService({ whatsapp: provider })
    const record = await svc.notify({
      applicationId: APPLICATION_ID,
      applicationStatus: 'tracked',
      templateCode: 'status_update',
      channel: 'whatsapp',
    })
    expect(record.status).toBe('failed')
    expect(record.errorMessage).toBe('vendor timeout')
  })

  it('skips dispatch when the application has disabled the channel', async () => {
    const provider: NotificationProvider = { channel: 'email', send: async () => ({ ok: true }) }
    const svc = createMemoryNotificationService({ email: provider })
    await svc.setPreference({ applicationId: APPLICATION_ID, channel: 'email', enabled: false })
    const record = await svc.notify({
      applicationId: APPLICATION_ID,
      applicationStatus: 'draft',
      templateCode: 'status_update',
      channel: 'email',
    })
    expect(record.status).toBe('skipped_preference')
  })

  it('lists notifications scoped to a single application', async () => {
    const svc = createMemoryNotificationService()
    await svc.notify({
      applicationId: APPLICATION_ID,
      applicationStatus: 'draft',
      templateCode: 'a',
      channel: 'in_app',
    })
    await svc.notify({
      applicationId: 'LP-APP-FEDCBA9876543210',
      applicationStatus: 'draft',
      templateCode: 'b',
      channel: 'in_app',
    })
    const list = await svc.listForApplication(APPLICATION_ID)
    expect(list).toHaveLength(1)
    expect(list[0]?.templateCode).toBe('a')
  })

  it('rejects a non LP-APP-* applicationId', async () => {
    const svc = createMemoryNotificationService()
    await expect(
      svc.notify({
        applicationId: 'not-an-lp-app-id',
        applicationStatus: 'draft',
        templateCode: 'a',
        channel: 'in_app',
      }),
    ).rejects.toThrow(BackendError)
  })
})
