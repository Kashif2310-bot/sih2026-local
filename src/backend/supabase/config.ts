/**
 * Thin typed config for future Supabase client wiring.
 * Phase 1: no runtime connection required; values may be unset.
 * NEVER read SUPABASE_SERVICE_ROLE_KEY from import.meta.env (browser).
 */

export interface SupabasePublicConfig {
  url: string | null
  anonKey: string | null
  configured: boolean
}

export function getSupabasePublicConfig(): SupabasePublicConfig {
  const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() || null
  const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() || null
  return {
    url,
    anonKey,
    configured: Boolean(url && anonKey),
  }
}
