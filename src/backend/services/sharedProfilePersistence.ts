/**
 * Persistence for Kashif shared ApplicantProfile.
 */

import type { ApplicantProfile } from '../../shared/applicantProfile'
import { createEmptyApplicantProfile } from '../../shared/applicantProfile'
import type { LokPulseSupabaseClient } from '../supabase/client'
import { BackendError, toBackendError } from '../errors'
import { assertUuid } from '../validation'
import type { Uuid } from '../../contracts/common'

export interface SharedProfilePersistence {
  create(profile?: ApplicantProfile): Promise<ApplicantProfile>
  get(id: Uuid): Promise<ApplicantProfile | null>
  upsert(id: Uuid, profile: ApplicantProfile): Promise<ApplicantProfile>
}

export function createMemorySharedProfilePersistence(): SharedProfilePersistence {
  const store = new Map<string, ApplicantProfile>()
  return {
    async create(profile) {
      const id = crypto.randomUUID()
      const next = profile
        ? { ...profile, applicantId: profile.applicantId ?? id }
        : createEmptyApplicantProfile(id)
      store.set(id, next)
      return { ...next, applicantId: next.applicantId ?? id }
    },
    async get(id) {
      return store.get(id) ?? null
    },
    async upsert(id, profile) {
      const next = { ...profile, applicantId: profile.applicantId ?? id }
      store.set(id, next)
      return next
    },
  }
}

export function createSupabaseSharedProfilePersistence(
  client: LokPulseSupabaseClient,
): SharedProfilePersistence {
  return {
    async create(profile) {
      const empty = profile ?? createEmptyApplicantProfile()
      try {
        const { data, error } = await client
          .from('applicant_profiles')
          .insert({
            applicant_id: empty.applicantId ?? null,
            profile: empty,
          })
          .select('id, profile')
          .single()
        if (error) throw toBackendError(error)
        const id = data.id as string
        const stored = data.profile as ApplicantProfile
        return { ...stored, applicantId: stored.applicantId ?? id }
      } catch (err) {
        throw toBackendError(err)
      }
    },

    async get(id) {
      assertUuid(id, 'id')
      try {
        const { data, error } = await client
          .from('applicant_profiles')
          .select('id, profile')
          .eq('id', id)
          .is('deleted_at', null)
          .maybeSingle()
        if (error) throw toBackendError(error)
        if (!data) return null
        const stored = data.profile as ApplicantProfile
        return { ...stored, applicantId: stored.applicantId ?? (data.id as string) }
      } catch (err) {
        throw toBackendError(err)
      }
    },

    async upsert(id, profile) {
      assertUuid(id, 'id')
      const next = { ...profile, applicantId: profile.applicantId ?? id }
      try {
        const { data, error } = await client
          .from('applicant_profiles')
          .upsert(
            {
              id,
              applicant_id: next.applicantId ?? null,
              profile: next,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'id' },
          )
          .select('id, profile')
          .single()
        if (error) throw toBackendError(error)
        if (!data) throw new BackendError('UPSTREAM', 'Profile upsert returned no row')
        return data.profile as ApplicantProfile
      } catch (err) {
        throw toBackendError(err)
      }
    },
  }
}
