/**
 * Allowlist of official government (or explicitly government-backed) domains
 * this app will ever treat as a trustworthy source of scheme evidence —
 * whether that's a URL already in the curated dataset (src/assistant/data/
 * schemes.ts) or one returned by the live-retrieval Edge Function
 * (supabase/functions/live-scheme-retrieval). A URL that isn't HTTPS and on
 * this list is never surfaced as evidence and never reaches the AI provider
 * or the response guard's "approved URL" set — it is simply dropped, exactly
 * like a live-retrieval failure.
 *
 * This list must be kept in sync with the copy used by the Edge Function
 * (supabase/functions/_shared/trustedDomains.ts) — the two run in different
 * runtimes (browser vs Deno) and can't share a module without a monorepo
 * build step, so duplication here is a deliberate, documented trade-off
 * rather than an oversight.
 */

export const TRUSTED_GOV_DOMAINS: readonly string[] = [
  // Open Government Data Platform India — the one live source this app
  // actually attempts to call (see supabase/functions/live-scheme-retrieval).
  'data.gov.in',
  'www.data.gov.in',
  'api.data.gov.in',
  // Official sources already used by the curated dataset (src/assistant/data/schemes.ts).
  'nsfdc.nic.in',
  'www.nsfdc.nic.in',
  'kviconline.gov.in',
  'www.kviconline.gov.in',
  'mudra.org.in',
  'www.mudra.org.in',
  'jansamarth.in',
  'www.jansamarth.in',
  'standupmitra.in',
  'www.standupmitra.in',
  'pmvishwakarma.gov.in',
  'www.pmvishwakarma.gov.in',
  'nbcfdc.gov.in',
  'www.nbcfdc.gov.in',
  'kudumbashree.org',
  'www.kudumbashree.org',
]

/** True only for an https:// URL whose hostname is on the allowlist. Anything else — http, a typo domain, a look-alike, a data: URI — is rejected. */
export function isTrustedGovUrl(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:') return false
  return TRUSTED_GOV_DOMAINS.includes(parsed.hostname.toLowerCase())
}
