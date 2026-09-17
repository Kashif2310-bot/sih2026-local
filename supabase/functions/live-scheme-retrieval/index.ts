// Supabase Edge Function: live-scheme-retrieval
//
// The ONLY place this app ever calls an external government API from — the
// browser never does, and never holds the API key this needs. Called by
// src/assistant/liveRetrieval.ts via `supabase.functions.invoke(...)`.
//
// WHAT THIS ACTUALLY DOES TODAY:
//   Calls the Open Government Data (OGD) Platform India REST API
//   (https://api.data.gov.in) for one specific dataset resource, which the
//   team configures (DATA_GOV_IN_RESOURCE_ID). Registration for a free API
//   key is self-service at https://data.gov.in/user/register — there is no
//   partner-approval process, unlike myScheme (see README "Live retrieval"
//   section for why myScheme is not integrated: its Terms of Use prohibit
//   automated access, and its only sanctioned integration path — API Setu —
//   is a formal partner-approval process this project does not have).
//
//   The datasets we could actually confirm under PMEGP/MSME keywords on
//   data.gov.in are STATISTICAL/PERFORMANCE data (e.g. units sanctioned,
//   margin-money subsidy disbursed, by state and year) — not structured
//   eligibility rules, loan-amount tables, or application procedures. So
//   this function only ever produces supplementary, clearly-labelled
//   "live official data" facts attached to an existing local scheme
//   (src/assistant/data/schemes.ts) — it can never replace or override
//   that scheme's eligibility criteria, loan info, or documents.
//
// WHAT HAPPENS IF DATA_GOV_IN_API_KEY / DATA_GOV_IN_RESOURCE_ID AREN'T SET:
//   Returns HTTP 503 with a clear "not configured" body. The frontend
//   treats that exactly like a failure (never like "checked, found
//   nothing") — see attemptLiveRetrieval() in src/assistant/orchestrator.ts.
//   This is the expected default state until a team member registers their
//   own key and sets it as a Supabase secret; see README.
//
// FIELD MAPPING CAVEAT (read before relying on this in a demo):
//   data.gov.in resources have per-dataset column names. The mapping below
//   uses defensive, best-guess common field names (state/state_ut,
//   units/units_sanctioned, year/financial_year) and falls back to a
//   generic summary if a record doesn't match — it has NOT been verified
//   against a live key/resource because none was available while writing
//   this. Whoever configures a real resource ID should sanity-check the
//   summaries this produces against that resource's actual columns.
//
// SCHEME-BINDING TRUST BOUNDARY (Prompt 8 — read before adding a new field
// here that a caller might treat as "proof" of a scheme tie):
//   This function stamps `schemeId` onto every item purely from `body.
//   schemeIds` (the caller's REQUEST) — it is NOT evidence that the
//   underlying data.gov.in record itself is about that scheme. The
//   frontend (src/assistant/evidence/schemeBinding.ts, via
//   dataGovInConnector.ts) treats this `schemeId` field as untrusted for
//   binding purposes and will NEVER attach evidence to a scheme's
//   liveEvidence on the strength of it alone — only an `explicitSchemeId`
//   or `officialApplicationUrl` this function does not currently emit
//   (because the underlying OGD datasets don't carry either) would qualify.
//   Every item this function returns today is therefore correctly
//   reclassified client-side as `live_contextual`, not `live_official`. If
//   a future resource/dataset genuinely identifies a scheme (e.g. a
//   `scheme_id` or canonical application-URL column), add `explicitSchemeId`
//   / `officialApplicationUrl` to the emitted item from THAT column — never
//   from `schemeIds` in the request.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { isTrustedGovUrl } from '../_shared/trustedDomains.ts'

const DATA_GOV_IN_BASE_URL = 'https://api.data.gov.in'
const REQUEST_TIMEOUT_MS = 6_000
const MAX_RECORDS = 5

interface LiveRetrievalRequest {
  schemeIds: string[]
  state?: string
}

interface LiveEvidenceItem {
  schemeId: string
  sourceName: string
  sourceUrl: string
  sourceType: 'official_open_data'
  verificationStatus: 'live_official'
  retrievedAt: string
  summary: string
}

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

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  try {
    return await fetch(url, { signal: ctrl.signal })
  } finally {
    clearTimeout(t)
  }
}

function firstDefined(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = record[k]
    if (typeof v === 'string' && v.trim().length > 0) return v.trim()
    if (typeof v === 'number') return String(v)
  }
  return undefined
}

/**
 * Turns one raw data.gov.in record into a human-readable summary. Uses
 * common field-name guesses and degrades to a generic (but still
 * source-labelled) summary rather than fabricating specifics it can't find
 * — see the field-mapping caveat above.
 */
