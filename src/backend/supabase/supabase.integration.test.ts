/**
 * Supabase integration tests — Option A schema.
 * Skip by default: SUPABASE_INTEGRATION=1 + service role required.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { isSupabaseIntegrationEnabled, getSupabaseServerConfig } from './config'
import { createServiceRoleClient, type LokPulseSupabaseClient } from './client'
import { createBackendServices, type BackendServices } from '../services/createBackendServices'
import { SCHEME_TS_IDS } from '../services/schemeCatalogService'
import { withApplicantFields, createEmptyApplicantProfile } from '../../shared/applicantProfile'
import { newApplicationId } from '../../apply/application'
import type { TrackedApplication } from '../../apply/types'

const enabled = isSupabaseIntegrationEnabled()

describe.skipIf(!enabled)('Supabase integration (Option A)', () => {
  let client: LokPulseSupabaseClient
  let backend: BackendServices

  beforeAll(() => {
    client = createServiceRoleClient()
    backend = createBackendServices({ mode: 'supabase', client })
  })

  afterAll(() => {
    // no auth users created in Option A happy-path
  })

  it('scheme catalog SoT is schemes.ts; cache may optionally mirror NSFDC ids', async () => {
    const list = await backend.schemeCatalog.list()
    expect(list.some((s) => s.id === SCHEME_TS_IDS.microFinance)).toBe(true)

    const { data: cacheRows, error } = await client
      .from('schemes')
      .select('id, verification_status')
      .in('id', [SCHEME_TS_IDS.microFinance, SCHEME_TS_IDS.termLoan])
    expect(error).toBeNull()
    // Cache is optional — if seeded, ids must match schemes.ts
    for (const row of cacheRows ?? []) {
      expect([SCHEME_TS_IDS.microFinance, SCHEME_TS_IDS.termLoan]).toContain(row.id)
    }
  })

  it('service config present and ministries seed uses Prerna ids', async () => {
    const cfg = getSupabaseServerConfig()
    expect(cfg.serviceConfigured).toBe(true)
    const { data, error } = await client.from('ministries').select('id, code').eq('id', 'social_justice')
    expect(error).toBeNull()
    expect((data ?? []).length).toBeGreaterThanOrEqual(1)
  })

  it('persists shared profile + Adita application + Jordan approval case', async () => {
    const profile = await backend.sharedProfiles.create(
      withApplicantFields(createEmptyApplicantProfile(), { name: 'Integration We' }, {
        source: 'user_provided',
        confidence: 'high',
      }),
    )
    expect(profile.data.name).toBe('Integration We')

    const applicationId = newApplicationId()
    const now = new Date().toISOString()
    const app: TrackedApplication = {
      applicationId,
      trackingId: `TRK-${applicationId}`,
      schemeId: SCHEME_TS_IDS.microFinance,
      schemeName: 'NSFDC Micro Finance',
      channel: 'guided',
      outcome: 'guided_packet_ready',
      filedWithGovernment: false,
      simulation: false,
      honestLabel: 'Guided packet ready',
      detail: 'integration',
      nextSteps: [],
      packet: {
        schemeId: SCHEME_TS_IDS.microFinance,
        schemeName: 'NSFDC Micro Finance',
        channel: 'guided',
        fields: {},
        documents: [],
        officialApplicationUrl: 'https://nsfdc.nic.in/',
        generatedAt: now,
      },
      consent: {
        accepted: true,
        acceptedAt: now,
        text: 'I consent',
        channel: 'guided',
        simulate: false,
      },
      statusHistory: [{ at: now, step: 'application_id', note: 'it' }],
      createdAt: now,
      updatedAt: now,
    }
    await backend.aditaApplications.save(app)
    const loaded = await backend.aditaApplications.get(applicationId)
    expect(loaded?.schemeId).toBe(SCHEME_TS_IDS.microFinance)

    await backend.jordanApprovals.saveCase({
      applicationId,
      snapshot: {
        applicationId,
        applicantRef: 'it-ref',
        villageId: 'dinka-mandya',
        schemeId: SCHEME_TS_IDS.microFinance,
        projectCost: 100000,
        loanAmount: 80000,
        lokScore: (await import('../../lib/approval/fixtures')).fixtureLokScore(72),
        frozenAt: Date.now(),
      },
      snapshotDigest: '0xit',
      policy: { quorumRequired: 2, quorumPool: 3, mentorRequired: false, derivedFromScore: 72 },
      allocation: {
        applicationId,
        allocatedReviewerIds: ['r1'],
        allocatedAddresses: ['0x1'],
        quorumPool: 3,
        mentorRequired: false,
        mentorReviewerIds: [],
        allocationDigest: '0xalloc',
        allocatedAt: Date.now(),
      },
      signatures: [],
      status: 'open',
    })
    expect((await backend.jordanApprovals.getCase(applicationId))?.status).toBe('open')

    const admin = await backend.admin.getDetail(applicationId)
    expect(admin?.schemeExistsInSourceOfTruth).toBe(true)
  })

  it('verify_rls_enabled reports RLS on core tables', async () => {
    const { data, error } = await client.rpc('verify_rls_enabled')
    expect(error).toBeNull()
    const rows = (data ?? []) as Array<{ table_name: string; rls_enabled: boolean }>
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((r) => r.rls_enabled)).toBe(true)
  })
})
