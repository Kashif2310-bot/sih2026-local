/**
 * Pluggable delivery provider per channel — an email/SMS/WhatsApp vendor
 * integration implements this and gets registered with a NotificationService
 * constructor. No vendor is imported or hardcoded in this codebase; an
 * unregistered channel just leaves notifications at 'queued'.
 */

import type { NotificationChannel } from '../../../contracts/notification'

export interface NotificationProviderSendInput {
  applicationId: string
  recipient?: string | null
  templateCode: string
  data?: Record<string, unknown>
}

export interface NotificationProviderSendResult {
  ok: boolean
  providerRef?: string
  errorMessage?: string
}

export interface NotificationProvider {
  channel: NotificationChannel
  send(input: NotificationProviderSendInput): Promise<NotificationProviderSendResult>
}

export type NotificationProviderMap = Partial<Record<NotificationChannel, NotificationProvider>>
