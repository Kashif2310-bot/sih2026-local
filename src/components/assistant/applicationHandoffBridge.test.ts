import { beforeEach, describe, expect, it } from 'vitest'
import { evaluateEligibility } from '../../assistant/eligibility'
import { SCHEMES } from '../../assistant/data/schemes'
import { EMPTY_PROFILE, type RankedScheme, type UserProfile } from '../../assistant/types'
import { createEmptyApplicantProfile, withApplicantField } from '../../shared/applicantProfile'
import { assessReadiness } from '../../assistant/conversation/readiness'
import { buildPersonalizedReport } from '../../assistant/conversation/report'
import { isApplicationId, newApplicationId } from '../../apply/application'
import { getSchemeApplicationSpec } from '../../apply/catalog'
import { prepareApplication, submitApplication } from '../../apply/workflow'
import { loadHandoff, loadTrackedApplications, saveHandoff, saveTrackedApplication } from '../../apply/store'
import { getApplication } from '../../platform/store'
import { peekApprovalCase, resetApprovalService } from '../../platform/approvalBridge'
import { buildStartApplicationFromAnalysis } from './applicationHandoffBridge'

function schemeById(id: string) {
  const s = SCHEMES.find((x) => x.id === id)
  if (!s) throw new Error(`fixture not found: ${id}`)
  return s
}

function rankedFor(id: string, profile: UserProfile, relevance = 80): RankedScheme {
  const scheme = schemeById(id)
  return { scheme, eligibility: evaluateEligibility(profile, scheme), relevance, rankScore: relevance }
}

function applicantFrom(profile: UserProfile) {
  let a = createEmptyApplicantProfile()
  const stamp = { source: 'user_provided' as const, capturedAt: '2026-01-01T00:00:00.000Z' }
  if (profile.state) a = withApplicantField(a, 'state', profile.state, stamp)
  if (profile.businessSector) a = withApplicantField(a, 'businessSector', profile.businessSector, stamp)
  if (profile.socialCategory) a = withApplicantField(a, 'socialCategory', profile.socialCategory, stamp)
  if (profile.annualIncome !== undefined) a = withApplicantField(a, 'annualIncome', profile.annualIncome, stamp)
  return a
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  resetApprovalService()
})

describe('buildStartApplicationFromAnalysis — assistant report -> existing Apply handoff', () => {
  it('produces a handoff for the top-ranked scheme and round-trips through the existing saveHandoff/loadHandoff mechanism unchanged', () => {
    const profile: UserProfile = {
      state: 'Karnataka',
      businessSector: 'poultry',
      socialCategory: 'sc',
      annualIncome: 150_000,
      rawNotes: [],
    }
    const applicantProfile = applicantFrom(profile)
    const ranked = [rankedFor('nsfdc-term-loan', profile, 80), rankedFor('pmegp', profile, 60)]
    const readiness = assessReadiness({ userProfile: profile, ranked, missingFields: [] })
    const report = buildPersonalizedReport({
      applicantProfile,
      userProfile: profile,
      ranked,
      actionPlan: [],
      readiness,
      sourceStatus: { status: 'verified_local', checkedAt: '2026-01-02T00:00:00.000Z' },
      reportId: 'handoff-fixture',
    })

    const result = buildStartApplicationFromAnalysis(report, applicantProfile, profile)
    expect(result).not.toBeNull()
    expect(result!.schemeId).toBe(report.relevantSchemes[0].schemeId)

    // This is the EXACT existing mechanism SchemeDetailModal's own button uses —
    // never a second store, never a second key.
    saveHandoff(result!.handoff)
    const loaded = loadHandoff()
    expect(loaded).toEqual(result!.handoff)
    expect(loaded!.conversation?.source).toBe('assistant')
    expect(loaded!.conversation?.citedScheme).toBe(result!.schemeId)
  })

  it('returns null (never fabricates a scheme) when the report has no candidate yet', () => {
    const readiness = assessReadiness({ userProfile: EMPTY_PROFILE, ranked: [], missingFields: [] })
    const report = buildPersonalizedReport({
      applicantProfile: createEmptyApplicantProfile(),
      ranked: [],
      actionPlan: [],
      readiness,
      sourceStatus: null,
      reportId: 'empty-fixture',
    })
    expect(buildStartApplicationFromAnalysis(report, createEmptyApplicantProfile(), EMPTY_PROFILE)).toBeNull()
  })

  it('the produced handoff actually flows end-to-end into TrackedApplication (LP-APP-*), the platform projection, and Jordan\'s approval intake — the same pipeline SchemeDetailModal already reaches', async () => {
    const profile: UserProfile = {
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
      rawNotes: [],
    }
    const applicantProfile = applicantFrom(profile)
    const ranked = [rankedFor('nsfdc-term-loan', profile, 80)]
    const readiness = assessReadiness({ userProfile: profile, ranked, missingFields: [] })
    const report = buildPersonalizedReport({
      applicantProfile,
      userProfile: profile,
      ranked,
      actionPlan: [],
      readiness,
      sourceStatus: null,
      reportId: 'e2e-fixture',
    })

    const result = buildStartApplicationFromAnalysis(report, applicantProfile, profile)
    expect(result).not.toBeNull()
    const { schemeId, handoff } = result!

    // From here on this is EXACTLY what ApplyStartPage -> ApplyWizard do today.
    const spec = getSchemeApplicationSpec(schemeId)
    const declarations: Record<string, 'declared_available'> = {}
    for (const d of spec.documents) declarations[d.key] = 'declared_available'

    const prepared = prepareApplication({
      schemeId,
      profile: handoff.profile,
      fieldOverrides: { applicant_name: 'Lakshmi S', mobile: '9876543210' },
      documentDeclarations: declarations,
      channel: 'guided',
    })
    const applicationId = newApplicationId()
    const tracked = await submitApplication({
      prepared,
      channel: 'guided',
      consentAccepted: true,
      simulate: false,
      applicationId,
      conversation: handoff.conversation,
    })
    expect(isApplicationId(tracked.applicationId)).toBe(true)
    expect(tracked.applicationId).toBe(applicationId)

    saveTrackedApplication(tracked)
    expect(loadTrackedApplications().some((a) => a.applicationId === applicationId)).toBe(true)

    // publishTrackedApplicationToPlatform runs automatically from
    // saveTrackedApplication — same LP-APP-* id, no second id minted.
    const platformApp = getApplication(applicationId)
    expect(platformApp?.id).toBe(applicationId)

    const approvalCase = peekApprovalCase(applicationId)
    expect(approvalCase?.applicationId).toBe(applicationId)
  })
})
