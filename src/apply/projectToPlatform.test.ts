import { beforeEach, describe, expect, it } from 'vitest'
import { EMPTY_PROFILE, type UserProfile } from '../assistant/types'
import { newApplicationId } from './application'
import { saveTrackedApplication } from './store'
import { publishTrackedApplicationToPlatform } from './projectToPlatform'
import { prepareApplication, submitApplication } from './workflow'
import { getSchemeApplicationSpec } from './catalog'
import { peekApprovalCase, resetApprovalService } from '../platform/approvalBridge'
import { listApplications, newApplicationId as platformNewApplicationId, seedDemoApplicationsOnce } from '../platform/store'

const POULTRY: UserProfile = {
  ...EMPTY_PROFILE,
  rawNotes: [],
  age: 24,
  areaType: 'rural',
  state: 'Karnataka',
  socialCategory: 'sc',
  gender: 'female',
  annualIncome: 200_000,
  businessSector: 'poultry',
  businessStage: 'new',
  businessStatus: 'idea',
  investmentRequired: 300_000,
  ownContribution: 30_000,
}

function completeOverrides(): Record<string, string | number | boolean> {
  return {
    applicant_name: 'Lakshmi S',
    mobile: '9876543210',
  }
}

function declareAllDocs(schemeId: string) {
  const spec = getSchemeApplicationSpec(schemeId)
  const declarations: Record<string, 'declared_available'> = {}
  for (const d of spec.documents) declarations[d.key] = 'declared_available'
  return declarations
}

beforeEach(() => {
  localStorage.clear()
  resetApprovalService()
})

describe('canonical LP-APP-* identity', () => {
  it('apply and platform generators issue the same LP-APP-* format (one generator)', () => {
    expect(newApplicationId()).toMatch(/^LP-APP-[A-F0-9]{16}$/i)
    expect(platformNewApplicationId()).toMatch(/^LP-APP-[A-F0-9]{16}$/i)
  })

  it('application submission generates LP-APP-* and does not mint a second id', async () => {
    const issued = newApplicationId()
    const prepared = prepareApplication({
      schemeId: 'nsfdc-term-loan',
      profile: POULTRY,
      fieldOverrides: completeOverrides(),
      documentDeclarations: declareAllDocs('nsfdc-term-loan'),
      channel: 'guided',
    })
    const result = await submitApplication({
      prepared,
      channel: 'guided',
      consentAccepted: true,
      simulate: false,
      applicationId: issued,
    })
    expect(result.applicationId).toBe(issued)
    expect(result.applicationId).toMatch(/^LP-APP-[A-F0-9]{16}$/i)
    expect(result.applicationId.startsWith('APP-') && !result.applicationId.startsWith('LP-APP-')).toBe(false)
  })

  it('Assistant-originated Apply submission publishes TrackedApplication to admin with the same LP-APP-*', async () => {
    const issued = newApplicationId()
    const prepared = prepareApplication({
      schemeId: 'nsfdc-term-loan',
      profile: POULTRY,
      fieldOverrides: completeOverrides(),
      documentDeclarations: declareAllDocs('nsfdc-term-loan'),
      channel: 'guided',
    })
    const tracked = await submitApplication({
      prepared,
      channel: 'guided',
      consentAccepted: true,
      simulate: false,
      applicationId: issued,
      conversation: { source: 'assistant', extractedProfile: { ...POULTRY } },
    })
    saveTrackedApplication(tracked)

    const adminRows = listApplications().filter((a) => a.id === issued)
    expect(adminRows).toHaveLength(1)
    expect(adminRows[0]!.id).toBe(tracked.applicationId)
    expect(adminRows[0]!.id).toMatch(/^LP-APP-[A-F0-9]{16}$/i)
    expect(adminRows[0]!.applicant.name).toBe('Lakshmi S')

    const approval = peekApprovalCase(issued)
    expect(approval).not.toBeNull()
    expect(approval!.applicationId).toBe(issued)
  })

  it('republishing does not create a second application id or a second admin row', async () => {
    const prepared = prepareApplication({
      schemeId: 'pm-mudra-yojana',
      profile: POULTRY,
      fieldOverrides: completeOverrides(),
      documentDeclarations: declareAllDocs('pm-mudra-yojana'),
      channel: 'guided',
    })
    const tracked = await submitApplication({
      prepared,
      channel: 'guided',
      consentAccepted: true,
      simulate: false,
    })
    saveTrackedApplication(tracked)
    publishTrackedApplicationToPlatform(tracked)
    publishTrackedApplicationToPlatform(tracked)

    const matches = listApplications().filter((a) => a.id === tracked.applicationId)
    expect(matches).toHaveLength(1)
  })

  it('does not project blocked / unconsented packets into admin', async () => {
    const prepared = prepareApplication({
      schemeId: 'nsfdc-term-loan',
      profile: POULTRY,
      fieldOverrides: completeOverrides(),
      documentDeclarations: declareAllDocs('nsfdc-term-loan'),
    })
    const blocked = await submitApplication({
      prepared,
      channel: 'guided',
      consentAccepted: false,
      simulate: false,
    })
    saveTrackedApplication(blocked)
    expect(listApplications().some((a) => a.id === blocked.applicationId)).toBe(false)
    expect(peekApprovalCase(blocked.applicationId)).toBeNull()
  })

  it('keeps APP-DEMO-* seed data for existing admin demo screens', () => {
    seedDemoApplicationsOnce()
    const ids = listApplications().map((a) => a.id)
    expect(ids).toContain('APP-DEMO-0001')
    expect(ids).toContain('APP-DEMO-0002')
    expect(ids).toContain('APP-DEMO-0003')
    expect(platformNewApplicationId()).toMatch(/^LP-APP-[A-F0-9]{16}$/i)
  })
})
