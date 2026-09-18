import { beforeEach, describe, expect, it } from 'vitest'
import { EMPTY_PROFILE, type UserProfile } from '../assistant/types'
import { listApplications, rememberLastApplicationId, seedDemoApplicationsOnce } from '../platform/store'
import { resetApprovalService } from '../platform/approvalBridge'
import { newApplicationId } from './application'
import { citizenApplyNavPath, existingCitizenApplicationResumePath, NEW_APPLY_PATH } from './resumePath'
import { loadTrackedApplications, saveTrackedApplication } from './store'
import { prepareApplication, submitApplication } from './workflow'
import { getSchemeApplicationSpec } from './catalog'

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

describe('citizen Apply nav resume', () => {
  it('uses the existing new Apply flow when no LP-APP-* exists', () => {
    expect(existingCitizenApplicationResumePath()).toBeNull()
    expect(citizenApplyNavPath()).toBe(NEW_APPLY_PATH)
  })

  it('does not treat seeded APP-DEMO-* rows as the citizen current application', () => {
    seedDemoApplicationsOnce()
    rememberLastApplicationId('APP-DEMO-0001')
    expect(existingCitizenApplicationResumePath()).toBeNull()
    expect(citizenApplyNavPath()).toBe(NEW_APPLY_PATH)
  })

  it('resumes the existing LP-APP-* tracking page and does not mint a second id', async () => {
    const issued = newApplicationId()
    const prepared = prepareApplication({
      schemeId: 'nsfdc-term-loan',
      profile: {
        ...POULTRY,
        state: 'Kerala',
        age: 26,
        businessSector: 'dairy',
        proposedBusiness: 'small dairy business',
      },
      fieldOverrides: { applicant_name: 'Lakshmi Nair', mobile: '9876543210' },
      documentDeclarations: declareAllDocs('nsfdc-term-loan'),
      channel: 'guided',
    })
    const tracked = await submitApplication({
      prepared,
      channel: 'guided',
      consentAccepted: true,
      simulate: false,
      applicationId: issued,
    })
    saveTrackedApplication(tracked)
    saveTrackedApplication(tracked)

    expect(tracked.applicationId).toBe(issued)
    expect(citizenApplyNavPath()).toBe(`/apply/track/${encodeURIComponent(tracked.trackingId)}`)
    expect(loadTrackedApplications().filter((a) => a.applicationId === issued)).toHaveLength(1)
    expect(listApplications().filter((a) => a.id === issued)).toHaveLength(1)
  })
})
