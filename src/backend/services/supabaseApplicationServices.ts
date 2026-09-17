/**
 * Supabase-backed application persistence + status services.
 */

import type { Uuid } from '../../contracts/common'
import type {
  ApplicationEvent,
  ApplicationStatus,
  ApplicationStatusView,
  CreateApplicationInput,
  SubmitApplicationInput,
  UpdateApplicationFieldsInput,
} from '../../contracts/application'
import type { ApplicationPersistenceService, ApplicationStatusService } from './types'
import { BackendError, toBackendError } from '../errors'
import {
  assertApplicationStatus,
  assertUuid,
  validateCreateApplicationInput,
  validateSubmitApplicationInput,
  validateUpdateFieldsInput,
} from '../validation'
import type { LokPulseSupabaseClient } from '../supabase/client'
import {
  mapApplication,
  mapApplicationEvent,
  mapApplicationVersion,
  type ApplicationEventRow,
  type ApplicationRow,
  type ApplicationVersionRow,
} from '../supabase/mappers'

async function sha256Hex(payload: string): Promise<string> {
  const data = new TextEncoder().encode(payload)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function insertEvent(
  client: LokPulseSupabaseClient,
  applicationId: Uuid,
  type: ApplicationEvent['type'],
  actorId: Uuid | null,
  payload: Record<string, unknown>,
): Promise<void> {
  const { error } = await client.from('application_events').insert({
    application_id: applicationId,
    type,
    actor_id: actorId,
    payload,
  })
  if (error) throw toBackendError(error)
}

export function createSupabaseApplicationPersistenceService(
  client: LokPulseSupabaseClient,
): ApplicationPersistenceService {
  return {
    async create(input: CreateApplicationInput) {
      validateCreateApplicationInput(input)
      try {
        const { data, error } = await client
          .from('applications')
          .insert({
            user_id: input.userId,
            applicant_profile_id: input.applicantProfileId ?? null,
            scheme_id: input.schemeId ?? null,
            scheme_version_id: input.schemeVersionId ?? null,
            status: 'draft',
            submission_mode: 'none',
          })
          .select('*')
          .single()
        if (error) throw toBackendError(error)
        const app = mapApplication(data as ApplicationRow)
        await insertEvent(client, app.id, 'created', input.userId, {})

        if (input.initialFields?.length) {
          return this.updateFields({
            applicationId: app.id,
            actorId: input.userId,
            fields: input.initialFields,
          })
        }
        return app
      } catch (err) {
        throw toBackendError(err)
      }
    },

    async get(applicationId) {
      assertUuid(applicationId, 'applicationId')
      try {
        const { data, error } = await client
          .from('applications')
          .select('*')
          .eq('id', applicationId)
          .is('deleted_at', null)
          .maybeSingle()
        if (error) throw toBackendError(error)
        return data ? mapApplication(data as ApplicationRow) : null
      } catch (err) {
        throw toBackendError(err)
      }
    },

    async updateFields(input: UpdateApplicationFieldsInput) {
      validateUpdateFieldsInput(input)
      try {
        const existing = await this.get(input.applicationId)
        if (!existing) throw new BackendError('NOT_FOUND', `Application not found: ${input.applicationId}`)

        const { data: vers, error: vErr } = await client
          .from('application_versions')
          .select('version_number, payload')
          .eq('application_id', input.applicationId)
          .order('version_number', { ascending: false })
          .limit(1)
        if (vErr) throw toBackendError(vErr)

        const prevPayload =
          (vers?.[0]?.payload as Record<string, unknown> | undefined) ?? {}
        const payload: Record<string, unknown> = { ...prevPayload }
        for (const f of input.fields) {
          payload[f.key] = f.value
          await insertEvent(client, input.applicationId, 'field_updated', input.actorId, {
            key: f.key,
            source: f.source,
          })
        }

        const payloadHash = await sha256Hex(JSON.stringify(payload))
        const nextNum = (vers?.[0]?.version_number ?? 0) + 1
        const { error: insErr } = await client.from('application_versions').insert({
          application_id: input.applicationId,
          version_number: nextNum,
          payload_hash: payloadHash,
          payload,
          created_by: input.actorId,
        })
        if (insErr) throw toBackendError(insErr)

        const nextStatus: ApplicationStatus =
          existing.status === 'draft' ? 'fields_pending' : existing.status
        const { data, error } = await client
          .from('applications')
          .update({ status: nextStatus, updated_at: new Date().toISOString() })
          .eq('id', input.applicationId)
          .select('*')
          .single()
        if (error) throw toBackendError(error)
        return mapApplication(data as ApplicationRow)
      } catch (err) {
        throw toBackendError(err)
      }
    },

    async setStatus(applicationId, status, actorId) {
      assertUuid(applicationId, 'applicationId')
      const st = assertApplicationStatus(status)
      if (actorId) assertUuid(actorId, 'actorId')
      try {
        const { data, error } = await client
          .from('applications')
          .update({ status: st, updated_at: new Date().toISOString() })
          .eq('id', applicationId)
          .select('*')
          .single()
        if (error) throw toBackendError(error)
        await insertEvent(client, applicationId, 'status_changed', actorId, { status: st })
        return mapApplication(data as ApplicationRow)
      } catch (err) {
        throw toBackendError(err)
      }
    },

    async recordConsent(applicationId, actorId, at) {
      assertUuid(applicationId, 'applicationId')
      assertUuid(actorId, 'actorId')
      const consentAt = at ?? new Date().toISOString()
      try {
        const { data, error } = await client
          .from('applications')
          .update({
            consent_at: consentAt,
            status: 'ready_to_submit',
            updated_at: new Date().toISOString(),
          })
          .eq('id', applicationId)
          .select('*')
          .single()
        if (error) throw toBackendError(error)
        await insertEvent(client, applicationId, 'consent_recorded', actorId, { consentAt })
        return mapApplication(data as ApplicationRow)
      } catch (err) {
        throw toBackendError(err)
      }
    },

    async attachScheme(applicationId, schemeId, schemeVersionId, actorId) {
      assertUuid(applicationId, 'applicationId')
      assertUuid(schemeId, 'schemeId')
      assertUuid(schemeVersionId, 'schemeVersionId')
      if (actorId) assertUuid(actorId, 'actorId')
      try {
        const existing = await this.get(applicationId)
        if (!existing) throw new BackendError('NOT_FOUND', `Application not found: ${applicationId}`)
        const nextStatus: ApplicationStatus =
          existing.status === 'draft' ? 'recommended' : existing.status
        const { data, error } = await client
          .from('applications')
          .update({
            scheme_id: schemeId,
            scheme_version_id: schemeVersionId,
            status: nextStatus,
            updated_at: new Date().toISOString(),
          })
          .eq('id', applicationId)
          .select('*')
          .single()
        if (error) throw toBackendError(error)
        await insertEvent(client, applicationId, 'recommendation_attached', actorId, {
          schemeId,
          schemeVersionId,
        })
        return mapApplication(data as ApplicationRow)
      } catch (err) {
        throw toBackendError(err)
      }
    },

    async submit(input: SubmitApplicationInput) {
      validateSubmitApplicationInput(input)
      try {
        const { data: raw, error: getErr } = await client
          .from('applications')
          .select('*')
          .eq('id', input.applicationId)
          .is('deleted_at', null)
          .maybeSingle()
        if (getErr) throw toBackendError(getErr)
        if (!raw) throw new BackendError('NOT_FOUND', `Application not found: ${input.applicationId}`)
        const row = raw as ApplicationRow

        if (row.submission_idempotency_key) {
          if (row.submission_idempotency_key === input.idempotencyKey) return mapApplication(row)
          throw new BackendError('CONFLICT', 'Application already submitted')
        }
        if (!row.consent_at) {
          throw new BackendError('VALIDATION', 'Cannot submit before consent is recorded')
        }

        // `.is('submission_idempotency_key', null)` makes this an atomic
        // guard: a concurrent duplicate submit matches zero rows and fails
        // .single() rather than both requests succeeding.
        const { data, error } = await client
          .from('applications')
          .update({
            status: 'submitted',
            submission_mode: input.mode,
            submission_idempotency_key: input.idempotencyKey,
            government_reference_id: input.governmentReferenceId ?? row.government_reference_id,
            submission_label_en: input.submissionLabelEn ?? row.submission_label_en,
            submission_label_kn: input.submissionLabelKn ?? row.submission_label_kn,
            updated_at: new Date().toISOString(),
          })
          .eq('id', input.applicationId)
          .is('submission_idempotency_key', null)
          .select('*')
          .single()
        if (error) {
          const mapped = toBackendError(error)
          if (mapped.code === 'NOT_FOUND') {
            throw new BackendError('CONFLICT', 'Application already submitted (concurrent submission detected)')
          }
          throw mapped
        }
        await insertEvent(client, input.applicationId, 'submitted', input.actorId, { mode: input.mode })
        return mapApplication(data as ApplicationRow)
      } catch (err) {
        throw toBackendError(err)
      }
    },
  }
}

export function createSupabaseApplicationStatusService(
  client: LokPulseSupabaseClient,
): ApplicationStatusService {
  return {
    async getStatusView(applicationId): Promise<ApplicationStatusView | null> {
      assertUuid(applicationId, 'applicationId')
      try {
        const { data: app, error } = await client
          .from('applications')
          .select('*')
          .eq('id', applicationId)
          .is('deleted_at', null)
          .maybeSingle()
        if (error) throw toBackendError(error)
        if (!app) return null

        const { data: vers, error: vErr } = await client
          .from('application_versions')
          .select('*')
          .eq('application_id', applicationId)
          .order('version_number', { ascending: false })
          .limit(1)
        if (vErr) throw toBackendError(vErr)

        const { data: docs, error: dErr } = await client
          .from('documents')
          .select('id, doc_type, storage_path, content_hash, validation_status, indicative_requirement')
          .eq('application_id', applicationId)
          .is('deleted_at', null)
        if (dErr) throw toBackendError(dErr)

        const { data: events, error: eErr } = await client
          .from('application_events')
          .select('*')
          .eq('application_id', applicationId)
          .order('created_at', { ascending: false })
          .limit(20)
        if (eErr) throw toBackendError(eErr)

        return {
          application: mapApplication(app as ApplicationRow),
          latestVersion: vers?.[0] ? mapApplicationVersion(vers[0] as ApplicationVersionRow) : null,
          documents: (docs ?? []).map((d) => ({
            id: d.id as Uuid,
            docType: d.doc_type as string,
            storagePath: (d.storage_path as string | null) ?? null,
            contentHash: (d.content_hash as string | null) ?? null,
            validationStatus: d.validation_status as
              | 'pending'
              | 'valid'
              | 'invalid'
              | 'not_uploaded',
            indicativeRequirement: Boolean(d.indicative_requirement),
          })),
          recentEvents: ((events ?? []) as ApplicationEventRow[])
            .map(mapApplicationEvent)
            .reverse(),
        }
      } catch (err) {
        throw toBackendError(err)
      }
    },

    async listEvents(applicationId, limit = 50) {
      assertUuid(applicationId, 'applicationId')
      try {
        const { data, error } = await client
          .from('application_events')
          .select('*')
          .eq('application_id', applicationId)
          .order('created_at', { ascending: true })
          .limit(limit)
        if (error) throw toBackendError(error)
        return ((data ?? []) as ApplicationEventRow[]).map(mapApplicationEvent)
      } catch (err) {
        throw toBackendError(err)
      }
    },
  }
}

export function createSupabaseApplicationServices(client: LokPulseSupabaseClient) {
  return {
    persistence: createSupabaseApplicationPersistenceService(client),
    status: createSupabaseApplicationStatusService(client),
  }
}
