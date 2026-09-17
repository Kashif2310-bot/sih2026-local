import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getSupabaseClient, isSupabaseConfigured, resetSupabaseClientCacheForTests } from './client'

beforeEach(() => {
  resetSupabaseClientCacheForTests()
})

afterEach(() => {
  vi.unstubAllEnvs()
  resetSupabaseClientCacheForTests()
})

describe('Supabase client — configuration is optional and never exposes secrets', () => {
  it('is not configured and returns null when no env vars are set (the default, out-of-the-box state)', () => {
    vi.stubEnv('VITE_SUPABASE_URL', '')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '')
    expect(isSupabaseConfigured()).toBe(false)
    expect(getSupabaseClient()).toBeNull()
  })

  it('is not configured when only the URL is set', () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '')
    expect(isSupabaseConfigured()).toBe(false)
    expect(getSupabaseClient()).toBeNull()
  })

  it('is not configured when only the anon key is set', () => {
    vi.stubEnv('VITE_SUPABASE_URL', '')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'fake-anon-key')
    expect(isSupabaseConfigured()).toBe(false)
    expect(getSupabaseClient()).toBeNull()
  })

  it('constructs a real client when both are set', () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'fake-anon-key')
    expect(isSupabaseConfigured()).toBe(true)
    const client = getSupabaseClient()
    expect(client).not.toBeNull()
  })

  it('caches the client instance across calls', () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'fake-anon-key')
    expect(getSupabaseClient()).toBe(getSupabaseClient())
  })

  it('reflects a cache reset by reconstructing a fresh client', () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'fake-anon-key')
    const first = getSupabaseClient()
    resetSupabaseClientCacheForTests()
    const second = getSupabaseClient()
    expect(first).not.toBeNull()
    expect(second).not.toBeNull()
    expect(first).not.toBe(second)
  })
})
