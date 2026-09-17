import { describe, expect, it, vi } from 'vitest'
import { createRetrievalOrchestrator } from './orchestrator'
import type { AdapterFetchResult, OfficialSourceAdapter, RetrievalQuery } from './types'

function makeAdapter(opts: {
  id: string
  configured?: boolean
  jurisdiction?: OfficialSourceAdapter['jurisdiction']
  fetchImpl: (query: RetrievalQuery) => Promise<AdapterFetchResult>
}): OfficialSourceAdapter {
  return {
    id: opts.id,
    sourceType: 'official_api',
    jurisdiction: opts.jurisdiction ?? 'mixed',
    isConfigured: () => opts.configured ?? true,
    fetch: opts.fetchImpl,
  }
}

const baseQuery: RetrievalQuery = { pass: 'broad_discovery' }

describe('createRetrievalOrchestrator', () => {
  it('is honest about unconfigured adapters — never claims schemes do not exist', async () => {
    const adapter = makeAdapter({
      id: 'unconfigured',
      configured: false,
      fetchImpl: async () => ({ records: [], ok: false, latencyMs: 0 }),
    })
    const orchestrator = createRetrievalOrchestrator([adapter])
    const result = await orchestrator.discover(baseQuery)
    expect(result.candidates).toHaveLength(0)
    expect(result.cacheState).toBe('empty')
    expect(result.allLiveSourcesUnavailable).toBe(true)
    expect(result.honestyNoteEn).toMatch(/does not mean no such scheme exists/i)
  })

  it('normalizes and returns records from a healthy adapter', async () => {
    const adapter = makeAdapter({
      id: 'healthy',
      fetchImpl: async () => ({
        records: [
          {
            sourceAdapterId: 'healthy',
            sourceType: 'official_api',
            raw: { scheme_name: 'Test Scheme', ministry: 'Test Ministry' },
            fetchedAt: new Date().toISOString(),
          },
        ],
        ok: true,
        latencyMs: 10,
      }),
    })
    const orchestrator = createRetrievalOrchestrator([adapter])
    const result = await orchestrator.discover(baseQuery)
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]?.nameEn).toBe('Test Scheme')
    expect(result.cacheState).toBe('fresh')
    expect(result.allLiveSourcesUnavailable).toBe(false)
  })

  it('falls back to last known-good cache when a live source later fails', async () => {
    let call = 0
    const adapter = makeAdapter({
      id: 'flaky',
      fetchImpl: async () => {
        call += 1
        if (call === 1) {
          return {
            records: [
              {
                sourceAdapterId: 'flaky',
                sourceType: 'official_api',
                raw: { scheme_name: 'Cached Scheme' },
                fetchedAt: new Date().toISOString(),
              },
            ],
            ok: true,
            latencyMs: 5,
          }
        }
        return { records: [], ok: false, errorMessage: 'simulated outage', latencyMs: 5 }
      },
    })
    // Zero TTL so the second call skips the fresh-cache short-circuit and re-queries live.
    const orchestrator = createRetrievalOrchestrator([adapter], { cacheTtlMs: 0 })
    const first = await orchestrator.discover(baseQuery)
    expect(first.cacheState).toBe('fresh')

    const second = await orchestrator.discover(baseQuery)
    expect(second.cacheState).toBe('served_from_cache')
    expect(second.candidates).toHaveLength(1)
    expect(second.candidates[0]?.nameEn).toBe('Cached Scheme')
    expect(second.allLiveSourcesUnavailable).toBe(true)
  })

  it('tracks source health across attempts', async () => {
    const fetchImpl = vi
      .fn<(query: RetrievalQuery) => Promise<AdapterFetchResult>>()
      .mockResolvedValueOnce({ records: [], ok: true, latencyMs: 1 })
      .mockResolvedValueOnce({ records: [], ok: false, errorMessage: 'boom', latencyMs: 2 })
    const adapter = makeAdapter({ id: 'tracked', fetchImpl })
    const orchestrator = createRetrievalOrchestrator([adapter], { cacheTtlMs: 0 })

    await orchestrator.discover(baseQuery)
    await orchestrator.discover(baseQuery)

    const health = orchestrator.getSourceHealth().find((h) => h.sourceAdapterId === 'tracked')
    expect(health?.attempts).toBe(2)
    expect(health?.successes).toBe(1)
    expect(health?.failures).toBe(1)
    expect(health?.lastErrorMessage).toBe('boom')

    const log = orchestrator.getAttemptLog()
    expect(log.length).toBeGreaterThanOrEqual(2)
  })

  it('does not call state-only adapters on a central pass', async () => {
    const fetchImpl = vi.fn<(query: RetrievalQuery) => Promise<AdapterFetchResult>>().mockResolvedValue({
      records: [],
      ok: true,
      latencyMs: 1,
    })
    const stateAdapter = makeAdapter({ id: 'state_only', jurisdiction: 'state', fetchImpl })
    const orchestrator = createRetrievalOrchestrator([stateAdapter])
    await orchestrator.discover({ pass: 'central' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
