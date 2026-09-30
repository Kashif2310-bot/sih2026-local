import type { AdminStatus, SubmittedApplication } from './submission'

/**
 * Submitted applications, kept in this browser's localStorage — the same
 * store model the main prototype's admin uses. There is no server here, so
 * the admin view shows applications submitted from this browser only.
 */
export const STORE_KEY = 'ishaara.assistant.applications.v1'

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

function parse(raw: string | null): SubmittedApplication[] {
  try {
    const parsed: unknown = JSON.parse(raw ?? '[]')
    return Array.isArray(parsed) ? (parsed as SubmittedApplication[]).filter((app) => app?.version === 1) : []
  } catch {
    return []
  }
}

function browserStorage(): StorageLike | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}

export class ApplicationStore {
  private readonly storage: StorageLike | null
  private readonly listeners = new Set<() => void>()
  private cached: { raw: string | null; list: SubmittedApplication[] } = { raw: null, list: [] }

  constructor(storage: StorageLike | null = browserStorage()) {
    this.storage = storage
  }

  list(): SubmittedApplication[] {
    if (!this.storage) return []
    return parse(this.storage.getItem(STORE_KEY))
  }

  /** The same array until the stored data changes, so React can subscribe to it without re-rendering on every read. */
  snapshot(): SubmittedApplication[] {
    const raw = this.storage?.getItem(STORE_KEY) ?? null
    if (raw !== this.cached.raw) this.cached = { raw, list: parse(raw) }
    return this.cached.list
  }

  get(applicationId: string): SubmittedApplication | undefined {
    return this.list().find((app) => app.applicationId === applicationId)
  }

  save(application: SubmittedApplication) {
    this.write([application, ...this.list().filter((app) => app.applicationId !== application.applicationId)])
  }

  /** Admin decisions change the status and audit trail only; the frozen snapshots are never rewritten. */
  setStatus(applicationId: string, status: AdminStatus, note: string, at = new Date().toISOString()) {
    this.write(
      this.list().map((app) =>
        app.applicationId === applicationId
          ? { ...app, status, auditTrail: [...app.auditTrail, { at, actor: 'admin' as const, action: status, note }] }
          : app,
      ),
    )
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private write(applications: SubmittedApplication[]) {
    if (!this.storage) throw new Error('This browser does not allow saving the application.')
    this.storage.setItem(STORE_KEY, JSON.stringify(applications))
    this.listeners.forEach((listener) => listener())
  }
}

export const applicationStore = new ApplicationStore()
