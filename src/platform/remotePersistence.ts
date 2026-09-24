/**
 * Browser-side remote persistence — the write path from the UI to Ishara_26.
 *
 * ARCHITECTURE
 *
 *   UI (unchanged, synchronous)
 *     -> apply/store.ts saveTrackedApplication()   [localStorage, immediate]
 *     -> syncTrackedApplication()                  [this file, fire-and-forget]
 *     -> createSupabaseAditaApplicationPersistence  [EXISTING service, reused]
 *     -> Supabase (authenticated client, RLS-enforced)
 *
 * Three properties make this safe and small:
 *
 * 1. NO SERVICE ROLE. The browser writes under its own Supabase Auth
 *    identity. Authorization is enforced by Postgres RLS
 *    (migration 202609240001), not by trusting client code, so a hostile
 *    client cannot read or modify another citizen's application. That is
 *    why this is a direct client write rather than a privileged Edge
 *    Function: an endpoint holding the service role would have to
 *    re-implement the ownership check that the database can already do,
 *    and a bug in that check would be a silent data leak.
 *
 * 2. NO DUPLICATED PERSISTENCE LOGIC. The row mapping and upsert live in
 *    src/backend/services/aditaApplicationPersistence.ts and are reused
 *    verbatim — that service takes any Supabase client, so the same tested
 *    code serves the service-role backend and this browser caller. The
 *    owner column fills itself via its `default auth.uid()`
 *    (migration 202609240002), so nothing about that service changed.
 *
 * 3. LOCAL FIRST, NEVER LOSSY. localStorage remains the authoritative
 *    immediate write. Remote sync is best-effort and asynchronous: if the
 *    network, Supabase, or the auth provider is unavailable, the UI is
 *    completely unaffected and the citizen loses nothing. Persistence is an
 *    upgrade to the existing behaviour, not a replacement for it.
 *
 * CURRENT LIMITATION — read this before assuming writes are reaching the
 * database. This path only activates once an identity can be obtained.
 * Anonymous sign-ins are a PROJECT SETTING and are currently disabled on
 * Ishara_26 (`anonymous_provider_disabled`), so `ensureIdentity()` resolves
 * to null and every sync becomes a no-op. Nothing breaks, nothing is
 * claimed, and the moment the toggle is enabled this path starts working
 * with no code change. See docs/BACKEND_INTEGRATION.md.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@supabase/supabase-js'
import type { TrackedApplication } from '../apply/types'
import { createSupabaseAditaApplicationPersistence } from '../backend/services/aditaApplicationPersistence'

type Env = Record<string, string | undefined>

function readEnv(): { url: string | null; anonKey: string | null } {
  let env: Env = {}
  try {
    env = (import.meta as ImportMeta & { env?: Env }).env ?? {}
  } catch {
    env = {}
  }
  const url = env.VITE_SUPABASE_URL?.trim() || null
  const anonKey = env.VITE_SUPABASE_ANON_KEY?.trim() || null
  return { url, anonKey }
}

export function isRemotePersistenceConfigured(): boolean {
  const { url, anonKey } = readEnv()
  return Boolean(url && anonKey)
}

/** Why a sync attempt did not reach the database — surfaced for diagnostics, never thrown at the UI. */
export type RemoteSyncSkipReason =
  | 'not_configured'
  | 'no_identity'
  | 'write_failed'

export type RemoteSyncResult =
  | { ok: true }
  | { ok: false; reason: RemoteSyncSkipReason; detail?: string }

let clientPromise: Promise<SupabaseClient | null> | null = null

/**
 * Resolves a Supabase client carrying a real user identity, or null.
 *
 * Memoised on the PROMISE, not the result: two components writing at the
 * same moment on first load would otherwise both trigger a sign-in and
 * create two anonymous users for one citizen.
 *
 * A failure is cached as null for the page's lifetime on purpose — when the
 * provider is disabled, retrying on every single write would turn one
 * disabled setting into a request storm.
 */
export function ensureIdentity(): Promise<SupabaseClient | null> {
  if (clientPromise) return clientPromise

  clientPromise = (async () => {
    const { url, anonKey } = readEnv()
    if (!url || !anonKey) return null

    const client = createClient(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true },
    })

    try {
      const { data } = await client.auth.getSession()
      if (data.session) return client

      // No stored session — establish one. Anonymous sign-in is used
      // because this product has no citizen login and inventing one would
      // be a product change, not an integration change.
      const { error } = await client.auth.signInAnonymously()
      if (error) return null
      return client
    } catch {
      return null
    }
  })()

  return clientPromise
}

/**
 * Mirrors one application to Supabase. Never throws and never blocks the
 * caller's own local write — a failed sync must not be able to break the
 * apply flow.
 */
export async function syncTrackedApplication(app: TrackedApplication): Promise<RemoteSyncResult> {
  if (!isRemotePersistenceConfigured()) return { ok: false, reason: 'not_configured' }

  const client = await ensureIdentity()
  if (!client) return { ok: false, reason: 'no_identity' }

  try {
    // The existing, already-tested persistence service — not a second
    // implementation of the same upsert.
    const persistence = createSupabaseAditaApplicationPersistence(client)
    await persistence.save(app)
    return { ok: true }
  } catch (err) {
    return { ok: false, reason: 'write_failed', detail: err instanceof Error ? err.message : String(err) }
  }
}

/** Reads this identity's applications back from Supabase. Returns [] when persistence is unavailable. */
export async function fetchRemoteApplications(limit = 50): Promise<TrackedApplication[]> {
  if (!isRemotePersistenceConfigured()) return []
  const client = await ensureIdentity()
  if (!client) return []
  try {
    return await createSupabaseAditaApplicationPersistence(client).list(limit)
  } catch {
    return []
  }
}

/** Test-only: clears the memoised identity so a test can simulate a fresh page load. */
export function resetRemotePersistenceForTests(): void {
  clientPromise = null
}
