/**
 * Gemini Live provider configuration — the security boundary for this
 * provider. Kept separate from src/assistant/aiConfig.ts (the text-path
 * config) on purpose: voice has its own connection lifecycle and its own
 * config surface, even though the underlying safety rule is identical.
 *
 * ============================================================================
 * SECURITY — READ BEFORE CHANGING THIS FILE
 * ============================================================================
 * This file, and nothing built on top of it, may ever hold a long-lived
 * Gemini API key. Not in this file, not in a VITE_-prefixed env var, not in
 * localStorage/sessionStorage, not in a URL parameter — a long-lived key in
 * any browser-reachable location can be extracted by anyone who opens
 * devtools. There are exactly two safe ways for a browser tab to reach
 * Gemini Live, and this codebase implements neither backend piece today —
 * only the client-side seam that will call whichever one gets built:
 *
 *   (a) Relay/proxy — the browser opens a WebSocket to a developer-run
 *       backend, which holds the real API key server-side and relays
 *       frames to/from Google's actual Gemini Live endpoint.
 *       GEMINI_LIVE_PROXY_URL below is this pattern's config slot — an
 *       endpoint URL is not a secret, exactly like VITE_SUPABASE_URL.
 *
 *   (b) Ephemeral token — the browser first calls a trusted backend over
 *       plain HTTPS to mint a short-lived Gemini auth token, then connects
 *       DIRECTLY to Google's own Gemini Live WebSocket endpoint
 *       (GEMINI_LIVE_WEBSOCKET_ENDPOINT in geminiLiveProtocol.ts) using
 *       that token. This is Google's own documented recommendation for
 *       client-side/browser connections. Wiring this up means supplying a
 *       custom GeminiLiveConnectionResolver (see geminiLiveTransport.ts)
 *       that calls that minting endpoint — not something this file can
 *       default to, since it requires a real backend endpoint to call.
 *
 * Which of (a)/(b) LokPulse's backend should actually expose is Vamshi's
 * call, not decided here — see docs/voice-session-architecture.md. This
 * file ships with GEMINI_LIVE_PROXY_URL unset by default, exactly mirroring
 * src/assistant/aiConfig.ts's HOSTED_PROXY_URL: no backend today, so the
 * provider correctly reports itself unsupported (see isGeminiLiveConfigured
 * below) — no crash, no fake "connected" state, no invented reply.
 * ============================================================================
 */

import { GEMINI_LIVE_DEFAULT_MODEL } from './geminiLiveProtocol'
import type { GeminiLiveConnectionResolver } from './geminiLiveTransport'

/** Unset by default — see the SECURITY note above. Set only to a relay/proxy URL you control, never to a URL with a raw API key embedded. */
export const GEMINI_LIVE_PROXY_URL: string | undefined = import.meta.env.VITE_GEMINI_LIVE_PROXY_URL || undefined

export const GEMINI_LIVE_MODEL = GEMINI_LIVE_DEFAULT_MODEL

/** How long connect() waits for the server's setupComplete message before treating the connection attempt as failed. */
export const GEMINI_LIVE_SETUP_TIMEOUT_MS = 8_000

/**
 * Upper bound on how long an interrupted model turn is treated as "still
 * possibly trailing stale output" before this adapter gives up waiting for
 * the server's own turn-boundary confirmation (`interrupted`/`turnComplete`)
 * and resumes normal processing anyway. The Live API reference this was
 * built against documents no explicit client "cancel generation" message,
 * so this bound is a defensive fallback, not a documented protocol
 * guarantee — tune against real observed server behavior once tested live.
 */
export const GEMINI_LIVE_INTERRUPT_SETTLE_TIMEOUT_MS = 1_500

/** Cheap, synchronous, side-effect-free — mirrors AIProvider.isAvailable()'s "must never hang" contract. Used for VoiceSessionFactory.isSupported(). */
export function isGeminiLiveConfigured(): boolean {
  return Boolean(GEMINI_LIVE_PROXY_URL)
}

/**
 * Default connection resolver for pattern (a) above: just the configured
 * static proxy URL. A project wiring up pattern (b) instead supplies its
 * own resolver (an async function that calls a token-minting endpoint) to
 * GeminiLiveVoiceSessionDeps rather than using this one — see
 * geminiLiveVoiceSession.ts.
 */
export const defaultGeminiLiveConnectionResolver: GeminiLiveConnectionResolver = async () => {
  if (!GEMINI_LIVE_PROXY_URL) {
    throw new Error(
      'Gemini Live is not configured — VITE_GEMINI_LIVE_PROXY_URL is unset. See docs/voice-session-architecture.md for the two supported backend patterns.',
    )
  }
  return { url: GEMINI_LIVE_PROXY_URL }
}
