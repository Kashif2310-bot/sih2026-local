import { describe, expect, it } from 'vitest'
import { evaluateEligibility } from '../../assistant/eligibility'
import { SCHEMES } from '../../assistant/data/schemes'
import { EMPTY_PROFILE, type RankedScheme, type UserProfile } from '../../assistant/types'
import { createEmptyApplicantProfile, withApplicantField } from '../../shared/applicantProfile'
import { assessReadiness } from '../../assistant/conversation/readiness'
import { buildPersonalizedReport } from '../../assistant/conversation/report'
import { buildActionPlan } from '../../assistant/orchestrator'
import type { ApplicantProfile } from '../../shared/applicantProfile'
import { buildAnalysisPanelView, financingIntentionI18nKey } from './analysisPanelView'

function schemeById(id: string) {
  const s = SCHEMES.find((x) => x.id === id)
  if (!s) throw new Error(`fixture not found: ${id}`)
  return s
}

function rankedFor(id: string, profile: UserProfile, relevance = 80): RankedScheme {
  const scheme = schemeById(id)
  return { scheme, eligibility: evaluateEligibility(profile, scheme), relevance, rankScore: relevance }
}

function applicantFrom(profile: UserProfile): ApplicantProfile {
  let a = createEmptyApplicantProfile()
  const stamp = { source: 'user_provided' as const, capturedAt: '2026-01-01T00:00:00.000Z' }
  const copy = <K extends 'state' | 'businessSector' | 'socialCategory' | 'areaType' | 'businessStage' | 'businessStatus' | 'gender'>(
    field: K,
  ) => {
    const v = profile[field]
    if (v !== undefined) a = withApplicantField(a, field, v, stamp)
  }
  copy('state')
  copy('businessSector')
  copy('socialCategory')
  copy('areaType')
  copy('businessStage')
  copy('businessStatus')
  copy('gender')
  if (profile.age !== undefined) a = withApplicantField(a, 'age', profile.age, stamp)
  if (profile.annualIncome !== undefined) a = withApplicantField(a, 'annualIncome', profile.annualIncome, stamp)
  if (profile.investmentRequired !== undefined) {
    a = withApplicantField(a, 'investmentRequired', profile.investmentRequired, stamp)
  }
  if (profile.ownContribution !== undefined) a = withApplicantField(a, 'ownContribution', profile.ownContribution, stamp)
  return a
}

function reportFor(profile: UserProfile, schemeIds: string[]) {
  const ranked = schemeIds.map((id, i) => rankedFor(id, profile, 90 - i * 15))
  const applicantProfile = applicantFrom(profile)
  const readiness = assessReadiness({ userProfile: profile, ranked, missingFields: [] })
  const actionPlan = buildActionPlan(ranked)
  return buildPersonalizedReport({
    applicantProfile,
    userProfile: profile,
    ranked,
    actionPlan,
    readiness,
    sourceStatus: { status: 'verified_local', checkedAt: '2026-01-02T00:00:00.000Z' },
    reportId: 'analysis-panel-fixture',
  })
}

describe('buildAnalysisPanelView — compact projection of the existing PersonalizedReport', () => {
  const poultry: UserProfile = {
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

  it('surfaces known citizen facts, opportunity, finance, documents, comparative schemes, and uncertainties from the real report', () => {
    const report = reportFor(poultry, ['nsfdc-term-loan', 'pmegp'])
    const view = buildAnalysisPanelView(report)

    expect(view.snapshot.some((e) => e.field === 'state' && e.value === 'Karnataka')).toBe(true)
    expect(view.snapshot.some((e) => e.field === 'businessSector' && e.value === 'poultry')).toBe(true)
    expect(view.snapshot.some((e) => e.field === 'annualIncome' && e.value.startsWith('₹'))).toBe(true)
    expect(view.business?.sector).toBe('poultry')
    expect(view.business?.location).toMatch(/Karnataka/)

    expect(view.opportunity).not.toBeNull()
    expect(view.opportunity!.suitabilityKind).toBeTruthy()
    expect(view.opportunity!.rationale.length).toBeGreaterThan(0)

    expect(view.financial.status).toBeTruthy()
    expect(view.financial.statedInvestmentRequired).toBe(300_000)
    if (view.financial.nsfdcPlan) {
      expect(view.financial.nsfdcPlan.computedBy).toBe('src/lib/finance.ts#buildSchemePlan')
    }

    expect(view.documents.length).toBeGreaterThan(0)
    expect(view.applicationReadiness.totalCount).toBeGreaterThan(0)
    expect(view.comparative.every((c) => c.schemeId !== report.relevantSchemes[0].schemeId)).toBe(true)
    expect(view.comparative.some((c) => /PMEGP|Employment Generation/i.test(c.schemeName))).toBe(true)
    expect(view.nextStepCount).toBe(report.recommendedNextSteps.length)
  })

  it('does not invent a financial plan or citizen facts when the report is empty', () => {
    const readiness = assessReadiness({ userProfile: EMPTY_PROFILE, ranked: [], missingFields: [] })
    const report = buildPersonalizedReport({
      applicantProfile: createEmptyApplicantProfile(),
      ranked: [],
      actionPlan: [],
      readiness,
      sourceStatus: null,
      reportId: 'empty-analysis',
    })
    const view = buildAnalysisPanelView(report)

    expect(view.snapshot).toEqual([])
    expect(view.business).toBeNull()
    expect(view.financial.nsfdcPlan).toBeUndefined()
    expect(view.financial.status).toBe('not_determined')
    expect(view.documents).toEqual([])
    expect(view.comparative).toEqual([])
    expect(view.nextStepCount).toBe(0)
  })

  it('never duplicates the top-ranked scheme into the comparative strip', () => {
    const report = reportFor(poultry, ['nsfdc-term-loan', 'pmegp', 'stand-up-india'])
    const view = buildAnalysisPanelView(report)
    const topId = report.relevantSchemes[0].schemeId
    expect(view.comparative.map((c) => c.schemeId)).not.toContain(topId)
    expect(view.comparative.length).toBeGreaterThan(0)
    expect(view.comparative.length).toBeLessThanOrEqual(4)
  })
})

describe('financingIntentionI18nKey', () => {
  it('maps raw enum tokens and leaves written sentences alone', () => {
    expect(financingIntentionI18nKey('financingRequired')).toBe(
      'assistant.analysis.financingIntentionValue.financingRequired',
    )
    expect(financingIntentionI18nKey('stated financing about ₹3,00,000')).toBeNull()
  })
})
