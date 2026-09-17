// Supabase Edge Function: apply-application-package
//
// GET /api/apply/applications/{application_id}/package
//
// Thin HTTP adapter only — all business logic (what "package" means, which
// fields are authoritative, the never-fabricate rules) lives in
// src/backend/services/applicationPackage/getApplicationPackage.ts, which is
// unit-tested under Vitest. This function cannot import that file directly:
// it runs on Deno (Edge Functions), while src/backend is a Vite/Node build
// with npm-resolved imports — the same reason live-scheme-retrieval/index.ts
// is self-contained rather than importing from src/. The response shape
// below mirrors ApplicationPackageResponse field-for-field; keep them in
// sync if either changes.
//
// Reads public.applications directly (service role) and echoes exactly what
// is stored — application_status (the persisted canonical status column,
// migration 202609170005), outcome, filed_with_government, and
// government_application_id are never set, upgraded, or inferred here.
// 'submitted' (applicationStatus) never implies government acceptance —
// that fact lives only in outcome / filedWithGovernment.
//
// LP-APP-* is the sole application identifier this function accepts — no
// UUID application id is ever recognized. Adita's TrackedApplication
// (public.applications) remains the sole application data source; Jordan's
// approval state and ministryMapping/schemeCatalog routing are untouched
// and not read here.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Must match src/apply/application.ts isApplicationId() exactly.
const APPLICATION_ID_PATTERN = /^LP-APP-[A-F0-9]{16}$/i

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
 * Accepts the id from, in order: the literal .../applications/{id}/package
 * path shape, a direct .../{function-name}/{id}/package invocation, or a
 * ?application_id= query param — Edge Functions have no built-in path
 * router, so callers may reach this function via any of these depending on
 * how they invoke it.
 */
function extractApplicationId(url: URL): string | null {
  const segments = url.pathname.split('/').filter(Boolean)
  const appsIdx = segments.indexOf('applications')
  if (appsIdx >= 0 && segments[appsIdx + 1] && segments[appsIdx + 2] === 'package') {
    return segments[appsIdx + 1]
  }
  const pkgIdx = segments.indexOf('package')
  if (pkgIdx > 0) return segments[pkgIdx - 1]
  return url.searchParams.get('application_id')
}

interface ApplicationRow {
  application_id: string
  application_status: string | null
  scheme_id: string
  scheme_name: string
  channel: string
  outcome: string
  filed_with_government: boolean
  simulation: boolean
  government_application_id: string | null
  official_portal_url: string | null
  honest_label: string | null
  detail: string | null
  next_steps: unknown
  consent: unknown
  packet: unknown
  submission_package: unknown
  status_history: unknown
  created_at: string
  updated_at: string
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })
  if (req.method !== 'GET') {
    return jsonResponse({ error: 'method_not_allowed', message: 'Only GET is supported.' }, 405)
  }

  const url = new URL(req.url)
  const applicationId = extractApplicationId(url)

  if (!applicationId || !APPLICATION_ID_PATTERN.test(applicationId)) {
    return jsonResponse(
      { error: 'invalid_application_id', message: 'application_id must be a valid LP-APP-* id.' },
      400,
    )
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(
      {
        error: 'not_configured',
        message: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set as Supabase secrets.',
      },
      503,
    )
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey)

  try {
    const { data, error } = await supabase
      .from('applications')
      .select('*')
      .eq('application_id', applicationId)
      .maybeSingle()

    if (error) {
      return jsonResponse({ error: 'upstream_error', message: 'Failed to read the application.' }, 502)
    }
    if (!data) {
      return jsonResponse({ error: 'not_found', message: `No application found for ${applicationId}.` }, 404)
    }

    const row = data as ApplicationRow

    const body = {
      applicationId: row.application_id,
      applicationStatus: row.application_status ?? 'draft',
      schemeId: row.scheme_id,
      schemeName: row.scheme_name,
      channel: row.channel,
      outcome: row.outcome,
      filedWithGovernment: Boolean(row.filed_with_government),
      simulation: Boolean(row.simulation),
      governmentApplicationId: row.government_application_id ?? null,
      officialPortalUrl: row.official_portal_url ?? null,
      honestLabel: row.honest_label ?? '',
      detail: row.detail ?? '',
      nextSteps: Array.isArray(row.next_steps) ? row.next_steps : [],
      consent: row.consent ?? null,
      packet: row.packet ?? null,
      submissionPackage: row.submission_package ?? null,
      statusHistory: Array.isArray(row.status_history) ? row.status_history : [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }

    return jsonResponse(body, 200)
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error resolving the application package.'
    return jsonResponse({ error: 'internal_error', message }, 500)
  }
})
