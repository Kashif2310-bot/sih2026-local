/** Supabase-backed NotificationService (Option A) — public.application_notifications. */

import type { NotifyInput, SetNotificationPreferenceInput } from '../../../contracts/notification'
import { toBackendError } from '../../errors'
import { assertApplicationId } from '../optionA/identity'
import type { LokPulseSupabaseClient } from '../../supabase/client'
import {
  mapApplicationNotification,
  mapNotificationPreference,
  type ApplicationNotificationRow,
  type NotificationPreferenceRow,
} from '../../supabase/mappers'
import type { NotificationService } from '../types'
import type { NotificationProviderMap } from './provider'

export function createSupabaseNotificationService(
  client: LokPulseSupabaseClient,
  providers: NotificationProviderMap = {},
): NotificationService {
  async function insertLog(row: {
    application_id: string
    application_status: string
    template_code: string
    channel: string
    status: string
    recipient: string | null
    provider_ref: string | null
    error_message: string | null
  }) {
    const { data, error } = await client.from('application_notifications').insert(row).select('*').single()
    if (error) throw toBackendError(error)
    return mapApplicationNotification(data as ApplicationNotificationRow)
  }

  return {
    async notify(input: NotifyInput) {
      assertApplicationId(input.applicationId)
      try {
        const { data: prefRow, error: prefErr } = await client
          .from('application_notification_preferences')
          .select('*')
          .eq('application_id', input.applicationId)
          .eq('channel', input.channel)
          .maybeSingle()
        if (prefErr) throw toBackendError(prefErr)
        const enabled = prefRow ? Boolean((prefRow as NotificationPreferenceRow).enabled) : true

        if (!enabled) {
          return await insertLog({
            application_id: input.applicationId,
            application_status: input.applicationStatus,
            template_code: input.templateCode,
            channel: input.channel,
            status: 'skipped_preference',
            recipient: input.recipient ?? null,
            provider_ref: null,
            error_message: null,
          })
        }

        const provider = providers[input.channel]
        if (!provider) {
          return await insertLog({
            application_id: input.applicationId,
            application_status: input.applicationStatus,
            template_code: input.templateCode,
            channel: input.channel,
            status: 'queued',
            recipient: input.recipient ?? null,
            provider_ref: null,
            error_message: null,
          })
        }

        const result = await provider.send({
          applicationId: input.applicationId,
          recipient: input.recipient,
          templateCode: input.templateCode,
          data: input.data,
        })
        return await insertLog({
          application_id: input.applicationId,
          application_status: input.applicationStatus,
          template_code: input.templateCode,
          channel: input.channel,
          status: result.ok ? 'sent' : 'failed',
          recipient: input.recipient ?? null,
          provider_ref: result.providerRef ?? null,
          error_message: result.errorMessage ?? null,
        })
      } catch (err) {
        throw toBackendError(err)
      }
    },

    async getPreferences(applicationId: string) {
      assertApplicationId(applicationId)
      try {
        const { data, error } = await client
          .from('application_notification_preferences')
          .select('*')
          .eq('application_id', applicationId)
        if (error) throw toBackendError(error)
        return ((data ?? []) as NotificationPreferenceRow[]).map(mapNotificationPreference)
      } catch (err) {
        throw toBackendError(err)
      }
    },

    async setPreference(input: SetNotificationPreferenceInput) {
      assertApplicationId(input.applicationId)
      try {
        const { data, error } = await client
          .from('application_notification_preferences')
          .upsert(
            {
              application_id: input.applicationId,
              channel: input.channel,
              enabled: input.enabled,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'application_id,channel' },
          )
          .select('*')
          .single()
        if (error) throw toBackendError(error)
        return mapNotificationPreference(data as NotificationPreferenceRow)
      } catch (err) {
        throw toBackendError(err)
      }
    },

    async listForApplication(applicationId: string, limit = 50) {
      assertApplicationId(applicationId)
      try {
        const { data, error } = await client
          .from('application_notifications')
          .select('*')
          .eq('application_id', applicationId)
          .order('created_at', { ascending: false })
          .limit(limit)
        if (error) throw toBackendError(error)
        return ((data ?? []) as ApplicationNotificationRow[]).map(mapApplicationNotification)
      } catch (err) {
        throw toBackendError(err)
      }
    },
  }
}
