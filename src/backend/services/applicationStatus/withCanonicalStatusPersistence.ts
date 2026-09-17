/**
 * Decorates AditaApplicationPersistence to persist the canonical
 * ApplicationStatus on every save() — the one write-time hook available
 * without modifying aditaApplicationPersistence.ts or TrackedApplication
 * (Adita's contracts, left untouched). Every other method passes through
 * unchanged.
 *
 * canonicalStatusForWorkflowStep() is applied exactly once here, at write
 * time, from the just-saved app's own statusHistory. It is never applied
 * again at read time — ApplicationStatusStore.getStatus() only returns what
 * was persisted here.
 */

import { canonicalStatusForWorkflowStep } from '../../../contracts/applicationStatus'
import type { TrackedApplication } from '../../../apply/types'
import type { AditaApplicationPersistence } from '../aditaApplicationPersistence'
import type { ApplicationStatusStore } from '../types'

function canonicalStatusForSave(app: TrackedApplication) {
  const lastStep = app.statusHistory.at(-1)?.step
  return lastStep ? canonicalStatusForWorkflowStep(lastStep) : 'draft'
}

export function withCanonicalStatusPersistence(
  inner: AditaApplicationPersistence,
  store: ApplicationStatusStore,
): AditaApplicationPersistence {
  return {
    ...inner,
    async save(app) {
      const saved = await inner.save(app)
      await store.setStatus(saved.applicationId, canonicalStatusForSave(saved))
      return saved
    },
  }
}
