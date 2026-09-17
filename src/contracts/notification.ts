/**
 * Provider-agnostic notification contracts (Option A / LP-APP-*). No
 * channel is hardcoded to one vendor — see
 * src/backend/services/notifications/provider.ts.
 *
 * Keyed by applicationId (LP-APP-*), not a user account — there is no
 * accounts/profiles table in the reconciled schema to anchor a userId to.
 * Each record snapshots the CanonicalApplicationStatus at notify time for
 * reference; this service is a dispatch/log layer only and must never
 * become a second source of truth for application lifecycle state — the
 * status itself always comes from canonicalStatusForTrackedApplication().
 */

import type { CanonicalApplicationStatus } from './applicationStatus'
import type { IsoDateTime } from './common'

export type NotificationChannel = 'email' | 'sms' | 'whatsapp' | 'in_app'

export interface NotificationPreference {
  applicationId: string
  channel: NotificationChannel
  enabled: boolean
}

/**
 * 'queued' means logged but not actually dispatched (no provider wired for
 * this channel) — never claimed as 'sent' unless a real provider confirmed it.
 */
export type NotificationStatus = 'queued' | 'sent' | 'failed' | 'skipped_preference'

export interface NotificationRecord {
  id: string
  applicationId: string
  applicationStatus: CanonicalApplicationStatus
  templateCode: string
  channel: NotificationChannel
  status: NotificationStatus
  recipient: string | null
  providerRef: string | null
  errorMessage: string | null
  createdAt: IsoDateTime
}

export interface NotifyInput {
  applicationId: string
  applicationStatus: CanonicalApplicationStatus
  templateCode: string
  channel: NotificationChannel
  /** Opaque contact string (email/phone) supplied by the caller — resolved from no users table. */
  recipient?: string | null
  data?: Record<string, unknown>
}

export interface SetNotificationPreferenceInput {
  applicationId: string
  channel: NotificationChannel
  enabled: boolean
}
