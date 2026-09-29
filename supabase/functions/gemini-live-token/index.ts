// Supabase Edge Function: gemini-live-token
//
// The ONLY place a long-lived Gemini API key is ever read. The browser never
// holds it, never sees it, and never receives it — this function exchanges
// it for a SHORT-LIVED ephemeral token that the browser then uses to open a
// Gemini Live WebSocket directly against Google's endpoint.
//
// WHY EPHEMERAL TOKENS AND NOT A RELAY:
//   Google's own Live API documentation recommends ephemeral tokens for
//   client-side applications. It is also the right call for this product:
//   a relay would put our backend in the path of every 16kHz audio frame in
//   both directions, adding a round trip to a latency budget that has to
//   stay conversational. With a token, only this one small HTTPS request
//   touches our infrastructure; the audio goes browser <-> Google directly.
//
// SECURITY PROPERTIES (all load-bearing — read before changing anything):
//   - GEMINI_API_KEY is read from the function's server-side environment and
//     is never returned, never logged, and never echoed in an error body.
//   - The token is single-use for starting a session (uses: 1) and can only
//     OPEN one for ~60s, so the blast radius of interception is one short
//     call. It is deliberately NOT pinned to a model — see the note on
//     `bidiGenerateContentSetup` at the payload below for why pinning would
//     disable this app's tool declarations and system instruction.
//   - The caller must present the project's anon key (enforced by the
//     platform) and a well-formed bearer credential — see requireCaller().
//
// WHAT HAPPENS IF GEMINI_API_KEY ISN'T SET:
//   Returns HTTP 503 with a clear "not configured" body, exactly like
//   live-scheme-retrieval does. The frontend treats that as "voice
//   unavailable" and the text assistant continues to work untouched —
//   never a fake "connected" state.
//
// SETUP:
//   supabase secrets set GEMINI_API_KEY=...
//   supabase functions deploy gemini-live-token

/**
 * Ephemeral tokens are sanctioned on v1alpha — Google's own SDK warns that
 * ephemeral-token support is v1alpha-only, and a token minted on v1beta is
 * rejected by the Live socket as "API key not valid". Overridable per
 * deployment in case that moves.
 */
const GOOGLE_API_VERSION = Deno.env.get('GEMINI_API_VERSION') ?? 'v1alpha'
const GOOGLE_AUTH_TOKENS_ENDPOINT = `https://generativelanguage.googleapis.com/${GOOGLE_API_VERSION}/auth_tokens`
const REQUEST_TIMEOUT_MS = 8_000

/**
 * Must stay in sync with src/assistant/voice/geminiLiveProtocol.ts's
 * GEMINI_LIVE_DEFAULT_MODEL. Overridable per deployment without a code
 * change, because Google's Live model ids move faster than our releases.
 */
const DEFAULT_MODEL = Deno.env.get('GEMINI_LIVE_MODEL') ?? 'gemini-3.1-flash-live-preview'

/** How long the browser has to OPEN the session with this token. Deliberately short. */
const NEW_SESSION_EXPIRE_SECONDS = 60
/** Hard ceiling on the whole live session's lifetime. */
const TOKEN_EXPIRE_SECONDS = 30 * 60

function corsHeaders(): HeadersInit {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Content-Type': 'application/json',
  }
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders() })
}

/**
 * The app's existing auth model: Supabase gates the function on the anon
 * key, and an authenticated session additionally carries a bearer JWT. We
 * require the Authorization header to be present and well-formed, which is
 * what Supabase itself populates for both the anon and signed-in cases.
 * Rejecting every unauthenticated caller outright would break the citizen
 * demo flow, which is deliberately usable without sign-in — so this is an
 * authorization floor, not a user-identity check.
 */
function requireCaller(req: Request): string | null {
  const auth = req.headers.get('authorization') ?? ''
  if (!auth.toLowerCase().startsWith('bearer ') || auth.length < 20) {
    return 'A valid Authorization bearer credential is required.'
  }
  return null
}

interface TokenRequestBody {
  /** Optional per-session language hint, forwarded into the constrained config. */
  languageCode?: string
}

