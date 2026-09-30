import { describe, expect, it, vi } from 'vitest'
import { buildLiveUrl, GEMINI_LIVE_ENDPOINT } from './geminiProtocol'
import { isLiveConfigured, LiveTokenError, readLiveTokenConfig, resolveLiveToken } from './tokenResolver'

const CONFIG = { supabaseUrl: 'https://example.supabase.co/', anonKey: 'anon-key' }

const jsonResponse = (status: number, body: unknown) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })

async function expectKind(promise: Promise<unknown>, kind: LiveTokenError['kind']) {
  await expect(promise).rejects.toBeInstanceOf(LiveTokenError)
  await promise.catch((error: LiveTokenError) => expect(error.kind).toBe(kind))
}

describe('readLiveTokenConfig', () => {
  it('reads only the browser-safe Supabase values', () => {
    const config = readLiveTokenConfig({ VITE_SUPABASE_URL: ' https://x.supabase.co ', VITE_SUPABASE_ANON_KEY: 'k' })
    expect(config).toEqual({ supabaseUrl: 'https://x.supabase.co', anonKey: 'k' })
    expect(isLiveConfigured(config)).toBe(true)
    expect(isLiveConfigured(readLiveTokenConfig({}))).toBe(false)
  })
})

describe('resolveLiveToken', () => {
  it('POSTs to the gemini-live-token function with the anon key', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { token: 'auth_tokens/abc', model: 'ignored', expiresAt: 'soon' }))
    const token = await resolveLiveToken(CONFIG, fetchImpl as unknown as typeof fetch)

    expect(token).toEqual({ token: 'auth_tokens/abc', expiresAt: 'soon' })
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://example.supabase.co/functions/v1/gemini-live-token')
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({ Authorization: 'Bearer anon-key', apikey: 'anon-key' })
  })

  it('refuses to call anything when not configured', async () => {
    const fetchImpl = vi.fn()
    await expectKind(resolveLiveToken({}, fetchImpl as unknown as typeof fetch), 'not_configured')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('maps service failures to typed errors', async () => {
    const respond = (status: number, body: unknown) => (async () => jsonResponse(status, body)) as unknown as typeof fetch
    await expectKind(resolveLiveToken(CONFIG, respond(503, { error: 'x' })), 'service_not_configured')
    await expectKind(resolveLiveToken(CONFIG, respond(502, { error: 'x' })), 'unavailable')
    await expectKind(resolveLiveToken(CONFIG, respond(200, 'not json')), 'malformed')
    await expectKind(resolveLiveToken(CONFIG, respond(200, { model: 'm' })), 'malformed')
  })

  it('reports network failures', async () => {
    const fetchImpl = (async () => {
      throw new TypeError('Failed to fetch')
    }) as unknown as typeof fetch
    await expectKind(resolveLiveToken(CONFIG, fetchImpl), 'network')
  })
})

describe('buildLiveUrl', () => {
  it('targets the Constrained endpoint with the encoded token', () => {
    expect(GEMINI_LIVE_ENDPOINT).toContain('BidiGenerateContentConstrained')
    expect(buildLiveUrl('auth_tokens/a b')).toBe(`${GEMINI_LIVE_ENDPOINT}?access_token=auth_tokens%2Fa%20b`)
  })
})
