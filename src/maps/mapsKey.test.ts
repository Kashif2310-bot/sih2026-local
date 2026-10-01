import { afterEach, describe, expect, it, vi } from 'vitest'
import { mapsApiKey, mapsKeyConfigured } from './mapsKey'

describe('mapsKeyConfigured', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('treats an unset, empty or blank key as no key, so the keyless paths stay in use', () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', undefined)
    expect(mapsKeyConfigured()).toBe(false)
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', '')
    expect(mapsKeyConfigured()).toBe(false)
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', '   ')
    expect(mapsKeyConfigured()).toBe(false)
    expect(mapsApiKey()).toBe('')
  })

  it('treats any non-blank key as configured, trimmed', () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', '  test-maps-key  ')
    expect(mapsKeyConfigured()).toBe(true)
    expect(mapsApiKey()).toBe('test-maps-key')
  })
})
