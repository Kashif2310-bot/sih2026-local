/**
 * In-memory ProfileService — Phase 1 local/dev implementation.
 * Swap for Supabase-backed service without changing Kashif callers.
 */

import type { Uuid } from '../../contracts/common'
import type { ApplicantProfilePatch, ApplicantProfileV2 } from '../../contracts/profile'
import type { ProfileService } from './types'
import {
  applyProfilePatch,
  createEmptyApplicantProfileV2,
  getMissingFields,
} from '../adapters/profileHelpers'
import { BackendError } from '../errors'
import { assertLocale, assertUuid } from '../validation'

function newId(): Uuid {
  return crypto.randomUUID() as Uuid
}

export function createMemoryProfileService(): ProfileService {
  const store = new Map<Uuid, ApplicantProfileV2>()

  return {
    async create(locale, opts) {
      const loc = assertLocale(locale)
      if (opts?.userId) assertUuid(opts.userId, 'userId')
      if (opts?.conversationId) assertUuid(opts.conversationId, 'conversationId')
      const profile = createEmptyApplicantProfileV2(loc)
      profile.id = newId()
      if (opts?.userId) profile.userId = opts.userId
      if (opts?.conversationId) profile.conversationId = opts.conversationId
      store.set(profile.id, profile)
      return profile
    },

    async get(id) {
      assertUuid(id, 'id')
      return store.get(id) ?? null
    },

    async applyPatch(id, patch: ApplicantProfilePatch) {
      assertUuid(id, 'id')
      const current = store.get(id)
      if (!current) {
        throw new BackendError('NOT_FOUND', `Profile not found: ${id}`)
      }
      const next = applyProfilePatch(current, patch)
      next.id = id
      store.set(id, next)
      return next
    },

    async getMissingFields(id) {
      assertUuid(id, 'id')
      const current = store.get(id)
      if (!current) {
        throw new BackendError('NOT_FOUND', `Profile not found: ${id}`)
      }
      return getMissingFields(current)
    },
  }
}