function parseBody(raw: unknown): TokenRequestBody {
  if (typeof raw !== 'object' || raw === null) return {}
  const body = raw as Record<string, unknown>
  const languageCode = typeof body.languageCode === 'string' ? body.languageCode : undefined
  // Reject anything that isn't a plausible BCP-47 tag rather than forwarding
  // caller-controlled text into the upstream request.
  if (languageCode && !/^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/.test(languageCode)) return {}
  return { languageCode }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405)

  const authError = requireCaller(req)
  if (authError) return jsonResponse({ error: 'unauthorized', message: authError }, 401)

  const apiKey = Deno.env.get('GEMINI_API_KEY')
  if (!apiKey) {
    // Never hint at the value; just report the configuration state.
    return jsonResponse(
      {
        error: 'not_configured',
        message: 'Gemini Live is not configured for this deployment (GEMINI_API_KEY is unset).',
      },
      503,
    )
  }

  let body: TokenRequestBody = {}
  try {
    body = parseBody(await req.json())
  } catch {
    body = {} // an absent/malformed body is fine — every field is optional
  }

  const now = Date.now()
  // NOTE ON SCOPE — read before adding `bidiGenerateContentSetup` here.
  //
  // The REST resource does have a field that pins a token to a specific
  // setup: `bidiGenerateContentSetup` (the `liveConnectConstraints` name in
  // Google's SDK examples does NOT exist over REST and is rejected with
  // HTTP 400). It is deliberately NOT sent, because supplying it makes the
  // token's stored setup the effective one and the browser's own setup
  // message stops taking effect — which would silently drop this app's
  // systemInstruction AND its tool declarations. Those tools are the entire
  // safety boundary for native-audio voice: without them the model has no
  // way to look up a scheme and would be free to answer from memory. A
  // narrower token is not worth a model that can invent government facts.
  //
  // What still bounds a leaked token: it is single-use for starting a
  // session (`uses: 1`) and only valid to OPEN one for
  // NEW_SESSION_EXPIRE_SECONDS.
  const payload = {
    uses: 1,
    expireTime: new Date(now + TOKEN_EXPIRE_SECONDS * 1000).toISOString(),
    newSessionExpireTime: new Date(now + NEW_SESSION_EXPIRE_SECONDS * 1000).toISOString(),
  }

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS)
  let upstream: Response
  try {
    upstream = await fetch(GOOGLE_AUTH_TOKENS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    })
  } catch {
    return jsonResponse({ error: 'upstream_unreachable', message: 'Could not reach the Gemini token service.' }, 502)
  } finally {
    clearTimeout(timer)
  }

  if (!upstream.ok) {
    // Server-side only. Google's 4xx body explains WHY a mint was rejected
    // (bad model name, malformed constraints), and without it this failure
    // is undiagnosable from the outside. It goes to the function's own logs,
    // which only project owners can read — never to the client, and it
    // cannot contain the API key, which is sent as a header.
    let detail = ''
    try {
      detail = (await upstream.text()).slice(0, 500)
    } catch {
      detail = '<unreadable body>'
    }
    console.error(`auth_tokens mint failed: HTTP ${upstream.status} ${detail}`)

    // Opt-in diagnostics, OFF unless GEMINI_TOKEN_DEBUG=1 is set as a
    // project secret. Off by default because the upstream body echoes the
    // request; it never contains the API key (that travels as a header),
    // but it is still not something an anonymous caller should see. Turn on
    // only while debugging a mint failure, then unset the secret.
    if (Deno.env.get('GEMINI_TOKEN_DEBUG') === '1') {
      return jsonResponse(
        { error: 'token_mint_failed', message: `Gemini token service responded ${upstream.status}.`, upstream: detail },
        502,
      )
    }

    // The client normally learns only the status — it has no safe use for
    // Google's request echo.
    return jsonResponse(
      { error: 'token_mint_failed', message: `Gemini token service responded ${upstream.status}.` },
      502,
    )
  }

  let minted: unknown
  try {
    minted = await upstream.json()
  } catch {
    return jsonResponse({ error: 'token_mint_failed', message: 'Gemini token service returned a malformed response.' }, 502)
  }

  const name = typeof minted === 'object' && minted !== null ? (minted as Record<string, unknown>).name : undefined
  if (typeof name !== 'string' || name.length === 0) {
    return jsonResponse({ error: 'token_mint_failed', message: 'Gemini token service returned no token.' }, 502)
  }

  // Only the short-lived token and the model it is bound to. Never the API
  // key, never the upstream payload.
  return jsonResponse({ token: name, model: DEFAULT_MODEL, expiresAt: payload.expireTime }, 200)
})
