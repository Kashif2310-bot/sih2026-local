import type { UserProfile } from '../assistant/types'
import type { ConversationPayload } from './application'
import { publishTrackedApplicationToPlatform } from './projectToPlatform'
import type { TrackedApplication } from './types'

const APPS_KEY = 'lokpulse.applications'
const HANDOFF_KEY = 'lokpulse.apply.handoff'

export interface ApplyHandoff {
  schemeId: string
  profile: UserProfile
  conversation?: ConversationPayload
}

export function loadTrackedApplications(): TrackedApplication[] {
  try {
    const raw = localStorage.getItem(APPS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as TrackedApplication[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveTrackedApplication(app: TrackedApplication): void {
  const existing = loadTrackedApplications().filter((a) => a.trackingId !== app.trackingId)
  const next = [app, ...existing].slice(0, 50)
  try {
    localStorage.setItem(APPS_KEY, JSON.stringify(next))
  } catch {
    // Private browsing — caller still holds the in-memory result.
  }
  publishTrackedApplicationToPlatform(app)
}

export function getTrackedApplication(trackingId: string): TrackedApplication | undefined {
  return loadTrackedApplications().find(
    (a) => a.trackingId === trackingId || a.applicationId === trackingId,
  )
}

export function saveHandoff(handoff: ApplyHandoff): void {
  try {
    sessionStorage.setItem(HANDOFF_KEY, JSON.stringify(handoff))
  } catch {
    // ignore
  }
}

export function loadHandoff(): ApplyHandoff | null {
  try {
    const raw = sessionStorage.getItem(HANDOFF_KEY)
    if (!raw) return null
    return JSON.parse(raw) as ApplyHandoff
  } catch {
    return null
  }
}

export function clearHandoff(): void {
  try {
    sessionStorage.removeItem(HANDOFF_KEY)
  } catch {
    // ignore
  }
}
