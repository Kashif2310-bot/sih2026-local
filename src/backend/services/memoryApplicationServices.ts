/**
 * In-memory application persistence + status — Phase 1 local/dev.
 * Adita / Prerna can code against ApplicationPersistenceService /
 * ApplicationStatusService now; Supabase swap later.
 */

import type { Uuid } from '../../contracts/common'
import type {
  ApplicationEvent,
  ApplicationRecord,
  ApplicationStatus,
  ApplicationStatusView,
  ApplicationVersionRecord,
  CreateApplicationInput,
  SubmitApplicationInput,
  UpdateApplicationFieldsInput,
} from '../../contracts/application'
import type { ApplicationPersistenceService, ApplicationStatusService } from './types'
import { BackendError } from '../errors'
import {
  assertApplicationStatus,
  assertUuid,
  validateCreateApplicationInput,
  validateSubmitApplicationInput,
  validateUpdateFieldsInput,
} from '../validation'

function newId(): Uuid {
  return crypto.randomUUID() as Uuid
}

function nowIso(): string {
  return new Date().toISOString()
}

async function sha256Hex(payload: string): Promise<string> {
  const data = new TextEncoder().encode(payload)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export interface MemoryApplicationStore {
  persistence: ApplicationPersistenceService
  status: ApplicationStatusService
  /** Test helper */
  _reset: () => void
}

export function createMemoryApplicationServices(): MemoryApplicationStore {
  const applications = new Map<Uuid, ApplicationRecord>()
  const versions = new Map<Uuid, ApplicationVersionRecord[]>()
  const events = new Map<Uuid, ApplicationEvent[]>()
  const fieldBags = new Map<Uuid, Record<string, unknown>>()
  const submissionKeys = new Map<Uuid, string>()

  function pushEvent(
    applicationId: Uuid,
    type: ApplicationEvent['type'],
    actorId: Uuid | null,
    payload: Record<string, unknown>,
  ): ApplicationEvent {
    const ev: ApplicationEvent = {
      id: newId(),
      applicationId,
      type,
      actorId,
      payload,
      createdAt: nowIso(),
    }
    const list = events.get(applicationId) ?? []
    list.push(ev)
    events.set(applicationId, list)
    return ev
  }

  const persistence: ApplicationPersistenceService = {
    async create(input: CreateApplicationInput) {
      validateCreateApplicationInput(input)
      const id = newId()
      const ts = nowIso()
      const record: ApplicationRecord = {
        id,
        userId: input.userId,
        applicantProfileId: input.applicantProfileId ?? null,
        schemeId: input.schemeId ?? null,
        schemeVersionId: input.schemeVersionId ?? null,
        status: 'draft',
        submissionMode: 'none',
        submissionLabelEn: null,
        submissionLabelKn: null,
        consentAt: null,
        governmentReferenceId: null,
        createdAt: ts,
        updatedAt: ts,
      }
      applications.set(id, record)
      fieldBags.set(id, {})
      versions.set(id, [])
      events.set(id, [])
      pushEvent(id, 'created', input.userId, {})

      if (input.initialFields?.length) {
        await persistence.updateFields({
          applicationId: id,
          actorId: input.userId,
          fields: input.initialFields,
        })
      }
      return applications.get(id)!
    },

    async get(applicationId) {
      assertUuid(applicationId, 'applicationId')
      return applications.get(applicationId) ?? null
    },

    async updateFields(input: UpdateApplicationFieldsInput) {
      validateUpdateFieldsInput(input)
      const app = applications.get(input.applicationId)
      if (!app) throw new BackendError('NOT_FOUND', `Application not found: ${input.applicationId}`)

      const bag = fieldBags.get(input.applicationId) ?? {}
      for (const f of input.fields) {
        bag[f.key] = f.value
        pushEvent(input.applicationId, 'field_updated', input.actorId, {
          key: f.key,
          source: f.source,
        })
      }
      fieldBags.set(input.applicationId, bag)

      const payload = { ...bag }
      const payloadHash = await sha256Hex(JSON.stringify(payload))
      const list = versions.get(input.applicationId) ?? []
      const version: ApplicationVersionRecord = {
        id: newId(),
        applicationId: input.applicationId,
        versionNumber: list.length + 1,
        payloadHash,
        payload,
        createdBy: input.actorId,
        createdAt: nowIso(),
      }
      list.push(version)
      versions.set(input.applicationId, list)

      const updated: ApplicationRecord = {
        ...app,
        status: app.status === 'draft' ? 'fields_pending' : app.status,
        updatedAt: nowIso(),
      }
      applications.set(input.applicationId, updated)
      return updated
    },

    async setStatus(applicationId, status: ApplicationStatus, actorId) {
      assertUuid(applicationId, 'applicationId')
      const st = assertApplicationStatus(status)
      if (actorId) assertUuid(actorId, 'actorId')
      const app = applications.get(applicationId)
      if (!app) throw new BackendError('NOT_FOUND', `Application not found: ${applicationId}`)
      const updated: ApplicationRecord = {
        ...app,
        status: st,
        updatedAt: nowIso(),
      }
      applications.set(applicationId, updated)
      pushEvent(applicationId, 'status_changed', actorId, { status: st })
      return updated
    },

    async recordConsent(applicationId, actorId, at) {
      assertUuid(applicationId, 'applicationId')
      assertUuid(actorId, 'actorId')
      const app = applications.get(applicationId)
      if (!app) throw new BackendError('NOT_FOUND', `Application not found: ${applicationId}`)
      const consentAt = at ?? nowIso()
      const updated: ApplicationRecord = {
        ...app,
        consentAt,
        status: 'ready_to_submit',
        updatedAt: nowIso(),
      }
      applications.set(applicationId, updated)
      pushEvent(applicationId, 'consent_recorded', actorId, { consentAt })
      return updated
    },

    async attachScheme(applicationId, schemeId, schemeVersionId, actorId) {
      assertUuid(applicationId, 'applicationId')
      assertUuid(schemeId, 'schemeId')
      assertUuid(schemeVersionId, 'schemeVersionId')
      if (actorId) assertUuid(actorId, 'actorId')
      const app = applications.get(applicationId)
      if (!app) throw new BackendError('NOT_FOUND', `Application not found: ${applicationId}`)
      const updated: ApplicationRecord = {
        ...app,
        schemeId,
        schemeVersionId,
        status: app.status === 'draft' ? 'recommended' : app.status,
        updatedAt: nowIso(),
      }
      applications.set(applicationId, updated)
      pushEvent(applicationId, 'recommendation_attached', actorId, {
        schemeId,
        schemeVersionId,
      })
      return updated
    },

    async submit(input: SubmitApplicationInput) {
      validateSubmitApplicationInput(input)
      const app = applications.get(input.applicationId)
      if (!app) throw new BackendError('NOT_FOUND', `Application not found: ${input.applicationId}`)

      const priorKey = submissionKeys.get(input.applicationId)
      if (priorKey) {
        if (priorKey === input.idempotencyKey) return app
        throw new BackendError('CONFLICT', 'Application already submitted')
      }
      if (!app.consentAt) {
        throw new BackendError('VALIDATION', 'Cannot submit before consent is recorded')
      }

      submissionKeys.set(input.applicationId, input.idempotencyKey)
      const updated: ApplicationRecord = {
        ...app,
        status: 'submitted',
        submissionMode: input.mode,
        submissionLabelEn: input.submissionLabelEn ?? app.submissionLabelEn,
        submissionLabelKn: input.submissionLabelKn ?? app.submissionLabelKn,
        governmentReferenceId: input.governmentReferenceId ?? app.governmentReferenceId,
        updatedAt: nowIso(),
      }
      applications.set(input.applicationId, updated)
      pushEvent(input.applicationId, 'submitted', input.actorId, { mode: input.mode })
      return updated
    },
  }

  const status: ApplicationStatusService = {
    async getStatusView(applicationId): Promise<ApplicationStatusView | null> {
      assertUuid(applicationId, 'applicationId')
      const application = applications.get(applicationId)
      if (!application) return null
      const vers = versions.get(applicationId) ?? []
      const evs = events.get(applicationId) ?? []
      return {
        application,
        latestVersion: vers.length ? vers[vers.length - 1]! : null,
        documents: [],
        recentEvents: evs.slice(-20),
      }
    },

    async listEvents(applicationId, limit = 50) {
      assertUuid(applicationId, 'applicationId')
      const evs = events.get(applicationId) ?? []
      return evs.slice(-limit)
    },
  }

  return {
    persistence,
    status,
    _reset() {
      applications.clear()
      versions.clear()
      events.clear()
      fieldBags.clear()
      submissionKeys.clear()
    },
  }
}
