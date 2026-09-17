/**
 * Retrieval orchestrator: runs a query against every adapter whose
 * jurisdiction matches, normalizes + dedups the results, and layers in the
 * cache so a transient source outage degrades to "served from cache" or an
 * honest "unavailable" — never a false "no scheme exists".
 */

import { RetrievalCache, SourceHealthTracker, cacheKeyFor } from './cache'
import { dedupCandidates, normalizeRawRecord } from './normalize'
import type {
  DiscoveryResult,
  NormalizedSchemeCandidate,
  OfficialSourceAdapter,
  RetrievalAttemptLogEntry,
  RetrievalQuery,
} from './types'

export interface RetrievalOrchestratorOptions {
  cacheTtlMs?: number
  /** Best-effort sink for every attempt (e.g. persist to scheme_retrievals). Never awaited, never throws the caller. */
  onAttempt?: (entry: RetrievalAttemptLogEntry) => void
}

export interface RetrievalOrchestrator {
  discover(query: RetrievalQuery): Promise<DiscoveryResult>
  getSourceHealth(): ReturnType<SourceHealthTracker['getHealth']>
  getAttemptLog(limit?: number): ReturnType<SourceHealthTracker['getAttemptLog']>
}

function adapterMatchesJurisdiction(adapter: OfficialSourceAdapter, query: RetrievalQuery): boolean {
  if (adapter.jurisdiction === 'mixed') return true
  if (query.pass === 'central') return adapter.jurisdiction === 'central'
  if (query.pass === 'state') return adapter.jurisdiction === 'state'
  return true
}

export function createRetrievalOrchestrator(
  adapters: OfficialSourceAdapter[],
  opts: RetrievalOrchestratorOptions = {},
): RetrievalOrchestrator {
  const cache = new RetrievalCache(opts.cacheTtlMs)
  const health = new SourceHealthTracker()

  function recordAttempt(entry: RetrievalAttemptLogEntry): void {
    health.record(entry)
    try {
      opts.onAttempt?.(entry)
    } catch {
      // Audit sink failures must never break retrieval itself.
    }
  }

  async function discover(query: RetrievalQuery): Promise<DiscoveryResult> {
    const key = cacheKeyFor(query)
    const cached = cache.get(key)
    if (cached?.fresh) {
      return {
        candidates: cached.candidates,
        attempted: [query.pass],
        sourceHealth: health.getHealth(),
        attemptLog: health.getAttemptLog(20),
        allLiveSourcesUnavailable: false,
        cacheState: 'fresh',
        honestyNoteEn: 'Served from cache within freshness window; no live call made for this request.',
      }
    }

    const candidatesFromLive: NormalizedSchemeCandidate[] = []
    const eligible = adapters.filter((a) => adapterMatchesJurisdiction(a, query))
    let anyConfigured = false
    let anySucceeded = false

    for (const adapter of eligible) {
      if (!adapter.isConfigured()) {
        recordAttempt({
          sourceAdapterId: adapter.id,
          pass: query.pass,
          at: new Date().toISOString(),
          ok: false,
          recordCount: 0,
          latencyMs: 0,
          errorMessage: 'NOT_CONFIGURED',
        })
        continue
      }
      anyConfigured = true
      const at = new Date().toISOString()
      try {
        const result = await adapter.fetch(query)
        recordAttempt({
          sourceAdapterId: adapter.id,
          pass: query.pass,
          at,
          ok: result.ok,
          recordCount: result.records.length,
          latencyMs: result.latencyMs,
          errorMessage: result.errorMessage,
        })
        if (result.ok) {
          anySucceeded = true
          for (const raw of result.records) {
            const normalized = normalizeRawRecord(raw)
            if (normalized) candidatesFromLive.push(normalized)
          }
        }
      } catch (err) {
        recordAttempt({
          sourceAdapterId: adapter.id,
          pass: query.pass,
          at,
          ok: false,
          recordCount: 0,
          latencyMs: 0,
          errorMessage: err instanceof Error ? err.message : 'Unknown adapter failure',
        })
      }
    }

    const allLiveSourcesUnavailable = eligible.length > 0 && (!anyConfigured || !anySucceeded)
    const deduped = dedupCandidates(candidatesFromLive)

    if (deduped.length > 0) {
      cache.set(key, deduped)
      return {
        candidates: deduped,
        attempted: [query.pass],
        sourceHealth: health.getHealth(),
        attemptLog: health.getAttemptLog(20),
        allLiveSourcesUnavailable: false,
        cacheState: 'fresh',
        honestyNoteEn: 'Live official retrieval succeeded for this pass.',
      }
    }

    // No fresh live results. Fall back to the last known-good cache entry
    // (even if stale) rather than reporting an empty result as "no schemes".
    if (cached) {
      return {
        candidates: cached.candidates,
        attempted: [query.pass],
        sourceHealth: health.getHealth(),
        attemptLog: health.getAttemptLog(20),
        allLiveSourcesUnavailable,
        cacheState: 'served_from_cache',
        honestyNoteEn: allLiveSourcesUnavailable
          ? 'Live official sources were unavailable for this request; showing last known-good cached results, which may be stale.'
          : 'Live sources returned nothing new; showing last known-good cached results.',
      }
    }

    return {
      candidates: [],
      attempted: [query.pass],
      sourceHealth: health.getHealth(),
      attemptLog: health.getAttemptLog(20),
      allLiveSourcesUnavailable,
      cacheState: 'empty',
      honestyNoteEn: anyConfigured
        ? 'Live official sources returned no matching records for this request. This does not mean no such scheme exists — only that this retrieval pass found none.'
        : 'No official source adapter is configured for this request (missing API key/resource id). This does not mean no such scheme exists — live retrieval was not attempted.',
    }
  }

  return {
    discover,
    getSourceHealth: () => health.getHealth(),
    getAttemptLog: (limit?: number) => health.getAttemptLog(limit),
  }
}
