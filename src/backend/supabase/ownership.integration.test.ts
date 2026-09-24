/**
 * Ownership / authorization integration tests against the live Supabase
 * project (migrations 202609240001 + 202609240002).
 *
 * These are the tests that justify letting the browser write at all. Every
 * other integration test in this repo runs as the service role, which
 * BYPASSES RLS — so none of them can tell you whether one citizen can read
 * another citizen's application. These run as two real, separate
 * authenticated users and assert the isolation directly.
 *
 * Skipped by default, exactly like supabase.integration.test.ts:
 * SUPABASE_INTEGRATION=1 plus a service-role key is required, because
 * creating and deleting throwaway auth users needs admin rights.
 *
 * Everything this file creates, it deletes in afterAll.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js'
import { isSupabaseIntegrationEnabled, getSupabaseServerConfig } from './config'
import { createServiceRoleClient } from './client'

const enabled = isSupabaseIntegrationEnabled()

describe.skipIf(!enabled)('Supabase ownership / authorization (RLS)', () => {
  let admin: SupabaseClient
  let anonUrl: string
  let anonKey: string

  const stamp = Date.now()
  const emailFor = (n: string) => `ownership-it-${stamp}-${n}@example.invalid`
  const password = `Probe!${stamp}aA1`
  const applicationId = `LP-APP-${stamp.toString(16).toUpperCase().padStart(16, '0').slice(-16)}`
  /** Every application row this file creates, so afterAll can remove exactly those. */
  const createdIds: string[] = [applicationId]

  let userA: User
  let userB: User
  let clientA: SupabaseClient
  let clientB: SupabaseClient
  let uidA: string

  async function signIn(n: string): Promise<{ client: SupabaseClient; uid: string }> {
    const client = createClient(anonUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data, error } = await client.auth.signInWithPassword({ email: emailFor(n), password })
    if (error) throw new Error(`sign-in ${n} failed: ${error.message}`)
    return { client, uid: data.user.id }
  }

  beforeAll(async () => {
    const cfg = getSupabaseServerConfig()
    anonUrl = cfg.url as string
    anonKey = cfg.anonKey as string
    admin = createServiceRoleClient()

    for (const n of ['a', 'b']) {
      const { data, error } = await admin.auth.admin.createUser({
        email: emailFor(n), password, email_confirm: true,
      })
      if (error) throw new Error(`createUser ${n} failed: ${error.message}`)
      if (n === 'a') userA = data.user
      else userB = data.user
    }

    const a = await signIn('a')
    const b = await signIn('b')
    clientA = a.client
    uidA = a.uid
    clientB = b.client
  }, 60_000)

  afterAll(async () => {
    // Remove only what this file created.
    if (admin) {
      await admin.from('applications').delete().in('application_id', createdIds)
      if (userA) await admin.auth.admin.deleteUser(userA.id)
      if (userB) await admin.auth.admin.deleteUser(userB.id)
    }
  }, 60_000)

  it('an owner can create their own application from a non-service-role client', async () => {
    const { error } = await clientA.from('applications').insert({
      application_id: applicationId,
      scheme_id: 'nsfdc-term-loan',
      scheme_name: 'NSFDC Term Loan Scheme',
      status: 'draft',
      application_status: 'draft',
    })
    expect(error).toBeNull()
  })

  it('owner_user_id is populated by the column default, not by client-supplied data', async () => {
    // The browser never sends an owner; the database stamps auth.uid().
    const { data } = await admin
      .from('applications')
      .select('owner_user_id')
      .eq('application_id', applicationId)
      .single()
    expect(data?.owner_user_id).toBe(uidA)
  })

  it('the application is readable again from a BRAND NEW session (real persistence)', async () => {
    const fresh = await signIn('a')
    const { data, error } = await fresh.client
      .from('applications')
      .select('application_id, application_status')
      .eq('application_id', applicationId)
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
  })

  it('an owner can update their own application', async () => {
    const { error } = await clientA
      .from('applications')
      .update({ application_status: 'submitted' })
      .eq('application_id', applicationId)
    expect(error).toBeNull()

    const { data } = await clientA
      .from('applications')
      .select('application_status')
      .eq('application_id', applicationId)
      .single()
    expect(data?.application_status).toBe('submitted')
  })

  it('a DIFFERENT authenticated user cannot read it', async () => {
    const { data } = await clientB
      .from('applications')
      .select('application_id')
      .eq('application_id', applicationId)
    // RLS filters rather than errors on SELECT — absence is the guarantee.
    expect(data ?? []).toHaveLength(0)
  })

  it('a DIFFERENT authenticated user cannot update it', async () => {
    await clientB
      .from('applications')
      .update({ application_status: 'tracked' })
      .eq('application_id', applicationId)

    const { data } = await admin
      .from('applications')
      .select('application_status')
      .eq('application_id', applicationId)
      .single()
    expect(data?.application_status).toBe('submitted')
  })

  it('an anonymous caller cannot read an owned application', async () => {
    const anon = createClient(anonUrl, anonKey, { auth: { persistSession: false } })
    const { data } = await anon
      .from('applications')
      .select('application_id')
      .eq('application_id', applicationId)
    expect(data ?? []).toHaveLength(0)
  })

  it('an anonymous caller cannot insert an arbitrary application', async () => {
    const anon = createClient(anonUrl, anonKey, { auth: { persistSession: false } })
    const { error } = await anon.from('applications').insert({
      application_id: `LP-APP-${'F'.repeat(16)}`,
      scheme_id: 'nsfdc-term-loan',
      status: 'draft',
    })
    expect(error).not.toBeNull()
  })

  it('a user cannot forge a row owned by someone else', async () => {
    const { error } = await clientB.from('applications').insert({
      application_id: `LP-APP-${(stamp + 1).toString(16).toUpperCase().padStart(16, '0').slice(-16)}`,
      scheme_id: 'nsfdc-term-loan',
      status: 'draft',
      owner_user_id: uidA,
    })
    expect(error).not.toBeNull()
  })

  it('the real persistence service saves a TrackedApplication from an owner session', async () => {
    // This is the exact code path the browser adapter uses
    // (src/platform/remotePersistence.ts) — the shared, already-tested
    // service driven by an ordinary authenticated client rather than the
    // service role. It covers save()'s SECOND write (the application_events
    // row), which RLS silently blocked until migration 202609240003.
    const { createSupabaseAditaApplicationPersistence } = await import(
      '../services/aditaApplicationPersistence'
    )
    const serviceAppId = `LP-APP-${(stamp + 7).toString(16).toUpperCase().padStart(16, '0').slice(-16)}`
    createdIds.push(serviceAppId)

    const persistence = createSupabaseAditaApplicationPersistence(clientA)
    const now = new Date().toISOString()
    const tracked = {
      applicationId: serviceAppId,
      trackingId: serviceAppId,
      schemeId: 'nsfdc-term-loan',
      schemeName: 'NSFDC Term Loan Scheme',
      channel: 'guided',
      outcome: 'prepared',
      filedWithGovernment: false,
      simulation: false,
      honestLabel: 'Prepared',
      detail: 'ownership integration test',
      nextSteps: [],
      packet: { fields: {}, documents: [] },
      consent: {},
      statusHistory: [{ step: 'prepared', at: now }],
      createdAt: now,
      updatedAt: now,
    } as unknown as Parameters<typeof persistence.save>[0]

    await expect(persistence.save(tracked)).resolves.toBeDefined()

    // Read back through the same service — proves round-trip persistence.
    const fetched = await persistence.get(serviceAppId)
    expect(fetched?.applicationId).toBe(serviceAppId)

    // And it is genuinely owned, so another user cannot see it.
    const { data: leaked } = await clientB
      .from('applications')
      .select('application_id')
      .eq('application_id', serviceAppId)
    expect(leaked ?? []).toHaveLength(0)
  })

  it('legacy unowned rows remain publicly readable (backward compatibility)', async () => {
    // Every pre-existing row has owner_user_id NULL and must keep behaving
    // exactly as it did before ownership was introduced.
    const anon = createClient(anonUrl, anonKey, { auth: { persistSession: false } })
    const { data, error } = await anon
      .from('applications')
      .select('application_id')
      .is('owner_user_id', null)
      .limit(1)
    expect(error).toBeNull()
    expect((data ?? []).length).toBeGreaterThan(0)
  })
})
