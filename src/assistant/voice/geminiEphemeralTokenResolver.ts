/**
 * Client half of the ephemeral-token authentication pattern — Google's own
 * documented recommendation for browser Live API clients.
 *
 *   browser -> supabase.functions.invoke('gemini-live-token')   [HTTPS, anon key]
 *           <- { token, model, expiresAt }                      [short-lived]
 *           -> wss://generativelanguage.googleapis.com/...?access_token=<token>
 *
 * The long-lived GEMINI_API_KEY lives only in the Edge Function's server-side
 * environment (supabase/functions/gemini-live-token/index.ts) and never
 * reaches this file, the bundle, or any browser storage. The token this
 * returns is single-use for session start and expires in minutes, and is
 * held only in the local variable that builds the WebSocket URL — it is
 * never persisted to localStorage/sessionStorage/IndexedDB and never logged.
 */

import { getSupabaseClient, isSupabaseConfigured } from '../supabase/client'
import { GEMINI_LIVE_WEBSOCKET_ENDPOINT } from './geminiLiveProtocol'
import type { GeminiLiveConnectionResolver, GeminiLiveConnectionTarget } from './geminiLiveTransport'

/** The deployed Edge Function's name — see supabase/functions/gemini-live-token/. */
export const GEMINI_LIVE_TOKEN_FUNCTION = 'gemini-live-token'

/**
 * Cheap and synchronous, per VoiceSessionFactory.isSupported()'s contract:
 * it only checks that a Supabase project is configured at all. Whether the
 * function is actually deployed and GEMINI_API_KEY is actually set can only
 * be discovered by calling it, which happens lazily at connect() time.
 */
export function isEphemeralTokenBackendConfigured(): boolean {
  return isSupabaseConfigured()
}

export interface GeminiEphemeralToken {
  token: string
  model: string
  expiresAt?: string
}

function parseTokenResponse(raw: unknown): GeminiEphemeralToken | null {
  if (typeof raw !== 'object' || raw === null) return null
  const body = raw as Record<string, unknown>
  if (typeof body.token !== 'string' || body.token.length === 0) return null
  if (typeof body.model !== 'string' || body.model.length === 0) return null
  return {
    token: body.token,
    model: body.model,
    expiresAt: typeof body.expiresAt === 'string' ? body.expiresAt : undefined,
  }
}

export interface EphemeralTokenResolverOptions {
  /** BCP-47 hint forwarded to the minting function so the token's bound config matches the session. Omitted for 'auto'. */
  languageCode?: string
}

/**
 * Builds the connection target. The token is placed in the `access_token`
 * query parameter, which is one of the two forms Google documents for
 * ephemeral tokens (the other being an `Authorization: Token ...` header —
 * unusable here, because the browser WebSocket API cannot set custom
 * headers).
 */
export function buildGeminiLiveTokenUrl(token: string): string {
  return `${GEMINI_LIVE_WEBSOCKET_ENDPOINT}?access_token=${encodeURIComponent(token)}`
}

export function createEphemeralTokenConnectionResolver(
  options: EphemeralTokenResolverOptions = {},
): GeminiLiveConnectionResolver {
  return async (): Promise<GeminiLiveConnectionTarget> => {
    const supabase = getSupabaseClient()
    if (!supabase) {
      throw new Error(
        'Gemini Live is not configured — no Supabase project is set up to mint an ephemeral token. See docs/voice-session-architecture.md.',
      )
    }

    const { data, error } = await supabase.functions.invoke(GEMINI_LIVE_TOKEN_FUNCTION, {
      body: options.languageCode ? { languageCode: options.languageCode } : {},
    })

    if (error) {
      // The function's own 503 "not configured" body arrives here too. The
      // message is deliberately the function's, not the raw transport
      // error, so a deployer sees the actionable cause.
      throw new Error(`Could not start voice — the Gemini token service is unavailable (${error.message}).`)
    }

    const parsed = parseTokenResponse(data)
    if (!parsed) {
      throw new Error('Could not start voice — the Gemini token service returned an unexpected response.')
    }

    return { url: buildGeminiLiveTokenUrl(parsed.token) }
  }
}
