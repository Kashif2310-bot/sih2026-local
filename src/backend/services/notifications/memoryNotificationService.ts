/** In-memory NotificationService — Option A local/dev implementation. */

import type {
  NotificationPreference,
  NotificationRecord,
  NotifyInput,
  SetNotificationPreferenceInput,
} from '../../../contracts/notification'
import { assertApplicationId } from '../optionA/identity'
import type { NotificationService } from '../types'
import type { NotificationProviderMap } from './provider'

function newId(): string {
  return crypto.randomUUID()
}

export function createMemoryNotificationService(providers: NotificationProviderMap = {}): NotificationService {
  const preferences = new Map<string, NotificationPreference>() // key `${applicationId}:${channel}`
  const log: NotificationRecord[] = []

  function prefKey(applicationId: string, channel: NotificationPreference['channel']): string {
    return `${applicationId}:${channel}`
  }

  return {
    async notify(input: NotifyInput) {
      assertApplicationId(input.applicationId)

      const pref = preferences.get(prefKey(input.applicationId, input.channel))
      const enabled = pref?.enabled ?? true // default: transactional notifications opt-out, not opt-in

      let record: NotificationRecord
      if (!enabled) {
        record = {
          id: newId(),
          applicationId: input.applicationId,
          applicationStatus: input.applicationStatus,
          templateCode: input.templateCode,
          channel: input.channel,
          status: 'skipped_preference',
          recipient: input.recipient ?? null,
          providerRef: null,
          errorMessage: null,
          createdAt: new Date().toISOString(),
        }
      } else {
        const provider = providers[input.channel]
        if (!provider) {
          record = {
            id: newId(),
            applicationId: input.applicationId,
            applicationStatus: input.applicationStatus,
            templateCode: input.templateCode,
            channel: input.channel,
            status: 'queued',
            recipient: input.recipient ?? null,
            providerRef: null,
            errorMessage: null,
            createdAt: new Date().toISOString(),
          }
        } else {
          const result = await provider.send({
            applicationId: input.applicationId,
            recipient: input.recipient,
            templateCode: input.templateCode,
            data: input.data,
          })
          record = {
            id: newId(),
            applicationId: input.applicationId,
            applicationStatus: input.applicationStatus,
            templateCode: input.templateCode,
            channel: input.channel,
            status: result.ok ? 'sent' : 'failed',
            recipient: input.recipient ?? null,
            providerRef: result.providerRef ?? null,
            errorMessage: result.errorMessage ?? null,
            createdAt: new Date().toISOString(),
          }
        }
      }

      log.push(record)
      return record
    },

    async getPreferences(applicationId: string) {
      assertApplicationId(applicationId)
      return [...preferences.values()].filter((p) => p.applicationId === applicationId)
    },

    async setPreference(input: SetNotificationPreferenceInput) {
      assertApplicationId(input.applicationId)
      const pref: NotificationPreference = {
        applicationId: input.applicationId,
        channel: input.channel,
        enabled: input.enabled,
      }
      preferences.set(prefKey(input.applicationId, input.channel), pref)
      return pref
    },

    async listForApplication(applicationId: string, limit = 50) {
      assertApplicationId(applicationId)
      return log.filter((n) => n.applicationId === applicationId).slice(-limit)
    },
  }
}
