import { describe, expect, it } from 'vitest'
import { buildSchemePlan } from '../../lib/finance'
import { computeLokScore } from '../../lib/lokScore'
import { createEmptyApplicantProfile, withApplicantField } from '../../shared/applicantProfile'
import { evaluateEligibility } from '../eligibility'
import { SCHEMES } from '../data/schemes'
import { buildActionPlan } from '../orchestrator'
import { findUnapprovedAmounts, validateProviderReply } from '../ai/responseGuard'
import type { AIRequestContext } from '../ai/types'
import { EMPTY_PROFILE, type RankedScheme, type UserProfile } from '../types'
import { buildDeterministicAnalysis, buildMatchExplanation } from './deterministicAnalysis'
import {
  attachGuardedExplanation,
  composeOfflineReportExplanation,
  type ReportExplanationProvider,
} from './explanationProvider'
import { assessReadiness } from './readiness'
import { buildPersonalizedReport } from './report'
import { identifyMissingFields } from '../missingFields'

function schemeById(id: string) {
  const s = SCHEMES.find((x) => x.id === id)
  if (!s) throw new Error(`fixture not found: ${id}`)
  return s
}

function rankedFor(id: string, profile: UserProfile, relevance = 60): RankedScheme {
  const scheme = schemeById(id)
  const eligibility = evaluateEligibility(profile, scheme)
  return { scheme, eligibility, relevance, rankScore: relevance }
}

function dairyExpansionProfile(): UserProfile {
  return {
    state: 'Karnataka',
    businessSector: 'dairy',
    businessStage: 'existing_expansion',
    businessStatus: 'existing',
    landOrAssets: '5 cows',
    socialCategory: 'sc',
    annualIncome: 150_000,
    financingRequired: 300_000,
    ownContribution: 100_000,
    rawNotes: [],
  }
}

function dairyGreenfieldProfile(): UserProfile {
  return {
    state: 'Kerala',
    businessSector: 'dairy',
    businessStage: 'new',
    businessStatus: 'idea',
    socialCategory: 'general',
    rawNotes: [],
  }
}

function applicantFrom(profile: UserProfile) {
  let a = createEmptyApplicantProfile()
  const stamp = { source: 'user_provided' as const, capturedAt: '2026-01-01T00:00:00.000Z' }
  if (profile.state) a = withApplicantField(a, 'state', profile.state, stamp)
  if (profile.businessSector) a = withApplicantField(a, 'businessSector', profile.businessSector, stamp)
  if (profile.businessStage) a = withApplicantField(a, 'businessStage', profile.businessStage, stamp)
  if (profile.businessStatus) a = withApplicantField(a, 'businessStatus', profile.businessStatus, stamp)
  if (profile.landOrAssets) a = withApplicantField(a, 'landOrAssets', profile.landOrAssets, stamp)
  if (profile.socialCategory) a = withApplicantField(a, 'socialCategory', profile.socialCategory, stamp)
  if (profile.annualIncome !== undefined) a = withApplicantField(a, 'annualIncome', profile.annualIncome, stamp)
  if (profile.financingRequired !== undefined) a = withApplicantField(a, 'financingRequired', profile.financingRequired, stamp)
  if (profile.ownContribution !== undefined) a = withApplicantField(a, 'ownContribution', profile.ownContribution, stamp)
  if (profile.investmentRequired !== undefined) a = withApplicantField(a, 'investmentRequired', profile.investmentRequired, stamp)
  if (profile.proposedBusiness) a = withApplicantField(a, 'businessDescription', profile.proposedBusiness, stamp)
  return a
}

