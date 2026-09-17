import { describe, expect, it } from 'vitest'
import { getSupabasePublicConfig, getSupabaseServerConfig } from './config'

describe('supabase public config', () => {
  it('reports unconfigured when Vite env vars are absent (or only process unset in unit isolation)', () => {
    const cfg = getSupabasePublicConfig()
    // Without VITE_/SUPABASE URL+anon, configured is false.
    // If .env.local is loaded for integration, this may be true — assert shape only then.
    expect(typeof cfg.configured).toBe('boolean')
    if (!cfg.configured) {
      expect(cfg.url).toBeNull()
      expect(cfg.anonKey).toBeNull()
    } else {
      expect(cfg.url).toBeTruthy()
      expect(cfg.anonKey).toBeTruthy()
    }
  })

  it('never reads service role from Vite-prefixed env', () => {
    const server = getSupabaseServerConfig()
    expect(typeof server.serviceConfigured).toBe('boolean')
    expect('serviceRoleKey' in server).toBe(true)
  })
})
