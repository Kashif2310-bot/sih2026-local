/**
 * Supabase client for the assistant's optional backend layer. Reads only
 * the two frontend-safe values (project URL + anon/public key) from Vite
 * env vars — never a service-role key or any other secret. With neither
 * set (the default for anyone who clones this repo without their own
 * Supabase project), getSupabaseClient() returns null and every caller
 * treats that exactly like "backend unavailable": the app keeps working
 * on the local curated dataset only, no error, no crash.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let cached: SupabaseClient | null | undefined

export function isSupabaseConfigured(): boolean {
  return Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY)
}

export function getSupabaseClient(): SupabaseClient | null {
  if (cached !== undefined) return cached
  const url = import.meta.env.VITE_SUPABASE_URL
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
  if (!url || !anonKey) {
    cached = null
    return cached
  }
  cached = createClient(url, anonKey, { auth: { persistSession: false } })
  return cached
}

/** Test-only: clears the cached client so a test can simulate env vars changing. */
export function resetSupabaseClientCacheForTests(): void {
  cached = undefined
}
