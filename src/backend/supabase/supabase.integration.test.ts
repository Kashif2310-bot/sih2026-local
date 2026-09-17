/**
 * Supabase integration tests — run only when local/remote Supabase is configured.
 * Skip by default so CI / fresh clones stay green without Docker.
 *
 * Enable: SUPABASE_INTEGRATION=1 with SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 * (typically via .env.local from `npx supabase start`).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { isSupabaseIntegrationEnabled, getSupabaseServerConfig } from './config'
import { createServiceRoleClient, type LokPulseSupabaseClient } from './client'
import { createBackendServices, type BackendServices } from '../services/createBackendServices'
import { fromEntrepreneurProfile } from '../adapters/profileAdapter'
import { defaultProfile } from '../../lib/demoProfile'
import { FIXTURE_IDS } from '../registry/fixtureSchemeRegistry'
import { NSFDC } from '../../lib/config'
import type { Uuid } from '../../contracts/common'

const enabled = isSupabaseIntegrationEnabled()

describe.skipIf(!enabled)('Supabase integration', () => {
  let client: LokPulseSupabaseClient
  let backend: BackendServices
  let userId: Uuid
  let createdUserId: string | null = null

  beforeAll(() => {
    client = createServiceRoleClient()
    backend = createBackendServices({ mode: 'supabase', client })
  })

  afterAll(async () => {
    if (createdUserId && client) {
      await client.auth.admin.deleteUser(createdUserId)
    }
  })

  it('has seeded NSFDC schemes with ministry/department FKs', async () => {
    const list = await backend.schemes.listSchemes()
    expect(list.data.length).toBeGreaterThanOrEqual(2)
    expect(list.data.map((s) => s.code).sort()).toEqual([
      'NSFDC_MICRO_FINANCE',
      'NSFDC_TERM_LOAN',
    ])

    const ministries = await backend.schemes.listMinistries()
    expect(ministries.some((m) => m.code === 'MOSJE')).toBe(true)
    const depts = await backend.schemes.listDepartments(FIXTURE_IDS.ministryMosje)
    expect(depts.some((d) => d.code === 'NSFDC')).toBe(true)

    const term = await backend.schemes.getScheme(FIXTURE_IDS.schemeTerm)
    expect(term?.owningMinistryId).toBe(FIXTURE_IDS.ministryMosje)
    expect(term?.owningDepartmentId).toBe(FIXTURE_IDS.deptNsfdc)
    expect(term?.latestVersion?.loanTerms?.loanCapRupees).toBe(NSFDC.termLoanCapRupees)
  })

  it('service role can read registry and server config is present', async () => {
    const cfg = getSupabaseServerConfig()
    expect(cfg.serviceConfigured).toBe(true)
    const { data: rows, error: qErr } = await client.from('schemes').select('id, code').limit(5)
    expect(qErr).toBeNull()
    expect((rows ?? []).length).toBeGreaterThanOrEqual(2)

    const { data: link, error: linkErr } = await client
      .from('departments')
      .select('id, code, ministry_id')
      .eq('id', FIXTURE_IDS.deptNsfdc)
      .single()
    expect(linkErr).toBeNull()
    expect(link?.ministry_id).toBe(FIXTURE_IDS.ministryMosje)
  })

  it('persists profiles and applications end-to-end', async () => {
    const email = `lokpulse-it-${Date.now()}@example.com`
    const { data: created, error: createErr } = await client.auth.admin.createUser({
      email,
      password: 'TestPassword123!',
      email_confirm: true,
    })
    expect(createErr).toBeNull()
    expect(created.user?.id).toBeTruthy()
    userId = created.user!.id as Uuid
    createdUserId = created.user!.id

    const profile = await backend.profiles.create('en', { userId })
    expect(profile.id).toBeTruthy()
    expect(profile.userId).toBe(userId)

    const demo = fromEntrepreneurProfile(defaultProfile())
    const patched = await backend.profiles.applyPatch(profile.id!, {
      name: demo.name,
      age: demo.age,
      gender: demo.gender,
      community: demo.community,
      annualIncome: demo.annualIncome,
      experienceYears: demo.experienceYears,
      category: demo.category,
      availableMargin: demo.availableMargin,
      locationMode: demo.locationMode,
      villageId: demo.villageId,
      radiusKm: demo.radiusKm,
    })
    expect(patched.name.value).toBe('Lakshmi S.')

    const missing = await backend.profiles.getMissingFields(profile.id!)
    expect(missing).toHaveLength(0)

    const recs = await backend.recommendations.recommend({ profile: patched })
    expect(recs.data.some((r) => r.schemeCode === 'NSFDC_TERM_LOAN' && r.eligible)).toBe(true)

    const app = await backend.applications.create({
      userId,
      applicantProfileId: profile.id,
      initialFields: [
        {
          key: 'business_name',
          value: 'Lakshmi Dairy',
          source: 'user',
          updatedAt: new Date().toISOString(),
        },
      ],
    })
    await backend.applications.attachScheme(
      app.id,
      FIXTURE_IDS.schemeTerm,
      FIXTURE_IDS.versionTerm,
      userId,
    )
    await backend.applications.recordConsent(app.id, userId)

    const view = await backend.applicationStatus.getStatusView(app.id)
    expect(view?.application.status).toBe('ready_to_submit')
    expect(view?.application.schemeId).toBe(FIXTURE_IDS.schemeTerm)
    expect(view?.latestVersion?.payload.business_name).toBe('Lakshmi Dairy')
    expect(view?.recentEvents.some((e) => e.type === 'consent_recorded')).toBe(true)
  })

  it('enforces RLS: anon can read active schemes but cannot read applications', async () => {
    const { createAnonClient } = await import('./client')
    const anon = createAnonClient()

    const { data: schemes, error: sErr } = await anon.from('schemes').select('code').eq('status', 'active')
    expect(sErr).toBeNull()
    expect((schemes ?? []).map((s) => s.code).sort()).toEqual([
      'NSFDC_MICRO_FINANCE',
      'NSFDC_TERM_LOAN',
    ])

    const { data: apps, error: aErr } = await anon.from('applications').select('id').limit(5)
    // PostgREST returns empty array under RLS (no policy match), not a hard error
    expect(aErr).toBeNull()
    expect((apps ?? []).length).toBe(0)
  })

  it('keeps ministry→department→scheme FK graph intact', async () => {
    const { data, error } = await client
      .from('schemes')
      .select('code, owning_ministry_id, owning_department_id')
      .eq('code', 'NSFDC_TERM_LOAN')
      .single()
    expect(error).toBeNull()
    expect(data?.owning_ministry_id).toBe(FIXTURE_IDS.ministryMosje)
    expect(data?.owning_department_id).toBe(FIXTURE_IDS.deptNsfdc)

    const { data: dept, error: dErr } = await client
      .from('departments')
      .select('code, ministry_id')
      .eq('id', FIXTURE_IDS.deptNsfdc)
      .single()
    expect(dErr).toBeNull()
    expect(dept?.ministry_id).toBe(FIXTURE_IDS.ministryMosje)
  })

  it('reports RLS enabled on sensitive tables via verify_rls_enabled()', async () => {
    const { data, error } = await client.rpc('verify_rls_enabled')
    expect(error).toBeNull()
    const rows = (data ?? []) as Array<{ table_name: string; rls_enabled: boolean }>
    expect(rows.length).toBeGreaterThanOrEqual(8)
    expect(rows.every((r) => r.rls_enabled === true)).toBe(true)
  })
})
