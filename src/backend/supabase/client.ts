/**
 * Supabase client factories.
 * - createAnonClient: browser / RLS-scoped
 * - createServiceRoleClient: Node/Edge only — bypasses RLS; never call from UI
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { BackendError } from '../errors'
import { getSupabasePublicConfig, getSupabaseServerConfig } from './config'

export type LokPulseSupabaseClient = SupabaseClient

export function createAnonClient(accessToken?: string): LokPulseSupabaseClient {
  const cfg = getSupabasePublicConfig()
  if (!cfg.url || !cfg.anonKey) {
    throw new BackendError('NOT_CONFIGURED', 'Supabase anon client is not configured (missing URL/anon key).')
  }
  return createClient(cfg.url, cfg.anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: accessToken
      ? {
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      : undefined,
  })
}

export function createServiceRoleClient(): LokPulseSupabaseClient {
  if (typeof window !== 'undefined') {
    throw new BackendError(
      'SERVICE_ROLE_IN_BROWSER',
      'Service-role Supabase client cannot be created in the browser.',
    )
  }
  const cfg = getSupabaseServerConfig()
  if (!cfg.url || !cfg.serviceRoleKey) {
    throw new BackendError(
      'NOT_CONFIGURED',
      'Supabase service-role client is not configured (set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY).',
    )
  }
  return createClient(cfg.url, cfg.serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}

export function tryCreateAnonClient(): LokPulseSupabaseClient | null {
  try {
    if (!getSupabasePublicConfig().configured) return null
    return createAnonClient()
  } catch {
    return null
  }
}

export function tryCreateServiceRoleClient(): LokPulseSupabaseClient | null {
  try {
    if (typeof window !== 'undefined') return null
    if (!getSupabaseServerConfig().serviceConfigured) return null
    return createServiceRoleClient()
  } catch {
    return null
  }
}
