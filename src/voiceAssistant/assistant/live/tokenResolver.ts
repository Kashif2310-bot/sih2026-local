/**
 * Fetches a short-lived Gemini Live token from the existing Supabase Edge
 * Function `gemini-live-token`. The long-lived Gemini key stays in that
 * function's secrets; the browser only ever holds the anon key and the
 * single-use token.
 */

export interface LiveTokenConfig {
  supabaseUrl?: string
  anonKey?: string
}

export interface LiveToken {
  token: string
  expiresAt: string | null
}

export type LiveTokenErrorKind = 'not_configured' | 'service_not_configured' | 'unavailable' | 'network' | 'malformed'

export class LiveTokenError extends Error {
  readonly kind: LiveTokenErrorKind

  constructor(kind: LiveTokenErrorKind, message: string) {
    super(message)
    this.name = 'LiveTokenError'
    this.kind = kind
  }
}

export const TOKEN_FUNCTION_PATH = '/functions/v1/gemini-live-token'

export function readLiveTokenConfig(env: Record<string, unknown> = import.meta.env): LiveTokenConfig {
  const pick = (key: string) => {
    const value = env[key]
    return typeof value === 'string' && value.trim() ? value.trim() : undefined
  }
  return { supabaseUrl: pick('VITE_SUPABASE_URL'), anonKey: pick('VITE_SUPABASE_ANON_KEY') }
}

export function isLiveConfigured(config: LiveTokenConfig): boolean {
  return Boolean(config.supabaseUrl && config.anonKey)
}

export async function resolveLiveToken(
  config: LiveTokenConfig,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<LiveToken> {
  if (!config.supabaseUrl || !config.anonKey) {
    throw new LiveTokenError(
      'not_configured',
      'Voice is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local.',
    )
  }

  let response: Response
  try {
    response = await fetchImpl(`${config.supabaseUrl.replace(/\/+$/, '')}${TOKEN_FUNCTION_PATH}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.anonKey}`,
        apikey: config.anonKey,
        'Content-Type': 'application/json',
      },
      body: '{}',
      signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new LiveTokenError('network', 'Could not reach the voice token service.')
  }

  if (response.status === 503) {
    throw new LiveTokenError('service_not_configured', 'The voice token service has no Gemini key configured.')
  }
  if (!response.ok) {
    throw new LiveTokenError('unavailable', `The voice token service failed (HTTP ${response.status}).`)
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new LiveTokenError('malformed', 'The voice token service returned an unreadable response.')
  }
  const record = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}
  if (typeof record.token !== 'string' || !record.token) {
    throw new LiveTokenError('malformed', 'The voice token service returned no token.')
  }
  return { token: record.token, expiresAt: typeof record.expiresAt === 'string' ? record.expiresAt : null }
}