function buildReportFor(profile: UserProfile, opts?: { userUncertainFields?: Array<keyof UserProfile>; previous?: { reportId: string; version: number } }) {
  const ranked = [
    rankedFor('nsfdc-micro-finance', profile, 80),
    rankedFor('pmegp', profile, 70),
  ]
  const missingFields = identifyMissingFields(profile)
  const readiness = assessReadiness({ userProfile: profile, ranked, missingFields })
  const actionPlan = buildActionPlan(ranked)
  return buildPersonalizedReport({
    applicantProfile: applicantFrom(profile),
    userProfile: profile,
    ranked,
    actionPlan,
    readiness,
    sourceStatus: { status: 'verified_local', checkedAt: '2026-01-02T00:00:00.000Z' },
    now: '2026-01-02T00:00:00.000Z',
    userUncertainFields: opts?.userUncertainFields,
    previous: opts?.previous,
    reportId: 'fixed-id',
  })
}

describe('Prompt 7 — personalized analysis & report intelligence', () => {
  it('1. report generation from minimal profile', () => {
    const profile: UserProfile = { businessSector: 'dairy', rawNotes: [] }
    const report = buildReportFor(profile)
    expect(report.maturity).toMatch(/exploratory|preliminary|actionable/)
    expect(report.executiveSummary.whatCitizenWants).toBeDefined()
    expect(report.opportunityAssessment.businessSuitability.claimsProfitability).toBe(false)
  })

  it('2. report generation from actionable profile', () => {
    const report = buildReportFor(dairyExpansionProfile())
    expect(['actionable', 'application_ready', 'preliminary']).toContain(report.maturity)
    expect(report.relevantSchemes.length).toBeGreaterThan(0)
    expect(report.executiveSummary.keyStrengths.some((s) => /expansion|Location|resources|cows/i.test(s))).toBe(true)
  })

  it('3. application-ready report exposes application readiness distinctly from submission', () => {
    const profile = dairyExpansionProfile()
    const report = buildReportFor(profile)
    expect(report.applicationReadiness.applicationSubmitted).toBe(false)
    expect(['not_ready', 'gathering_information', 'ready_for_review', 'ready_for_application']).toContain(
      report.applicationReadiness.status,
    )
  })

  it('4. provenance preservation', () => {
    const report = buildReportFor(dairyExpansionProfile())
    expect(report.citizenSnapshot.state?.source).toBe('user_provided')
    expect(report.citizenSnapshot.state?.capturedAt).toBe('2026-01-01T00:00:00.000Z')
  })

  it('5. verified vs user-mentioned facts stay separated', () => {
    let applicant = createEmptyApplicantProfile()
    applicant = withApplicantField(applicant, 'state', 'Karnataka', { source: 'user_provided' })
    applicant = withApplicantField(applicant, 'socialCategory', 'sc', { source: 'government_verified', confidence: 'confirmed' })
    const readiness = assessReadiness({ userProfile: EMPTY_PROFILE, ranked: [], missingFields: [] })
    const report = buildPersonalizedReport({ applicantProfile: applicant, ranked: [], actionPlan: [], readiness, sourceStatus: null })
    expect(report.citizenSnapshot.state?.category).toBe('user_provided')
    expect(report.citizenSnapshot.socialCategory?.category).toBe('verified_government')
  })

  it('6. scheme match explanation is evidence-grounded', () => {
    const profile = dairyExpansionProfile()
    const ranked = rankedFor('pmegp', profile)
    const text = buildMatchExplanation(ranked, profile)
    expect(text).toMatch(/Karnataka/)
    expect(text).toMatch(/dairy/)
    expect(text.toLowerCase()).not.toMatch(/perfect for you/)
    expect(text.toLowerCase()).toMatch(/not an approval|not a final/)
  })

  it('7. scheme mismatch explanation', () => {
    const profile: UserProfile = {
      state: 'Karnataka',
      businessSector: 'dairy',
      socialCategory: 'general',
      annualIncome: 5_000_000,
      rawNotes: [],
    }
    const ranked = rankedFor('nsfdc-micro-finance', profile)
    const text = buildMatchExplanation(ranked, profile)
    if (ranked.eligibility.status === 'likely_ineligible') {
      expect(text.toLowerCase()).toMatch(/does not currently look like a fit|not a final/)
    }
    expect(text.toLowerCase()).not.toMatch(/you are approved/)
  })

  it('8. missing information explanation', () => {
    const report = buildReportFor({ businessSector: 'dairy', rawNotes: [] })
    expect(report.uncertainties.some((u) => u.kind === 'missing_information')).toBe(true)
    expect(report.risksAndUncertainties.some((m) => /income|not been provided/i.test(m))).toBe(true)
  })

  it('9. uncertainty handling for unknown financing', () => {
    const report = buildReportFor(
      { state: 'Karnataka', businessSector: 'dairy', rawNotes: [] },
      { userUncertainFields: ['financingRequired'] },
    )
    expect(report.financialPath.status).toBe('not_determined')
    expect(report.businessSnapshot.financingRequirement?.status).toBe('user_uncertain')
    expect(report.uncertainties.some((u) => u.kind === 'finance_uncertainty')).toBe(true)
    expect(report.executiveSummary.financingIntention).toBe('undetermined')
  })

  it('10. source coverage never claims all schemes were checked', () => {
    const report = buildReportFor(dairyExpansionProfile())
    expect(report.sourceCoverage.claimsAllGovernmentSchemesChecked).toBe(false)
    expect(report.sourceCoverage.candidateSchemeCount).toBe(report.sourceCoverage.totalSchemesConsidered)
  })

  it('11. source unavailable recorded', () => {
    const profile = dairyExpansionProfile()
    const ranked = [rankedFor('pmegp', profile)]
    const readiness = assessReadiness({ userProfile: profile, ranked, missingFields: [] })
    const report = buildPersonalizedReport({
      applicantProfile: applicantFrom(profile),
      userProfile: profile,
      ranked,
      actionPlan: [],
      readiness,
      sourceStatus: { status: 'live_unavailable', checkedAt: '2026-01-02T00:00:00.000Z' },
    })
    expect(report.uncertainties.some((u) => u.kind === 'source_unavailable')).toBe(true)
    expect(report.sourceCoverage.sourcesUnavailable).toContain('live:official_retrieval')
  })

  it('12/13. financial data reuses buildSchemePlan — no duplicated EMI math', () => {
    const profile = dairyExpansionProfile()
    const report = buildReportFor(profile)
    expect(report.financialPath.nsfdcPlan?.computedBy).toBe('src/lib/finance.ts#buildSchemePlan')
    const direct = buildSchemePlan(profile.ownContribution!)
    expect(report.financialPath.nsfdcPlan?.loanAmount).toBe(direct.loanAmount)
    expect(report.financialPath.nsfdcPlan?.quarterlyEmi).toBe(direct.quarterlyEmi)
    expect(report.financialPath.nsfdcPlan?.projectCost).toBe(direct.projectCost)
  })

  it('14. document readiness distinguishes required vs verified vs user-mentioned', () => {
    const report = buildReportFor(dairyExpansionProfile())
    for (const doc of report.documentReadiness) {
      expect(doc.required).toBe(true)
      expect(doc.knownToExist).toBe(false)
      expect(doc.verificationState).toBe('required')
      expect(doc.source).toBe('scheme_requirement')
    }
  })

  it('15. application readiness dimensions are present', () => {
    const report = buildReportFor(dairyExpansionProfile())
    const ids = report.applicationReadiness.dimensions.map((d) => d.id)
    expect(ids).toContain('profile_completeness')
    expect(ids).toContain('required_documents_verified')
    expect(report.applicationReadiness.dimensions.find((d) => d.id === 'required_documents_verified')?.met).toBe(false)
  })

  it('16. deterministic action plan comes from scheme application steps', () => {
    const profile = dairyExpansionProfile()
    const ranked = [rankedFor('pmegp', profile), rankedFor('nsfdc-micro-finance', profile)]
    const plan = buildActionPlan(ranked)
    const report = buildPersonalizedReport({
      applicantProfile: applicantFrom(profile),
      userProfile: profile,
      ranked,
      actionPlan: plan,
      readiness: assessReadiness({ userProfile: profile, ranked, missingFields: [] }),
      sourceStatus: null,
    })
    expect(report.recommendedNextSteps).toEqual(plan)
    for (const step of report.recommendedNextSteps) {
      expect(ranked.some((r) => r.scheme.id === step.schemeId)).toBe(true)
    }
  })

  it('17/18. business suitability boundary — no fabricated profitability', () => {
    const report = buildReportFor(dairyExpansionProfile())
    const s = report.opportunityAssessment.businessSuitability
    expect(s.claimsProfitability).toBe(false)
    expect(s.claimsGuaranteedDemand).toBe(false)
    expect(s.rationale.toLowerCase()).not.toMatch(/guaranteed demand|will succeed|expected profit/)
    expect([
      'information_insufficient',
      'promising_based_on_stated_resources',
      'requires_additional_validation',
      'financing_appears_aligned',
      'significant_unresolved_constraint',
    ]).toContain(s.kind)
  })

  it('19/20. no guaranteed approval or fabricated subsidy in structured fields', () => {
    const report = buildReportFor(dairyExpansionProfile())
    expect(report.opportunityAssessment.businessSuitability.claimsGuaranteedApproval).toBe(false)
    expect(report.opportunityAssessment.businessSuitability.claimsGuaranteedSubsidy).toBe(false)
    for (const scheme of report.relevantSchemes) {
      if (scheme.subsidyDescription) {
        expect(scheme.subsidyDescription).toBe(schemeById(scheme.schemeId).subsidy?.description)
      }
    }
  })

  it('21/22/23. guarded explanation rejects unsupported URL and amount, falls back safely', async () => {
    const profile = dairyExpansionProfile()
    const report = buildReportFor(profile)
    const ranked = [
      rankedFor('nsfdc-micro-finance', profile, 80),
      rankedFor('pmegp', profile, 70),
    ]
    const badProvider: ReportExplanationProvider = {
      id: 'hostile',
      explain: async () =>
        'You are approved! Apply at https://evil-scheme.example/apply for a guaranteed ₹99,99,999 subsidy profit.',
    }
    const { explanation, report: next } = await attachGuardedExplanation(report, {
      language: 'en',
      userProfile: profile,
      ranked,
      provider: badProvider,
    })
    expect(explanation.fellBack).toBe(true)
    expect(explanation.guardPassed).toBe(true)
    expect(explanation.text.toLowerCase()).not.toMatch(/you are approved|evil-scheme|99,99,999/)
    expect(next.opportunityAssessment.narrative).toBe(explanation.text)

    const context: AIRequestContext = {
      profile,
      message: '',
      history: [],
      missingFields: [],
      ranked,
      newlyUpdatedFields: [],
    }
    expect(validateProviderReply('Apply at https://evil-scheme.example/x', context).ok).toBe(false)
    expect(findUnapprovedAmounts('Need ₹99,99,999 tomorrow', context).length).toBeGreaterThan(0)
  })

  it('24. personalized explanation differs by applicant context (Scenario A vs B)', () => {
    const a = dairyExpansionProfile()
    const b = dairyGreenfieldProfile()
    const schemeA = rankedFor('pmegp', a)
    const schemeB = rankedFor('pmegp', b)
    const textA = buildMatchExplanation(schemeA, a)
    const textB = buildMatchExplanation(schemeB, b)
    expect(textA).toMatch(/Karnataka/)
    expect(textA).toMatch(/existing\/expansion|5 cows|resources/i)
    expect(textB).toMatch(/Kerala/)
    expect(textB).toMatch(/first-time\/new/)
    expect(textA).not.toEqual(textB)

    const reportA = buildReportFor(a)
    const reportB = buildReportFor(b)
    expect(reportA.businessSnapshot.expansionOrNew).toBe('expansion')
    expect(reportB.businessSnapshot.expansionOrNew).toBe('new')
    expect(reportA.executiveSummary.keyStrengths.join(' ')).not.toEqual(reportB.executiveSummary.keyStrengths.join(' '))
  })

  it('25. report snapshot immutability', () => {
    const report = buildReportFor(dairyExpansionProfile())
    expect(Object.isFrozen(report)).toBe(true)
    expect(Object.isFrozen(report.relevantSchemes)).toBe(true)
    const mutate = () => {
      ;(report as { version: number }).version = 999
    }
    expect(mutate).toThrow()
  })

  it('26. report refresh after profile change bumps version, keeps reportId', () => {
    const v1 = buildReportFor(dairyExpansionProfile())
    const changed: UserProfile = { ...dairyExpansionProfile(), businessSector: 'tailoring', landOrAssets: undefined }
    const v2 = buildReportFor(changed, { previous: { reportId: v1.reportId, version: v1.version } })
    expect(v2.reportId).toBe(v1.reportId)
    expect(v2.version).toBe(v1.version + 1)
    expect(v2.businessSnapshot.sector).toBe('tailoring')
    expect(v1.businessSnapshot.sector).toBe('dairy')
  })

  it('27/28/29. English, Kannada, and mixed explanations stay grounded', () => {
    const profile = dairyExpansionProfile()
    const report = buildReportFor(profile)
    const ranked = [rankedFor('pmegp', profile)]
    const en = composeOfflineReportExplanation({ analysis: report, language: 'en', userProfile: profile, ranked })
    const kn = composeOfflineReportExplanation({ analysis: report, language: 'kn', userProfile: profile, ranked })
    const mixed = composeOfflineReportExplanation({ analysis: report, language: 'mixed', userProfile: profile, ranked })
    expect(en).toMatch(/existing business expansion|dairy/i)
    expect(kn).toMatch(/ವ್ಯವಹಾರ|ಅನುಮೋದನೆ/)
    expect(mixed).toMatch(/analysis madidivi|dairy/i)
    expect(en.toLowerCase()).not.toMatch(/guaranteed approval/)
  })

  it('30/31/32. exploratory → preliminary → actionable → application_ready maturity path', () => {
    const exploratory = buildReportFor({ rawNotes: [] })
    expect(exploratory.maturity).toBe('exploratory')

    const preliminary = buildReportFor({ businessSector: 'dairy', rawNotes: [] })
    expect(['preliminary', 'actionable', 'exploratory']).toContain(preliminary.maturity)

    const richer = buildReportFor(dairyExpansionProfile())
    expect(['preliminary', 'actionable', 'application_ready']).toContain(richer.maturity)
  })

  it('33. evidence changes update report scheme entries', () => {
    const profile = dairyExpansionProfile()
    const local = rankedFor('pmegp', profile)
    const withLive: RankedScheme = {
      ...local,
      liveEvidence: [
        {
          schemeId: 'pmegp',
          sourceName: 'data.gov.in',
          sourceUrl: 'https://api.data.gov.in/resource/x',
          sourceType: 'official_open_data',
          verificationStatus: 'live_official',
          retrievedAt: '2026-01-03T00:00:00.000Z',
          summary: 'units sanctioned',
        },
      ],
    }
    const readiness = assessReadiness({ userProfile: profile, ranked: [withLive], missingFields: [] })
    const report = buildPersonalizedReport({
      applicantProfile: applicantFrom(profile),
      userProfile: profile,
      ranked: [withLive],
      actionPlan: [],
      readiness,
      sourceStatus: { status: 'live_official', checkedAt: '2026-01-03T00:00:00.000Z' },
    })
    expect(report.relevantSchemes[0].verificationStatus).toBe('live_official')
    expect(report.sourceCoverage.liveOfficialCount).toBe(1)
  })

  it('34. scheme ranking remains authoritative (order + rankScore preserved)', () => {
    const profile = dairyExpansionProfile()
    const ranked = [rankedFor('pmegp', profile, 95), rankedFor('nsfdc-micro-finance', profile, 40)]
    const readiness = assessReadiness({ userProfile: profile, ranked, missingFields: [] })
    const report = buildPersonalizedReport({
      applicantProfile: applicantFrom(profile),
      userProfile: profile,
      ranked,
      actionPlan: [],
      readiness,
      sourceStatus: null,
    })
    expect(report.relevantSchemes.map((s) => s.schemeId)).toEqual(['pmegp', 'nsfdc-micro-finance'])
    expect(report.relevantSchemes[0].rankScore).toBe(95)
    expect(report.comparativeView[0].rankScore).toBe(95)
  })

  it('35. LokScore, if referenced, is the existing implementation — never recomputed here', async () => {
    const { VILLAGES } = await import('../../data/villages')
    const { REACH_KM } = await import('../../lib/config')
    const { curatedLocationFromVillage } = await import('../../lib/resolveLocation')
    const profile = dairyExpansionProfile()
    const plan = buildSchemePlan(100_000)
    const location = curatedLocationFromVillage(VILLAGES[0], REACH_KM.default)
    const lok = computeLokScore({
      profile: {
        name: 'Lakshmi S.',
        age: 29,
        gender: 'female',
        community: 'sc',
        annualIncome: 180_000,
        experienceYears: 2,
        villageId: 'dinka-mandya',
        category: 'dairy',
        availableMargin: 100_000,
        locationMode: 'curated',
        radiusKm: REACH_KM.default,
      },
      location,
      weather: {
        tempMax: 31,
        tempMin: 22,
        precipProb: 30,
        precipMm: 1,
        code: 2,
        summary: 'Partly cloudy',
        summaryKn: 'ಭಾಗಶಃ ಮೋಡ',
        source: 'live',
      },
      mandi: null,
      plan,
    })
    const ranked = [rankedFor('nsfdc-micro-finance', profile)]
    const readiness = assessReadiness({ userProfile: profile, ranked, missingFields: [] })
    const report = buildPersonalizedReport({
      applicantProfile: applicantFrom(profile),
      userProfile: profile,
      ranked,
      actionPlan: [],
      readiness,
      sourceStatus: null,
      lokScore: lok,
    })
    expect(report.opportunityAssessment.lokScore).toBe(lok)
    expect(report.opportunityAssessment.lokScore?.total).toBe(lok.total)
    expect(report.opportunityAssessment.lokScore?.weights).toEqual(lok.weights)
  })

  it('Scenario C: sector change rebuilds dairy-specific conclusions away', () => {
    const dairy = buildReportFor(dairyExpansionProfile())
    const tailoring = buildReportFor({ ...dairyExpansionProfile(), businessSector: 'tailoring', landOrAssets: undefined })
    expect(dairy.businessSnapshot.sector).toBe('dairy')
    expect(tailoring.businessSnapshot.sector).toBe('tailoring')
    expect(tailoring.executiveSummary.keyStrengths.join(' ')).not.toMatch(/5 cows/)
  })

  it('Scenario D: unknown loan amount preserves finance uncertainty', () => {
    const report = buildReportFor(
      { state: 'Karnataka', businessSector: 'dairy', businessStage: 'new', rawNotes: [] },
      { userUncertainFields: ['financingRequired'] },
    )
    expect(report.financialPath.statedFinancingRequired).toBeUndefined()
    expect(report.financialPath.status).toBe('not_determined')
    expect(report.financialPath.notes.some((n) => /not yet determined|uncertainty/i.test(n))).toBe(true)
  })

  it('DeterministicAnalysis intermediate matches report structured fields', () => {
    const profile = dairyExpansionProfile()
    const ranked = [rankedFor('pmegp', profile)]
    const readiness = assessReadiness({ userProfile: profile, ranked, missingFields: [] })
    const analysis = buildDeterministicAnalysis({
      applicantProfile: applicantFrom(profile),
      userProfile: profile,
      ranked,
      actionPlan: [],
      readiness,
      sourceStatus: null,
      now: '2026-01-01T00:00:00.000Z',
    })
    expect(analysis.rankingAuthoritative).toBe(true)
    expect(analysis.schemeAnalyses[0].matchExplanation).toContain('Karnataka')
    expect(analysis.opportunityAssessment.narrative).toBeUndefined()
  })
})
