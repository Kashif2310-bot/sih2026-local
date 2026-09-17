import { beforeEach, describe, expect, it } from 'vitest'
import { routeApplication } from './ministries'
import {
  appendAudit,
  createApplication,
  getApplication,
  getLastApplicationId,
  listApplications,
  newApplicationId,
  seedDemoApplicationsOnce,
  setStatus,
} from './store'
import type { Application } from './types'

function makeApp(id: string): Application {
  const now = Date.now()
  return {
    id,
    createdAt: now,
    updatedAt: now,
    applicant: {
      name: 'Test Applicant',
      age: 30,
      gender: 'female',
      community: 'sc',
      phone: '9900000000',
      address: 'Addr',
      villageOrTown: 'Dinka',
      district: 'Mandya',
      state: 'Karnataka',
      bankAccountNumber: '1234',
      bankIfsc: 'SBIN0001234',
      category: 'dairy',
      businessDescription: 'Test',
    },
    leadMinistryId: 'animal_husbandry',
    supportingMinistryIds: ['finance', 'social_justice'],
    schemeId: 'term_loan',
    schemeName: 'NSFDC Term Loan Scheme',
    projectCost: 1_000_000,
    loanAmount: 900_000,
    lokScore: 84,
    lokScoreBreakdown: null,
    quorumRequired: 2,
    quorumPool: 3,
    mentorRequired: false,
    documents: [],
    signatures: [],
    status: 'submitted',
    consentGiven: true,
    consentAt: now,
    auditTrail: [],
  }
}

beforeEach(() => {
  localStorage.clear()
})

describe('platform/store', () => {
  it('creates and reads back an application', () => {
    const app = makeApp(newApplicationId())
    createApplication(app)
    expect(getApplication(app.id)?.applicant.name).toBe('Test Applicant')
    expect(getLastApplicationId()).toBe(app.id)
  })

  it('lists applications newest-first', () => {
    const a = makeApp('APP-1')
    const b = { ...makeApp('APP-2'), createdAt: a.createdAt + 1000 }
    createApplication(a)
    createApplication(b)
    expect(listApplications().map((x) => x.id)).toEqual(['APP-2', 'APP-1'])
  })

  it('appends audit events without losing prior ones', () => {
    const app = makeApp(newApplicationId())
    createApplication(app)
    appendAudit(app.id, { actor: 'Officer A', action: 'note', detail: 'first' })
    appendAudit(app.id, { actor: 'Officer B', action: 'note', detail: 'second' })
    const updated = getApplication(app.id)
    expect(updated?.auditTrail.map((e) => e.detail)).toEqual(['first', 'second'])
  })

  it('setStatus updates status and records an audit event', () => {
    const app = makeApp(newApplicationId())
    createApplication(app)
    setStatus(app.id, 'approved', 'Officer A', 'quorum met')
    const updated = getApplication(app.id)
    expect(updated?.status).toBe('approved')
    expect(updated?.auditTrail.at(-1)?.action).toBe('status_changed:approved')
  })

  it('seeds demo applications exactly once', () => {
    seedDemoApplicationsOnce()
    const countAfterFirstSeed = listApplications().length
    expect(countAfterFirstSeed).toBeGreaterThan(0)
    seedDemoApplicationsOnce()
    expect(listApplications().length).toBe(countAfterFirstSeed)
  })
})

describe('platform/ministries routeApplication', () => {
  it('routes dairy to Animal Husbandry & Dairying, co-routing Finance and Social Justice', () => {
    const result = routeApplication({ category: 'dairy', gender: 'male', community: 'sc' })
    expect(result.leadMinistryId).toBe('animal_husbandry')
    expect(result.supportingMinistryIds).toEqual(expect.arrayContaining(['finance', 'social_justice']))
    expect(result.supportingMinistryIds).not.toContain('animal_husbandry')
  })

  it('co-routes Women & Child Development for women applicants', () => {
    const result = routeApplication({ category: 'textiles', gender: 'female', community: 'st' })
    expect(result.supportingMinistryIds).toContain('women_child')
  })
})
