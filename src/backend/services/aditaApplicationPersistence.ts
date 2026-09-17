/**
 * Adita TrackedApplication persistence — Option A application identity (LP-APP-…).
 */

import type { TrackedApplication } from '../../apply/types'
import { isApplicationId } from '../../apply/application'
import type { LokPulseSupabaseClient } from '../supabase/client'
import { BackendError, toBackendError } from '../errors'

export interface AditaApplicationPersistence {
  save(app: TrackedApplication): Promise<TrackedApplication>
  get(applicationId: string): Promise<TrackedApplication | null>
  list(limit?: number): Promise<TrackedApplication[]>
  listByStatus(status: string, limit?: number): Promise<TrackedApplication[]>
  appendEvent(
    applicationId: string,
    eventType: string,
    payload?: Record<string, unknown>,
    actorRef?: string,
  ): Promise<void>
}

function rowToTracked(row: Record<string, unknown>): TrackedApplication {
  return {
    applicationId: row.application_id as string,
    trackingId: (row.tracking_id as string) ?? '',
    schemeId: row.scheme_id as string,
    schemeName: (row.scheme_name as string) ?? '',
    channel: row.channel as TrackedApplication['channel'],
    outcome: row.outcome as TrackedApplication['outcome'],
    filedWithGovernment: Boolean(row.filed_with_government),
    simulation: Boolean(row.simulation),
    governmentApplicationId: (row.government_application_id as string | undefined) ?? undefined,
    officialPortalUrl: (row.official_portal_url as string | undefined) ?? undefined,
    honestLabel: (row.honest_label as string) ?? '',
    detail: (row.detail as string) ?? '',
    nextSteps: Array.isArray(row.next_steps) ? (row.next_steps as string[]) : [],
    packet: row.packet as TrackedApplication['packet'],
    consent: row.consent as TrackedApplication['consent'],
    conversation: (row.conversation as TrackedApplication['conversation']) ?? undefined,
    snapshot: (row.snapshot as TrackedApplication['snapshot']) ?? undefined,
    package: (row.submission_package as TrackedApplication['package']) ?? undefined,
    statusHistory: (row.status_history as TrackedApplication['statusHistory']) ?? [],
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }
}

function trackedToRow(app: TrackedApplication) {
  return {
    application_id: app.applicationId,
    scheme_id: app.schemeId,
    scheme_name: app.schemeName,
    status: app.statusHistory.at(-1)?.step ?? app.outcome,
    channel: app.channel,
    outcome: app.outcome,
    filed_with_government: app.filedWithGovernment,
    simulation: app.simulation,
    tracking_id: app.trackingId,
    government_application_id: app.governmentApplicationId ?? null,
    official_portal_url: app.officialPortalUrl ?? null,
    honest_label: app.honestLabel,
    detail: app.detail,
    next_steps: app.nextSteps ?? [],
    packet: app.packet,
    consent: app.consent,
    conversation: app.conversation ?? null,
    snapshot: app.snapshot ?? null,
    submission_package: app.package ?? null,
    status_history: app.statusHistory,
    updated_at: app.updatedAt,
    created_at: app.createdAt,
  }
}

export function createMemoryAditaApplicationPersistence(): AditaApplicationPersistence {
  const store = new Map<string, TrackedApplication>()
  const events: Array<{ applicationId: string; eventType: string; payload: Record<string, unknown> }> = []
  return {
    async save(app) {
      if (!isApplicationId(app.applicationId)) {
        throw new BackendError('VALIDATION', `Invalid Adita applicationId: ${app.applicationId}`)
      }
      store.set(app.applicationId, app)
      return app
    },
    async get(applicationId) {
      return store.get(applicationId) ?? null
    },
    async list(limit = 50) {
      return [...store.values()]
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, limit)
    },
    async listByStatus(status, limit = 50) {
      return (await this.list(200))
        .filter((a) => a.outcome === status || a.statusHistory.at(-1)?.step === status)
        .slice(0, limit)
    },
    async appendEvent(applicationId, eventType, payload = {}) {
      events.push({ applicationId, eventType, payload })
    },
  }
}

export function createSupabaseAditaApplicationPersistence(
  client: LokPulseSupabaseClient,
): AditaApplicationPersistence {
  return {
    async save(app) {
      if (!isApplicationId(app.applicationId)) {
        throw new BackendError('VALIDATION', `Invalid Adita applicationId: ${app.applicationId}`)
      }
      try {
        const { error } = await client.from('applications').upsert(trackedToRow(app), {
          onConflict: 'application_id',
        })
        if (error) throw toBackendError(error)
        await this.appendEvent(app.applicationId, 'application_saved', { outcome: app.outcome })
        return app
      } catch (err) {
        throw toBackendError(err)
      }
    },

    async get(applicationId) {
      try {
        const { data, error } = await client
          .from('applications')
          .select('*')
          .eq('application_id', applicationId)
          .maybeSingle()
        if (error) throw toBackendError(error)
        return data ? rowToTracked(data as Record<string, unknown>) : null
      } catch (err) {
        throw toBackendError(err)
      }
    },

    async list(limit = 50) {
      try {
        const { data, error } = await client
          .from('applications')
          .select('*')
          .order('updated_at', { ascending: false })
          .limit(limit)
        if (error) throw toBackendError(error)
        return ((data ?? []) as Record<string, unknown>[]).map(rowToTracked)
      } catch (err) {
        throw toBackendError(err)
      }
    },

    async listByStatus(status, limit = 50) {
      try {
        const { data, error } = await client
          .from('applications')
          .select('*')
          .eq('status', status)
          .order('updated_at', { ascending: false })
          .limit(limit)
        if (error) throw toBackendError(error)
        return ((data ?? []) as Record<string, unknown>[]).map(rowToTracked)
      } catch (err) {
        throw toBackendError(err)
      }
    },

    async appendEvent(applicationId, eventType, payload = {}, actorRef) {
      try {
        const { error } = await client.from('application_events').insert({
          application_id: applicationId,
          event_type: eventType,
          actor_ref: actorRef ?? null,
          payload,
        })
        if (error) throw toBackendError(error)
      } catch (err) {
        throw toBackendError(err)
      }
    },
  }
}
