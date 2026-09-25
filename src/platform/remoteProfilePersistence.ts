/**
 * Browser-side remote persistence for the shared ApplicantProfile — the
 * same pattern remotePersistence.ts uses for TrackedApplication, applied to
 * a second data type.
 *
 *   AssistantContext.tsx setApplicantProfile(...)  [existing React state, unchanged]
 *     -> syncApplicantProfile()                    [this file, fire-and-forget]
 *     -> createSupabaseSharedProfilePersistence     [EXISTING service, reused]
 *     -> Supabase (authenticated client, RLS-enforced on applicant_profiles.owner_user_id)
 *
 * Reuses remotePersistence.ts's own ensureIdentity()/isRemotePersistenceConfigured()
 * directly rather than re-implementing anonymous-auth resolution a second
 * time — one identity per browser tab, shared by both data types.
 *
 * A DELIBERATE DIFFERENCE FROM remotePersistence.ts, READ BEFORE ASSUMING
 * PARITY: TrackedApplication already had a localStorage-backed local store
 * (apply/store.ts) before this pattern was extended to it — "localStorage
 * stays authoritative" was already true, and remote sync was purely
 * additive. The shared ApplicantProfile (AssistantContext.tsx's
 * `applicantProfile` state) has NO local persistence at all today — it is
 * plain in-memory React state that resets on reload, by whatever the
 * original design intended. This file adds ONLY the remote-sync half,
 * fire-and-forget, without inventing a new localStorage layer for data that
 * was never persisted locally — deciding whether conversation-level
 * profile data should survive a reload is a product decision, not one to
 * make silently while wiring up sync. See docs/handoffs/overnight-2026-09-25.md.
 *
 * A stable per-browser profile id is generated once and cached in
 * localStorage (this one storage write IS safe and intentional: it is
 * just an opaque identifier, not the profile data itself, and without it
 * every sync would create a new orphaned row instead of updating one).
 */

import type { ApplicantProfile } from '../shared/applicantProfile'
import { createSupabaseSharedProfilePersistence } from '../backend/services/sharedProfilePersistence'
import { ensureIdentity, isRemotePersistenceConfigured, type RemoteSyncResult } from './remotePersistence'

const PROFILE_ID_STORAGE_KEY = 'lokpulse.sharedApplicantProfileId'

/** The stable id this browser's ApplicantProfile is upserted under. Created once, reused for every sync — never regenerated, or every save would orphan the previous row instead of updating it. */
function getOrCreateLocalProfileId(): string | null {
  try {
    const existing = localStorage.getItem(PROFILE_ID_STORAGE_KEY)
    if (existing) return existing
    const id = crypto.randomUUID()
    localStorage.setItem(PROFILE_ID_STORAGE_KEY, id)
    return id
  } catch {
    // Private browsing or storage disabled — sync simply cannot persist an
    // id to reuse. Returning null makes syncApplicantProfile() a clean
    // no-op rather than creating a fresh orphaned row on every call.
    return null
  }
}

/**
 * Mirrors the shared ApplicantProfile to Supabase under this browser's own
 * identity. Never throws and never blocks the caller — a failed or skipped
 * sync must not be able to affect the assistant conversation, which keeps
 * working entirely from its existing in-memory state regardless of this
 * function's outcome.
 */
export async function syncApplicantProfile(profile: ApplicantProfile): Promise<RemoteSyncResult> {
  if (!isRemotePersistenceConfigured()) return { ok: false, reason: 'not_configured' }

  const id = getOrCreateLocalProfileId()
  if (!id) return { ok: false, reason: 'write_failed', detail: 'localStorage unavailable for profile id' }

  const client = await ensureIdentity()
  if (!client) return { ok: false, reason: 'no_identity' }

  try {
    // The existing, already-tested persistence service — not a second
    // implementation of the same upsert.
    await createSupabaseSharedProfilePersistence(client).upsert(id, profile)
    return { ok: true }
  } catch (err) {
    return { ok: false, reason: 'write_failed', detail: err instanceof Error ? err.message : String(err) }
  }
}

/** Reads this identity's shared profile back from Supabase, or null when unavailable/not yet synced. */
export async function fetchRemoteApplicantProfile(): Promise<ApplicantProfile | null> {
  if (!isRemotePersistenceConfigured()) return null
  const id = getOrCreateLocalProfileId()
  if (!id) return null
  const client = await ensureIdentity()
  if (!client) return null
  try {
    return await createSupabaseSharedProfilePersistence(client).get(id)
  } catch {
    return null
  }
}
