/**
 * Supabase configuration.
 * Browser: VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY (or publishable) only.
 * Server/tests: SUPABASE_* from process.env (incl. secret/service role).
 * NEVER expose service-role / secret via Vite / import.meta.env.
 *
 * Supports both classic keys (ANON / SERVICE_ROLE) and new Supabase keys
 * (PUBLISHABLE / SECRET).
 */

export interface SupabasePublicConfig {
  url: string | null
  anonKey: string | null
  configured: boolean
}

export interface SupabaseServerConfig {
  url: string | null
  anonKey: string | null
  serviceRoleKey: string | null
  /** True when URL + service role/secret are present (integration / Edge). */
  serviceConfigured: boolean
  /** True when URL + anon/publishable are present. */
  anonConfigured: boolean
}

function readMeta(name: string): string | null {
  try {
    const v = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.[name]
    return typeof v === 'string' && v.trim() ? v.trim() : null
  } catch {
    return null
  }
}

function readProcess(name: string): string | null {
  if (typeof process === 'undefined' || !process.env) return null
  const v = process.env[name]
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function firstNonEmpty(...values: Array<string | null | undefined>): string | null {
  for (const v of values) {
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return null
}

export function getSupabasePublicConfig(): SupabasePublicConfig {
  const url = firstNonEmpty(
    readMeta('VITE_SUPABASE_URL'),
    readProcess('VITE_SUPABASE_URL'),
    readProcess('SUPABASE_URL'),
  )
  const anonKey = firstNonEmpty(
    readMeta('VITE_SUPABASE_ANON_KEY'),
    readProcess('VITE_SUPABASE_ANON_KEY'),
    readProcess('SUPABASE_ANON_KEY'),
    readProcess('SUPABASE_PUBLISHABLE_KEY'),
  )
  return {
    url,
    anonKey,
    configured: Boolean(url && anonKey),
  }
}

export function getSupabaseServerConfig(): SupabaseServerConfig {
  const publicCfg = getSupabasePublicConfig()
  const serviceRoleKey = firstNonEmpty(
    readProcess('SUPABASE_SERVICE_ROLE_KEY'),
    readProcess('SUPABASE_SECRET_KEY'),
  )
  // Guard: never accept a VITE_-prefixed service/secret role
  if (
    readMeta('VITE_SUPABASE_SERVICE_ROLE_KEY') ||
    readProcess('VITE_SUPABASE_SERVICE_ROLE_KEY') ||
    readMeta('VITE_SUPABASE_SECRET_KEY') ||
    readProcess('VITE_SUPABASE_SECRET_KEY')
  ) {
    throw new Error(
      'Refusing to load VITE_SUPABASE_SERVICE_ROLE_KEY / VITE_SUPABASE_SECRET_KEY — secrets must not be exposed to the browser bundle.',
    )
  }
  return {
    url: publicCfg.url,
    anonKey: publicCfg.anonKey,
    serviceRoleKey,
    serviceConfigured: Boolean(publicCfg.url && serviceRoleKey),
    anonConfigured: publicCfg.configured,
  }
}

export function isSupabaseIntegrationEnabled(): boolean {
  const flag = readProcess('SUPABASE_INTEGRATION')
  if (flag === '0' || flag === 'false') return false
  if (flag === '1' || flag === 'true') return getSupabaseServerConfig().serviceConfigured
  return getSupabaseServerConfig().serviceConfigured
}
