import { describe, expect, it } from 'vitest'
import { BackendError } from '../errors'
import { assertUuid, assertLocale, validateCreateApplicationInput } from '../validation'
import { createBackendServices } from '../services/createBackendServices'
import { createFixtureSchemeRegistry } from '../registry/fixtureSchemeRegistry'
import { createResilientSchemeRetrievalService } from '../services/supabaseSchemeRetrievalService'
import { FIXTURE_IDS } from '../registry/fixtureSchemeRegistry'
import type { SchemeRetrievalService } from '../services/types'
import type { Uuid } from '../../contracts/common'

describe('backend validation', () => {
  it('accepts valid UUIDs and rejects garbage', () => {
    expect(() => assertUuid(FIXTURE_IDS.schemeMicro, 'schemeId')).not.toThrow()
    expect(() => assertUuid('not-a-uuid', 'schemeId')).toThrow(BackendError)
  })

  it('validates locales and create-application input', () => {
    expect(assertLocale('kn')).toBe('kn')
    expect(() => assertLocale('fr')).toThrow(BackendError)
    expect(() =>
      validateCreateApplicationInput({
        userId: 'bad' as Uuid,
      }),
    ).toThrow(BackendError)
  })
})

describe('createBackendServices fallback', () => {
  it('defaults to memory when Supabase is not configured', () => {
    const prevUrl = process.env.SUPABASE_URL
    const prevAnon = process.env.SUPABASE_ANON_KEY
    const prevService = process.env.SUPABASE_SERVICE_ROLE_KEY
    const prevViteUrl = process.env.VITE_SUPABASE_URL
    const prevViteAnon = process.env.VITE_SUPABASE_ANON_KEY
    delete process.env.SUPABASE_URL
    delete process.env.SUPABASE_ANON_KEY
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    delete process.env.VITE_SUPABASE_URL
    delete process.env.VITE_SUPABASE_ANON_KEY

    const backend = createBackendServices({ mode: 'auto' })
    expect(backend.mode).toBe('memory')
    expect(backend.supabaseConfigured).toBe(false)

    if (prevUrl !== undefined) process.env.SUPABASE_URL = prevUrl
    else delete process.env.SUPABASE_URL
    if (prevAnon !== undefined) process.env.SUPABASE_ANON_KEY = prevAnon
    else delete process.env.SUPABASE_ANON_KEY
    if (prevService !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = prevService
    else delete process.env.SUPABASE_SERVICE_ROLE_KEY
    if (prevViteUrl !== undefined) process.env.VITE_SUPABASE_URL = prevViteUrl
    else delete process.env.VITE_SUPABASE_URL
    if (prevViteAnon !== undefined) process.env.VITE_SUPABASE_ANON_KEY = prevViteAnon
    else delete process.env.VITE_SUPABASE_ANON_KEY
  })

  it('force memory mode even if env looks configured', () => {
    const backend = createBackendServices({ mode: 'memory' })
    expect(backend.mode).toBe('memory')
  })

  it('uses supabase mode when an injected client is provided', () => {
    const fakeClient = { from: () => ({ select: () => ({ eq: () => ({}) }) }) } as never
    const backend = createBackendServices({ mode: 'supabase', client: fakeClient })
    expect(backend.mode).toBe('supabase')
    expect(backend.supabaseConfigured).toBe(true)
  })
})

describe('resilient scheme registry', () => {
  it('falls back to fixture when primary fails', async () => {
    const failing: SchemeRetrievalService = {
      async listSchemes() {
        throw new BackendError('UPSTREAM', 'simulated outage')
      },
      async getScheme() {
        throw new BackendError('UPSTREAM', 'simulated outage')
      },
      async getSchemeVersion() {
        throw new BackendError('UPSTREAM', 'simulated outage')
      },
      async getLatestVerifiedVersion() {
        throw new BackendError('UPSTREAM', 'simulated outage')
      },
      async listMinistries() {
        throw new BackendError('UPSTREAM', 'simulated outage')
      },
      async listDepartments() {
        throw new BackendError('UPSTREAM', 'simulated outage')
      },
    }
    const resilient = createResilientSchemeRetrievalService(failing, createFixtureSchemeRegistry())
    const list = await resilient.listSchemes()
    expect(list.data).toHaveLength(2)
    const ministries = await resilient.listMinistries()
    expect(ministries[0]?.code).toBe('MOSJE')
  })
})