function summarizeRecord(record: Record<string, unknown>, requestedState: string | undefined): string | null {
  const state = firstDefined(record, ['state', 'state_ut', 'state_name', 'stateut'])
  const units = firstDefined(record, ['units_sanctioned', 'units', 'no_of_units', 'number_of_units'])
  const subsidy = firstDefined(record, ['margin_money_subsidy', 'subsidy_disbursed', 'mm_subsidy'])
  const year = firstDefined(record, ['financial_year', 'year', 'fy'])

  if (units && state) {
    return `${units} units sanctioned${year ? ` in ${year}` : ''} in ${state}${
      subsidy ? ` (₹${subsidy} margin money subsidy disbursed)` : ''
    }.`
  }
  if (subsidy && state) {
    return `₹${subsidy} margin money subsidy disbursed${year ? ` in ${year}` : ''} in ${state}.`
  }
  // Fallback: don't invent numbers we can't identify — just say a record
  // was found, still clearly sourced, rather than guessing field meanings.
  if (state || requestedState) {
    return `A published record was found for ${state ?? requestedState}${year ? ` (${year})` : ''} — see the source link for details.`
  }
  return null
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const supabase = supabaseUrl && serviceRoleKey ? createClient(supabaseUrl, serviceRoleKey) : null

  let body: LiveRetrievalRequest
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'invalid_request', message: 'Expected a JSON body with schemeIds.' }, 400)
  }
  const schemeIds = Array.isArray(body.schemeIds) ? body.schemeIds.filter((s) => typeof s === 'string') : []
  const state = typeof body.state === 'string' ? body.state : undefined
  const queryDescription = `schemeIds=${schemeIds.join(',')} state=${state ?? '(none)'}`

  const apiKey = Deno.env.get('DATA_GOV_IN_API_KEY')
  const resourceId = Deno.env.get('DATA_GOV_IN_RESOURCE_ID')

  async function logRetrieval(status: 'success' | 'failure' | 'not_configured', resultCount: number, error?: string) {
    if (!supabase) return // Logging is best-effort — never block the actual response on it.
    try {
      await supabase.from('scheme_retrievals').insert({
        source: 'data.gov.in',
        query: queryDescription,
        status,
        result_count: resultCount,
        error: error ?? null,
      })
    } catch {
      // Audit logging must never take down live retrieval itself.
    }
  }

  if (!apiKey || !resourceId) {
    await logRetrieval('not_configured', 0)
    return jsonResponse(
      {
        error: 'not_configured',
        message:
          'DATA_GOV_IN_API_KEY and/or DATA_GOV_IN_RESOURCE_ID are not set as Supabase secrets. See README.md for setup — this is the expected default until a team member registers a free data.gov.in API key.',
      },
      503,
    )
  }

  const url =
    `${DATA_GOV_IN_BASE_URL}/resource/${encodeURIComponent(resourceId)}` +
    `?api-key=${encodeURIComponent(apiKey)}&format=json&limit=${MAX_RECORDS}` +
    (state ? `&filters[state]=${encodeURIComponent(state)}` : '')

  try {
    const res = await fetchWithTimeout(url, REQUEST_TIMEOUT_MS)
    if (!res.ok) {
      await logRetrieval('failure', 0, `data.gov.in responded with HTTP ${res.status}`)
      return jsonResponse({ error: 'upstream_error', message: `data.gov.in responded with HTTP ${res.status}` }, 502)
    }

    const data = await res.json()
    const records: unknown[] = Array.isArray(data?.records) ? data.records : []
    const retrievedAt = new Date().toISOString()
    const sourceUrl = `${DATA_GOV_IN_BASE_URL}/resource/${encodeURIComponent(resourceId)}`

    if (!isTrustedGovUrl(sourceUrl)) {
      // Structurally impossible today (the base URL is a constant on the
      // allowlist), but checked anyway — evidence never leaves this
      // function without passing the same trust check the frontend applies.
      await logRetrieval('failure', 0, 'source URL failed trusted-domain check')
      return jsonResponse({ error: 'untrusted_source' }, 502)
    }

    const items: LiveEvidenceItem[] = []
    for (const raw of records) {
      if (!raw || typeof raw !== 'object') continue
      const summary = summarizeRecord(raw as Record<string, unknown>, state)
      if (!summary) continue
      for (const schemeId of schemeIds) {
        items.push({
          schemeId,
          sourceName: 'data.gov.in (Open Government Data Platform)',
          sourceUrl,
          sourceType: 'official_open_data',
          verificationStatus: 'live_official',
          retrievedAt,
          summary,
        })
      }
    }

    await logRetrieval('success', items.length)
    return jsonResponse({ items }, 200)
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error calling data.gov.in'
    await logRetrieval('failure', 0, message)
    return jsonResponse({ error: 'retrieval_failed', message }, 502)
  }
})
