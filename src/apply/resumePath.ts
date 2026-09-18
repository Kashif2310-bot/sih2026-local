/**
 * Resume the current citizen application from existing Apply/platform stores.
 * Does not mint an id and does not add a second lookup system.
 */
import { getApplication, getLastApplicationId } from '../platform/store'
import { isApplicationId } from './application'
import { getTrackedApplication, loadTrackedApplications } from './store'

export const NEW_APPLY_PATH = '/apply'

function trackPath(trackingId: string): string {
  return `/apply/track/${encodeURIComponent(trackingId)}`
}

function resumableTracked(applicationId: string) {
  const tracked = getTrackedApplication(applicationId)
  if (!tracked) return undefined
  if (!isApplicationId(tracked.applicationId)) return undefined
  return tracked
}

/**
 * Path that resumes the current LP-APP-* packet, or null when the citizen
 * should start a new application through the existing /apply wizard.
 */
export function existingCitizenApplicationResumePath(): string | null {
  const lastId = getLastApplicationId()
  if (lastId && isApplicationId(lastId)) {
    const tracked = resumableTracked(lastId)
    if (tracked) return trackPath(tracked.trackingId)
    const platform = getApplication(lastId)
    if (platform && !platform.isDemoSeed) return '/apply/tracking'
  }

  const latest = loadTrackedApplications().find((app) => isApplicationId(app.applicationId))
  if (latest) return trackPath(latest.trackingId)
  return null
}

export function citizenApplyNavPath(): string {
  return existingCitizenApplicationResumePath() ?? NEW_APPLY_PATH
}
