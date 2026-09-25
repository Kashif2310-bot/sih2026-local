/**
 * Shared ApplicantProfile ownership / authorization integration tests
 * against the live Supabase project — same migrations, same isolation
 * mechanism, and the same self-cleaning convention as
 * ownership.integration.test.ts (which covers public.applications). This
 * file covers public.applicant_profiles instead, exercised through the
 * ACTUAL browser code path added tonight (src/platform/remoteProfilePersistence.ts
 * -> src/backend/services/sharedProfilePersistence.ts's Supabase
 * implementation), using real anonymous sign-in — the exact auth method the
 * browser uses in production — rather than the password-based users the
 * other ownership test uses.
 *
 * Skipped by default: SUPABASE_INTEGRATION=1 plus a service-role key is
 * required, because creating and deleting throwaway auth users needs admin
 * rights. Everything this file creates, it deletes in afterAll.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { isSupabaseIntegrationEnabled, getSupabaseServerConfig } from './config'
import { createServiceRoleClient } from './client'
import { createSupabaseSharedProfilePersistence } from '../services/sharedProfilePersistence'
import { createEmptyApplicantProfile, withApplicantFields } from '../../shared/applicantProfile'

const enabled = isSupabaseIntegrationEnabled()

describe.skipIf(!enabled)('Shared ApplicantProfile ownership / authorization (RLS, anonymous auth)', () => {
  let admin: SupabaseClient
  let anonUrl: string
  let anonKey: string

  /** Every applicant_profiles row this file creates, so afterAll removes exactly those. */
  const createdProfileIds: string[] = []
  /** Every auth user this file creates, so afterAll removes exactly those. */
  const createdUserIds: string[] = []

  async function signInAnon(): Promise<{ client: SupabaseClient; uid: string }> {
    const client = createClient(anonUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data, error } = await client.auth.signInAnonymously()
    if (error || !data.user) throw new Error(`anonymous sign-in failed: ${error?.message ?? 'no user returned'}`)
    createdUserIds.push(data.user.id)
    return { client, uid: data.user.id }
  }

  let clientA: SupabaseClient
  let uidA: string
  let clientB: SupabaseClient
  let uidB: string

  beforeAll(async () => {
    const cfg = getSupabaseServerConfig()
    anonUrl = cfg.url as string
    anonKey = cfg.anonKey as string
    admin = createServiceRoleClient()

    const a = await signInAnon()
    clientA = a.client
    uidA = a.uid
    const b = await signInAnon()
    clientB = b.client
    uidB = b.uid
  }, 60_000)

  afterAll(async () => {
    if (admin) {
      if (createdProfileIds.length > 0) {
        await admin.from('applicant_profiles').delete().in('id', createdProfileIds)
      }
      for (const uid of createdUserIds) {
        await admin.auth.admin.deleteUser(uid)
      }
    }
  }, 60_000)

  it('the two anonymous identities are genuinely different', () => {
    expect(uidA).not.toBe(uidB)
  })

  it('a real anonymous identity can create and read back its own shared profile', async () => {
    const persistence = createSupabaseSharedProfilePersistence(clientA)
    const profile = withApplicantFields(createEmptyApplicantProfile(), { age: 28 }, { source: 'user_provided' })

    const created = await persistence.create(profile)
    expect(created.applicantId).toBeTruthy()
    createdProfileIds.push(created.applicantId as string)

    const fetched = await persistence.get(created.applicantId as string)
    expect(fetched?.data.age).toBe(28)
  })

  it('owner_user_id is stamped by the database default, not client-supplied', async () => {
    const { data } = await admin
      .from('applicant_profiles')
      .select('owner_user_id')
      .eq('id', createdProfileIds[0])
      .single()
    expect(data?.owner_user_id).toBe(uidA)
  })

  it('a second, independent anonymous identity CANNOT read the first identity\'s profile', async () => {
    const persistence = createSupabaseSharedProfilePersistence(clientB)
    const fetched = await persistence.get(createdProfileIds[0])
    expect(fetched).toBeNull()
  })

  it('a second identity CANNOT overwrite the first identity\'s profile via upsert', async () => {
    const persistence = createSupabaseSharedProfilePersistence(clientB)
    const forged = withApplicantFields(createEmptyApplicantProfile(), { age: 999 }, { source: 'user_provided' })
    await expect(persistence.upsert(createdProfileIds[0], forged)).rejects.toThrow()

    // The original value must be completely unchanged.
    const { data } = await admin.from('applicant_profiles').select('profile').eq('id', createdProfileIds[0]).single()
    expect((data?.profile as { data?: { age?: number } })?.data?.age).toBe(28)
  })

  it('the owner can update their own profile via upsert', async () => {
    const persistence = createSupabaseSharedProfilePersistence(clientA)
    const updated = withApplicantFields(createEmptyApplicantProfile(), { age: 29 }, { source: 'user_provided' })
    await persistence.upsert(createdProfileIds[0], updated)

    const fetched = await persistence.get(createdProfileIds[0])
    expect(fetched?.data.age).toBe(29)
  })

  it('the profile is readable again from a BRAND NEW session under the same identity (real persistence, not just an in-memory echo)', async () => {
    const fresh = createClient(anonUrl, anonKey, { auth: { persistSession: false } })
    // A brand-new anonymous sign-in is a DIFFERENT identity (uid changes),
    // so re-use identity A's real access token to simulate the same citizen
    // returning in a new tab/session rather than becoming a third identity.
    const { data: sessionData } = await clientA.auth.getSession()
    await fresh.auth.setSession({
      access_token: sessionData.session!.access_token,
      refresh_token: sessionData.session!.refresh_token,
    })
    const fetched = await createSupabaseSharedProfilePersistence(fresh).get(createdProfileIds[0])
    expect(fetched?.data.age).toBe(29)
  })
})
