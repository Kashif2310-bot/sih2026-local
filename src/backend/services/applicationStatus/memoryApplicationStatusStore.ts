/** In-memory ApplicationStatusStore — Option A local/dev implementation. */

import { assertCanonicalApplicationStatus } from '../../../contracts/applicationStatus'
import { assertApplicationId } from '../optionA/identity'
import type { ApplicationStatusStore } from '../types'

export function createMemoryApplicationStatusStore(): ApplicationStatusStore {
  const store = new Map<string, string>()

  return {
    async getStatus(applicationId) {
      assertApplicationId(applicationId)
      const value = store.get(applicationId)
      return value ? assertCanonicalApplicationStatus(value) : null
    },

    async setStatus(applicationId, status) {
      assertApplicationId(applicationId)
      assertCanonicalApplicationStatus(status)
      store.set(applicationId, status)
    },
  }
}
