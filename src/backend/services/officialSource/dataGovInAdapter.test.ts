import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDataGovInAdapter } from './dataGovInAdapter'

const ENV_KEYS = ['DATA_GOV_IN_API_KEY', 'DATA_GOV_IN_SCHEME_RESOURCE_ID', 'DATA_GOV_IN_BASE_URL']

function clearEnv() {
  for (const k of ENV_KEYS) delete process.env[k]
}

afterEach(() => {
  clearEnv()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('createDataGovInAdapter', () => {
  it('is not configured without an api key + resource id', async () => {
    clearEnv()
    const adapter = createDataGovInAdapter()
    expect(adapter.isConfigured()).toBe(false)
    const result = await adapter.fetch({ pass: 'broad_discovery' })
    expect(result.ok).toBe(false)
    expect(result.records).toHaveLength(0)
    expect(result.errorMessage).toMatch(/NOT_CONFIGURED/)
  })

  it('never reads VITE_-prefixed env for its key', () => {
    process.env.VITE_DATA_GOV_IN_API_KEY = 'leaked'
    const adapter = createDataGovInAdapter()
    expect(adapter.isConfigured()).toBe(false)
    delete process.env.VITE_DATA_GOV_IN_API_KEY
  })

  it('builds a request and normalizes rows when configured', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ records: [{ scheme_name: 'Live Scheme', ministry: 'Live Ministry' }] }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const adapter = createDataGovInAdapter({ apiKey: 'k', resourceId: 'r', baseUrl: 'https://api.data.gov.in/resource' })
    expect(adapter.isConfigured()).toBe(true)
    const result = await adapter.fetch({ pass: 'sector', businessCategory: 'dairy', stateCode: 'KA' })
    expect(result.ok).toBe(true)
    expect(result.records).toHaveLength(1)
    expect(result.records[0]?.raw.scheme_name).toBe('Live Scheme')

    const calledUrl = fetchMock.mock.calls[0]?.[0] as string
    expect(calledUrl).toContain('api-key=k')
    expect(calledUrl).toContain('filters%5Bstate%5D=KA')
    expect(calledUrl).toContain('filters%5Bsector%5D=dairy')
  })

  it('reports failure without throwing when the upstream call errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('network down')),
    )
    const adapter = createDataGovInAdapter({ apiKey: 'k', resourceId: 'r' })
    const result = await adapter.fetch({ pass: 'broad_discovery' })
    expect(result.ok).toBe(false)
    expect(result.errorMessage).toMatch(/network down/)
  })
})
