/**
 * In-memory retrieval cache + source health/attempt tracking for Phase 3.
 * "Prefer cached verified data plus targeted live refresh for speed" —
 * this is that cache. Swappable for a persistent store later without
 * changing the orchestrator's call shape.
 */

import type {
  NormalizedSchemeCandidate,
  RetrievalAttemptLogEntry,
  RetrievalPassType,
  SourceHealth,
} from './types'

interface CacheEntry {
  candidates: NormalizedSchemeCandidate[]
  cachedAt: number
}

const DEFAULT_TTL_MS = 15 * 60_000 // 15 minutes — targeted refresh cadence for a hackathon-scale service
const MAX_ATTEMPT_LOG = 500

export class RetrievalCache {
  private readonly store = new Map<string, CacheEntry>()
  private readonly ttlMs: number

  constructor(ttlMs: number = DEFAULT_TTL_MS) {
    this.ttlMs = ttlMs
  }

  get(key: string): { candidates: NormalizedSchemeCandidate[]; fresh: boolean } | null {
    const entry = this.store.get(key)
    if (!entry) return null
    const fresh = Date.now() - entry.cachedAt < this.ttlMs
    return { candidates: entry.candidates, fresh }
  }

  set(key: string, candidates: NormalizedSchemeCandidate[]): void {
    this.store.set(key, { candidates, cachedAt: Date.now() })
  }
}

export class SourceHealthTracker {
  private readonly health = new Map<string, SourceHealth>()
  private readonly attemptLog: RetrievalAttemptLogEntry[] = []

  private ensure(sourceAdapterId: string): SourceHealth {
    let h = this.health.get(sourceAdapterId)
    if (!h) {
      h = {
        sourceAdapterId,
        attempts: 0,
        successes: 0,
        failures: 0,
        consecutiveFailures: 0,
        lastAttemptAt: null,
        lastSuccessAt: null,
        lastErrorMessage: null,
        lastLatencyMs: null,
      }
      this.health.set(sourceAdapterId, h)
    }
    return h
  }

  record(entry: RetrievalAttemptLogEntry): void {
    const h = this.ensure(entry.sourceAdapterId)
    h.attempts += 1
    h.lastAttemptAt = entry.at
    h.lastLatencyMs = entry.latencyMs
    if (entry.ok) {
      h.successes += 1
      h.consecutiveFailures = 0
      h.lastSuccessAt = entry.at
      h.lastErrorMessage = null
    } else {
      h.failures += 1
      h.consecutiveFailures += 1
      h.lastErrorMessage = entry.errorMessage ?? 'unknown failure'
    }

    this.attemptLog.push(entry)
    if (this.attemptLog.length > MAX_ATTEMPT_LOG) this.attemptLog.shift()
  }

  getHealth(): SourceHealth[] {
    return [...this.health.values()]
  }

  getAttemptLog(limit?: number): RetrievalAttemptLogEntry[] {
    if (!limit) return [...this.attemptLog]
    return this.attemptLog.slice(-limit)
  }
}

export function cacheKeyFor(query: {
  pass: RetrievalPassType
  keywords?: string[]
  stateCode?: string
  businessCategory?: string
  ministryCode?: string
  departmentCode?: string
  financeType?: string
}): string {
  const parts = [
    query.pass,
    query.stateCode ?? '',
    query.businessCategory ?? '',
    query.ministryCode ?? '',
    query.departmentCode ?? '',
    query.financeType ?? '',
    (query.keywords ?? []).slice().sort().join(','),
  ]
  return parts.join('|')
}
