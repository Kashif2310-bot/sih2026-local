/**
 * Supabase-backed ApplicationStatusStore (Option A).
 *
 * Deliberately a NEW column (public.applications.application_status), not a
 * reuse of the existing applications.status column: that column already
 * holds Adita's raw WorkflowStep/outcome text and is read with that exact
 * meaning by AditaApplicationPersistence.listByStatus() — overwriting it
 * with the 4-value canonical status would silently break that method for
 * any existing caller. See migration
 * 202609170005_canonical_application_status.sql.
 */

import { assertCanonicalApplicationStatus } from '../../../contracts/applicationStatus'
import { toBackendError } from '../../errors'
import { assertApplicationId } from '../optionA/identity'
import type { LokPulseSupabaseClient } from '../../supabase/client'
import type { ApplicationStatusStore } from '../types'

export function createSupabaseApplicationStatusStore(client: LokPulseSupabaseClient): ApplicationStatusStore {
  return {
    async getStatus(applicationId) {
      assertApplicationId(applicationId)
      try {
        const { data, error } = await client
          .from('applications')
          .select('application_status')
          .eq('application_id', applicationId)
          .maybeSingle()
        if (error) throw toBackendError(error)
        const value = (data as { application_status?: string } | null)?.application_status
        return value ? assertCanonicalApplicationStatus(value) : null
      } catch (err) {
        throw toBackendError(err)
      }
    },

    async setStatus(applicationId, status) {
      assertApplicationId(applicationId)
      assertCanonicalApplicationStatus(status)
      try {
        const { error } = await client
          .from('applications')
          .update({ application_status: status })
          .eq('application_id', applicationId)
        if (error) throw toBackendError(error)
      } catch (err) {
        throw toBackendError(err)
      }
    },
  }
}
