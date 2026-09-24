/**
 * The client half of the ephemeral-token flow. The property that matters
 * most here is negative: the long-lived API key must never appear on this
 * side of the boundary, and a failure must produce a clear message rather
 * than a silent non-connection.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { GEMINI_LIVE_WEBSOCKET_ENDPOINT } from './geminiLiveProtocol'
import { buildGeminiLiveTokenUrl, createEphemeralTokenConnectionResolver } from './geminiEphemeralTokenResolver'

const invoke = vi.fn()

vi.mock('../supabase/client', () => ({
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => ({ functions: { invoke } }),
}))

afterEach(() => {
  invoke.mockReset()
})

describe('buildGeminiLiveTokenUrl', () => {
  it('targets Google directly, not our backend — audio must not be relayed', () => {
    expect(buildGeminiLiveTokenUrl('tok')).toContain(GEMINI_LIVE_WEBSOCKET_ENDPOINT)
  })

  it('passes the token in the access_token query parameter', () => {
    // The browser WebSocket API cannot set an Authorization header, so the
    // query-parameter form is the only usable one of Google's two.
    expect(buildGeminiLiveTokenUrl('tok-123')).toContain('access_token=tok-123')
  })

  it('url-encodes a token containing reserved characters', () => {
    expect(buildGeminiLiveTokenUrl('a/b+c=')).toContain('access_token=a%2Fb%2Bc%3D')
  })
})

describe('createEphemeralTokenConnectionResolver', () => {
  it('returns a connection target built from the minted token', async () => {
    invoke.mockResolvedValue({ data: { token: 'ephemeral-abc', model: 'gemini-3.8-live' }, error: null })

    const target = await createEphemeralTokenConnectionResolver()()

    expect(target.url).toContain('access_token=ephemeral-abc')
  })

  it('forwards a language hint so the token constraints match the session', async () => {
    invoke.mockResolvedValue({ data: { token: 't', model: 'm' }, error: null })

    await createEphemeralTokenConnectionResolver({ languageCode: 'kn-IN' })()

    expect(invoke).toHaveBeenCalledWith('gemini-live-token', { body: { languageCode: 'kn-IN' } })
  })

  it('surfaces the backend failure message instead of connecting to nothing', async () => {
    invoke.mockResolvedValue({ data: null, error: { message: 'Function returned a non-2xx status code' } })

    await expect(createEphemeralTokenConnectionResolver()()).rejects.toThrow(/token service is unavailable/i)
  })

  it('rejects a malformed response rather than opening a doomed socket', async () => {
    invoke.mockResolvedValue({ data: { notAToken: true }, error: null })

    await expect(createEphemeralTokenConnectionResolver()()).rejects.toThrow(/unexpected response/i)
  })

  it('rejects an empty token string', async () => {
    invoke.mockResolvedValue({ data: { token: '', model: 'm' }, error: null })

    await expect(createEphemeralTokenConnectionResolver()()).rejects.toThrow(/unexpected response/i)
  })

  it('never sends anything resembling an API key from the browser', async () => {
    invoke.mockResolvedValue({ data: { token: 't', model: 'm' }, error: null })

    await createEphemeralTokenConnectionResolver()()

    const [, options] = invoke.mock.calls[0]
    expect(JSON.stringify(options)).not.toMatch(/apiKey|api_key|AIza/i)
  })
})
