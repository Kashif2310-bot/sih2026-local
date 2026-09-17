import { describe, expect, it } from 'vitest'
import { createBackendServices } from './createBackendServices'
import { createMemoryAditaApplicationPersistence } from './aditaApplicationPersistence'
import { createMemorySharedProfilePersistence } from './sharedProfilePersistence'
import { createMemoryJordanApprovalPersistence } from './jordanApprovalPersistence'
import { createUnavailableLiveRetrievalGateway } from './liveRetrievalGateway'
import { createAdminApplicationQueries } from './adminApplicationQueries'
import { createSchemeCatalogService, SCHEME_TS_IDS } from './schemeCatalogService'
import { resolveMinistryForScheme } from './ministryMapping'
import {
  sharedProfileFromV2,
  v2FromSharedProfile,
} from '../adapters/applicantProfileV2Bridge'
import { createEmptyApplicantProfileV2, fieldFrom } from '../adapters/profileHelpers'
import { withApplicantFields, createEmptyApplicantProfile } from '../../shared/applicantProfile'
import { FIXTURE_TO_SCHEME_TS_ID, FIXTURE_IDS } from '../registry/fixtureSchemeRegistry'
import { fixtureLokScore, fixtureApplicationSnapshot } from '../../lib/approval/fixtures'
import type { TrackedApplication } from '../../apply/types'
import type { ApprovalCase } from '../../lib/approval/contracts'
import { newApplicationId } from '../../apply/application'

function sampleTrackedApp(id = newApplicationId()): TrackedApplication {
  const now = new Date().toISOString()
  return {
    applicationId: id,
    trackingId: 'TRK-1',
    schemeId: SCHEME_TS_IDS.microFinance,
    schemeName: 'NSFDC Micro Finance',
    channel: 'guided',
    outcome: 'guided_packet_ready',
    filedWithGovernment: false,
    simulation: false,
    honestLabel: 'Guided packet ready',
    detail: 'Local packet only',
    nextSteps: ['Visit SCA'],
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
    statusHistory: [{ at: now, step: 'application_id', note: 'created' }],
    createdAt: now,
    updatedAt: now,
  }
}

describe('Option A scheme catalog', () => {
  it('lists schemes.ts ids including NSFDC', async () => {
    const catalog = createSchemeCatalogService(null)
    const list = await catalog.list()
    expect(list.some((s) => s.id === SCHEME_TS_IDS.microFinance)).toBe(true)
    expect(list.some((s) => s.id === SCHEME_TS_IDS.termLoan)).toBe(true)
    expect(await catalog.get('nsfdc-micro-finance')).not.toBeNull()
    expect(resolveMinistryForScheme('nsfdc-micro-finance')).toBe('social_justice')
  })

  it('maps legacy UUID fixtures to schemes.ts ids', () => {
    expect(FIXTURE_TO_SCHEME_TS_ID[FIXTURE_IDS.schemeMicro]).toBe('nsfdc-micro-finance')
    expect(FIXTURE_TO_SCHEME_TS_ID[FIXTURE_IDS.schemeTerm]).toBe('nsfdc-term-loan')
  })
})

describe('shared profile bridge', () => {
  it('round-trips name through V2 ↔ shared', () => {
    const v2 = createEmptyApplicantProfileV2('en')
    v2.name = fieldFrom('We', 'user', 'high')
    const shared = sharedProfileFromV2(v2)
    expect(shared.data.name).toBe('We')
    const back = v2FromSharedProfile(shared)
    expect(back.name.value).toBe('We')
  })

  it('persists shared profiles in memory', async () => {
    const store = createMemorySharedProfilePersistence()
    const created = await store.create(
      withApplicantFields(createEmptyApplicantProfile(), { name: 'We' }, {
        source: 'user_provided',
        confidence: 'high',
      }),
    )
    expect(created.data.name).toBe('We')
    const id = created.applicantId!
    const got = await store.get(id as `${string}-${string}-${string}-${string}-${string}`)
    expect(got?.data.name).toBe('We')
  })
})

describe('Adita application persistence', () => {
  it('saves and lists LP-APP applications', async () => {
    const apps = createMemoryAditaApplicationPersistence()
    const app = sampleTrackedApp()
    await apps.save(app)
    expect((await apps.get(app.applicationId))?.schemeId).toBe('nsfdc-micro-finance')
    const admin = createAdminApplicationQueries(apps)
    const recent = await admin.listRecent()
    expect(recent[0]?.applicationId).toBe(app.applicationId)
  })

  it('rejects non-Adita application ids', async () => {
    const apps = createMemoryAditaApplicationPersistence()
    await expect(
      apps.save({ ...sampleTrackedApp(), applicationId: 'uuid-style-id' }),
    ).rejects.toThrow(/Invalid Adita applicationId/)
  })
})

describe('Jordan approval persistence', () => {
  it('stores approval case without redesigning multisig', async () => {
    const store = createMemoryJordanApprovalPersistence()
    const applicationId = newApplicationId()
    const snapshot = fixtureApplicationSnapshot(70, {
      applicationId,
      schemeId: 'nsfdc-micro-finance',
      lokScore: fixtureLokScore(70),
    })
    const approvalCase: ApprovalCase = {
      applicationId,
      snapshot,
      snapshotDigest: '0xabc',
      policy: { quorumRequired: 2, quorumPool: 3, mentorRequired: false, derivedFromScore: 70 },
      allocation: {
        applicationId,
        allocatedReviewerIds: ['r1', 'r2'],
        allocatedAddresses: ['0x1', '0x2'],
        quorumPool: 3,
        mentorRequired: false,
        mentorReviewerIds: [],
        allocationDigest: '0xdef',
        allocatedAt: Date.now(),
      },
      signatures: [],
      status: 'open',
    }
    await store.saveCase(approvalCase)
    expect((await store.getCase(approvalCase.applicationId))?.status).toBe('open')
  })
})

describe('live retrieval gateway', () => {
  it('reports not configured without inventing evidence', async () => {
    const gw = createUnavailableLiveRetrievalGateway()
    const result = await gw.retrieve({ schemeIds: ['nsfdc-micro-finance'] })
    expect(result.ok).toBe(false)
    expect(result.errorCode).toBe('not_configured')
    expect(result.items).toEqual([])
  })
})

describe('createBackendServices Option A surfaces', () => {
  it('exposes reconciled services in memory mode', () => {
    const backend = createBackendServices({ mode: 'memory' })
    expect(backend.schemeCatalog).toBeDefined()
    expect(backend.sharedProfiles).toBeDefined()
    expect(backend.aditaApplications).toBeDefined()
    expect(backend.jordanApprovals).toBeDefined()
    expect(backend.liveRetrieval).toBeDefined()
    expect(backend.admin).toBeDefined()
    expect(backend.mode).toBe('memory')
  })
})
