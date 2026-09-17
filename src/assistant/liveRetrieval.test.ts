import { afterEach, describe, expect, it, vi } from 'vitest'
import { resetSupabaseClientCacheForTests } from './supabase/client'
import {
  LIVE_RETRIEVAL_TIMEOUT_MS,
  SupabaseLiveRetriever,
  validateLiveEvidenceItems,
} from './liveRetrieval'

function validItem(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    schemeId: 'pmegp',
    sourceName: 'data.gov.in (Open Government Data Platform)',
    sourceUrl: 'https://api.data.gov.in/resource/abc123',
    sourceType: 'official_open_data',
    verificationStatus: 'live_official',
    retrievedAt: new Date().toISOString(),
    summary: '1,204 units sanctioned in Karnataka in FY2023-24.',
    ...overrides,
  }
}

describe('validateLiveEvidenceItems — untrusted external content', () => {
  it('accepts a well-formed item', () => {
    const result = validateLiveEvidenceItems({ items: [validItem()] })
    expect(result).toHaveLength(1)
    expect(result[0].schemeId).toBe('pmegp')
  })

  it('rejects an item for a scheme id not in the known local dataset (never attach evidence to a fabricated scheme)', () => {
    const result = validateLiveEvidenceItems({ items: [validItem({ schemeId: 'totally-fake-scheme' })] })
    expect(result).toHaveLength(0)
  })

  it('rejects an item whose source URL is not on the trusted allowlist', () => {
    const result = validateLiveEvidenceItems({ items: [validItem({ sourceUrl: 'https://example.com/fake' })] })
    expect(result).toHaveLength(0)
  })

  it('rejects an item whose source URL is http (not https)', () => {
    const result = validateLiveEvidenceItems({ items: [validItem({ sourceUrl: 'http://api.data.gov.in/resource/abc' })] })
    expect(result).toHaveLength(0)
  })

  it('rejects an item with an invalid sourceType or verificationStatus', () => {
    expect(validateLiveEvidenceItems({ items: [validItem({ sourceType: 'anything_goes' })] })).toHaveLength(0)
    expect(validateLiveEvidenceItems({ items: [validItem({ verificationStatus: 'definitely_approved' })] })).toHaveLength(0)
  })

  it('rejects an item with a missing or unparseable retrievedAt', () => {
    expect(validateLiveEvidenceItems({ items: [validItem({ retrievedAt: 'not-a-date' })] })).toHaveLength(0)
    expect(validateLiveEvidenceItems({ items: [validItem({ retrievedAt: undefined })] })).toHaveLength(0)
  })

  it('truncates an absurdly long summary rather than passing it through unbounded', () => {
    const huge = 'x'.repeat(10_000)
    const result = validateLiveEvidenceItems({ items: [validItem({ summary: huge })] })
    expect(result[0].summary.length).toBeLessThanOrEqual(280)
  })

  it('keeps the good items and drops only the bad ones from a mixed batch', () => {
    const result = validateLiveEvidenceItems({
      items: [validItem(), validItem({ sourceUrl: 'https://evil.example.com' }), validItem({ schemeId: 'pm-mudra-yojana' })],
    })
    expect(result).toHaveLength(2)
  })

  it('handles malformed top-level shapes without throwing', () => {
    expect(() => validateLiveEvidenceItems(null)).not.toThrow()
    expect(() => validateLiveEvidenceItems(undefined)).not.toThrow()
    expect(() => validateLiveEvidenceItems('a string')).not.toThrow()
    expect(() => validateLiveEvidenceItems({})).not.toThrow()
    expect(() => validateLiveEvidenceItems({ items: 'not an array' })).not.toThrow()
    expect(validateLiveEvidenceItems(null)).toEqual([])
  })

  it('handles a single malformed item inside an otherwise-valid array without throwing', () => {
    expect(() => validateLiveEvidenceItems({ items: [null, 42, 'nope', validItem()] })).not.toThrow()
    expect(validateLiveEvidenceItems({ items: [null, 42, 'nope', validItem()] })).toHaveLength(1)
  })
})

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.unstubAllEnvs()
  resetSupabaseClientCacheForTests()
  vi.restoreAllMocks()
})

describe('SupabaseLiveRetriever — configuration and failure handling', () => {
  it('reports unavailable when Supabase is not configured, and never attempts a network call', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '')
    const fetchSpy = vi.fn()
    globalThis.fetch = fetchSpy
    const retriever = new SupabaseLiveRetriever()
    expect(await retriever.isAvailable()).toBe(false)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('is available once configured', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'fake-anon-key')
    const retriever = new SupabaseLiveRetriever()
    expect(await retriever.isAvailable()).toBe(true)
  })

  it('throws (never silently fabricates evidence) when the Edge Function call fails', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'fake-anon-key')
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network down'))
    const retriever = new SupabaseLiveRetriever()
    await expect(retriever.retrieve({ schemeIds: ['pmegp'] })).rejects.toThrow()
  })

  it('returns validated evidence when the Edge Function responds successfully', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'fake-anon-key')
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ items: [validItem()] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const retriever = new SupabaseLiveRetriever()
    const result = await retriever.retrieve({ schemeIds: ['pmegp'] })
    expect(result).toHaveLength(1)
    expect(result[0].sourceUrl).toMatch(/^https:\/\//)
  })

  it('has a bounded timeout so a hung Edge Function never hangs the chat', () => {
    expect(LIVE_RETRIEVAL_TIMEOUT_MS).toBeLessThanOrEqual(10_000)
    expect(LIVE_RETRIEVAL_TIMEOUT_MS).toBeGreaterThan(0)
  })
})
