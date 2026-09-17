/**
 * Deno-runtime mirror of src/assistant/trustedSources.ts. Edge Functions
 * run in a separate Deno deployment from the Vite frontend build, so this
 * small list is duplicated rather than imported across a module boundary
 * that doesn't exist at build time — a deliberate, documented trade-off,
 * not an oversight. Keep both copies in sync when adding a source.
 */

export const TRUSTED_GOV_DOMAINS: readonly string[] = [
  'data.gov.in',
  'www.data.gov.in',
  'api.data.gov.in',
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
