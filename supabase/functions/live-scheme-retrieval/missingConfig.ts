/**
 * Pure, portable (Deno- and Node-safe — no Deno.* globals, no URL imports)
 * config-diagnostic helper for live-scheme-retrieval.
 *
 * Reports which required data.gov.in variables are absent, by NAME only —
 * never by value. This exists because of a real incident: .env.example
 * previously documented DATA_GOV_IN_SCHEME_RESOURCE_ID (a DIFFERENT
 * component's variable name — see src/backend/services/officialSource/
 * dataGovInAdapter.ts) instead of the name this function actually reads,
 * so someone could set a Supabase secret under the wrong name and get a
 * silent, unexplained not_configured 503 with no indication why. Returning
 * the missing NAMES lets a caller self-diagnose that exact class of mistake
 * without anyone needing to guess, and without a secret value ever
 * entering a response, a log, or the audit table — this function only ever
 * takes truthiness of its inputs and returns fixed string literals.
 *
 * Kept as its own file (not inlined in index.ts) specifically so it can be
 * imported by a Vitest test under src/ without pulling in index.ts's
 * Deno-only `https://esm.sh/...` import, which Node cannot resolve — the
 * same reason _shared/trustedDomains.ts is a separate, plain file.
 */
export function getMissingDataGovInConfigNames(
  apiKey: string | null | undefined,
  resourceId: string | null | undefined,
): string[] {
  const missing: string[] = []
  if (!apiKey) missing.push('DATA_GOV_IN_API_KEY')
  if (!resourceId) missing.push('DATA_GOV_IN_RESOURCE_ID')
  return missing
}
