/**
 * Supabase-backed ProfileService.
 * Requires a real profiles row (auth user). Use service-role client in tests/Edge,
 * or an authenticated anon client in the browser once auth exists.
 */

import type { Uuid } from '../../contracts/common'
import type { AppLocale } from '../../contracts/domain'
import type { ApplicantProfilePatch } from '../../contracts/profile'
import type { ProfileCreateOptions, ProfileService } from './types'
import { BackendError, toBackendError } from '../errors'
import { assertLocale, assertUuid } from '../validation'
import {
  applyProfilePatch,
  createEmptyApplicantProfileV2,
  getMissingFields,
} from '../adapters/profileHelpers'
import type { LokPulseSupabaseClient } from '../supabase/client'
import { hydrateApplicantProfile, type ApplicantProfileRow } from '../supabase/mappers'

export function createSupabaseProfileService(client: LokPulseSupabaseClient): ProfileService {
  async function ensureCitizenProfile(userId: Uuid): Promise<void> {
    const { error } = await client.from('profiles').upsert(
      {
        id: userId,
        role: 'citizen',
        locale: 'en',
      },
      { onConflict: 'id' },
    )
    if (error) throw toBackendError(error)
  }

  async function fetchRow(id: Uuid): Promise<ApplicantProfileRow | null> {
    const { data, error } = await client
      .from('applicant_profiles')
      .select('*')
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle()
    if (error) throw toBackendError(error)
    return (data as ApplicantProfileRow | null) ?? null
  }

  return {
    async create(locale?: AppLocale, opts?: ProfileCreateOptions) {
      const loc = assertLocale(locale)
      if (!opts?.userId) {
        throw new BackendError(
          'VALIDATION',
          'Supabase ProfileService.create requires opts.userId (auth user id).',
        )
      }
      assertUuid(opts.userId, 'userId')
      if (opts.conversationId) assertUuid(opts.conversationId, 'conversationId')

      try {
        await ensureCitizenProfile(opts.userId)
        const empty = createEmptyApplicantProfileV2(loc)
        if (opts.conversationId) empty.conversationId = opts.conversationId
        empty.userId = opts.userId

        const { data, error } = await client
          .from('applicant_profiles')
          .insert({
            user_id: opts.userId,
            conversation_id: opts.conversationId ?? null,
            locale: loc,
            profile: empty,
          })
          .select('*')
          .single()
        if (error) throw toBackendError(error)
        return hydrateApplicantProfile(data as ApplicantProfileRow)
      } catch (err) {
        throw toBackendError(err)
      }
    },

    async get(id) {
      assertUuid(id, 'id')
      try {
        const row = await fetchRow(id)
        return row ? hydrateApplicantProfile(row) : null
      } catch (err) {
        throw toBackendError(err)
      }
    },

    async applyPatch(id, patch: ApplicantProfilePatch) {
      assertUuid(id, 'id')
      try {
        const row = await fetchRow(id)
        if (!row) throw new BackendError('NOT_FOUND', `Profile not found: ${id}`)
        const current = hydrateApplicantProfile(row)
        const next = applyProfilePatch(current, patch)
        next.id = id
        next.userId = row.user_id as Uuid

        const { data, error } = await client
          .from('applicant_profiles')
          .update({
            profile: next,
            locale: next.locale,
            conversation_id: next.conversationId ?? row.conversation_id,
            updated_at: new Date().toISOString(),
          })
          .eq('id', id)
          .select('*')
          .single()
        if (error) throw toBackendError(error)
        return hydrateApplicantProfile(data as ApplicantProfileRow)
      } catch (err) {
        throw toBackendError(err)
      }
    },

    async getMissingFields(id) {
      assertUuid(id, 'id')
      const profile = await this.get(id)
      if (!profile) throw new BackendError('NOT_FOUND', `Profile not found: ${id}`)
      return getMissingFields(profile)
    },
  }
}
