/**
 * Supabase integration tests — supabaseNotificationService (Option A).
 * Skip by default: SUPABASE_INTEGRATION=1 + service role required.
 * Same gate/setup pattern as src/backend/supabase/supabase.integration.test.ts.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { isSupabaseIntegrationEnabled } from '../../supabase/config'
import { createServiceRoleClient, type LokPulseSupabaseClient } from '../../supabase/client'
import { createSupabaseAditaApplicationPersistence } from '../aditaApplicationPersistence'
import { SCHEME_TS_IDS } from '../schemeCatalogService'
import { createSupabaseNotificationService } from './supabaseNotificationService'
import { newApplicationId } from '../../../apply/application'
import type { NotificationService } from '../types'
import type { NotificationProvider } from './provider'
import type { TrackedApplication } from '../../../apply/types'

const enabled = isSupabaseIntegrationEnabled()

describe.skipIf(!enabled)('supabaseNotificationService (Supabase integration)', () => {
  let client: LokPulseSupabaseClient
  let applicationId: string

  beforeAll(async () => {
    client = createServiceRoleClient()

    // application_notifications / application_notification_preferences FK to
    // applications(application_id) — seed a real LP-APP-* row via Adita's own
    // persistence, same as the shared integration test.
    applicationId = newApplicationId()
    const now = new Date().toISOString()
    const app: TrackedApplication = {
      applicationId,
      trackingId: `TRK-${applicationId}`,
      schemeId: SCHEME_TS_IDS.microFinance,
      schemeName: 'NSFDC Micro Finance',
      channel: 'guided',
      outcome: 'guided_packet_ready',
      filedWithGovernment: false,
      simulation: false,
      honestLabel: 'Guided packet ready',
      detail: 'notifications integration test',
      nextSteps: [],
      packet: {
        schemeId: SCHEME_TS_IDS.microFinance,
        schemeName: 'NSFDC Micro Finance',
        channel: 'guided',
        fields: {},
        documents: [],
        officialApplicationUrl: 'https://nsfdc.nic.in/',
        generatedAt: now,
      },
      consent: { accepted: true, acceptedAt: now, text: 'I consent', channel: 'guided', simulate: false },
      statusHistory: [{ at: now, step: 'status_tracking', note: 'it' }],
      createdAt: now,
      updatedAt: now,
    }
    await createSupabaseAditaApplicationPersistence(client).save(app)
  })

  afterAll(async () => {
    await client.from('application_notifications').delete().eq('application_id', applicationId)
    await client.from('application_notification_preferences').delete().eq('application_id', applicationId)
    await client.from('applications').delete().eq('application_id', applicationId)
  })

  function freshService(providers: Record<string, NotificationProvider> = {}): NotificationService {
    return createSupabaseNotificationService(client, providers)
  }

  it('queues a notification when no provider is registered for the channel', async () => {
    const service = freshService()
    const record = await service.notify({
      applicationId,
      applicationStatus: 'tracked',
      templateCode: 'status_update',
      channel: 'email',
    })
    expect(record.applicationId).toBe(applicationId)
    expect(record.status).toBe('queued')
    expect(record.applicationStatus).toBe('tracked')
  })

  it('sends via a registered provider and persists the provider ref', async () => {
    const provider: NotificationProvider = { channel: 'sms', send: async () => ({ ok: true, providerRef: 'it-sms-1' }) }
    const service = freshService({ sms: provider })
    const record = await service.notify({
      applicationId,
      applicationStatus: 'submitted',
      templateCode: 'status_update',
      channel: 'sms',
    })
    expect(record.status).toBe('sent')
    expect(record.providerRef).toBe('it-sms-1')
  })

  it('respects a disabled preference — skips dispatch rather than calling the provider', async () => {
    const provider: NotificationProvider = { channel: 'whatsapp', send: async () => ({ ok: true }) }
    const service = freshService({ whatsapp: provider })

    const pref = await service.setPreference({ applicationId, channel: 'whatsapp', enabled: false })
    expect(pref.enabled).toBe(false)

    const record = await service.notify({
      applicationId,
      applicationStatus: 'draft',
      templateCode: 'status_update',
      channel: 'whatsapp',
    })
    expect(record.status).toBe('skipped_preference')
  })

  it('lists notifications for this application, most recent first', async () => {
    const service = freshService()
    const list = await service.listForApplication(applicationId)
    expect(list.length).toBeGreaterThanOrEqual(3)
    const timestamps = list.map((n) => Date.parse(n.createdAt))
    expect([...timestamps]).toEqual([...timestamps].sort((a, b) => b - a))
  })
})
