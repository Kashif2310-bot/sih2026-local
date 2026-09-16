import { describe, expect, it } from 'vitest'
import { getSupabasePublicConfig } from './config'

describe('supabase public config', () => {
  it('reports unconfigured when Vite env vars are absent', () => {
    const cfg = getSupabasePublicConfig()
    // Fresh clones have no .env — foundation must not require live Supabase.
    expect(cfg.configured).toBe(false)
    expect(cfg.url).toBeNull()
    expect(cfg.anonKey).toBeNull()
  })
})
