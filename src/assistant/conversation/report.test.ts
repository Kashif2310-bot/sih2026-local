import { describe, expect, it } from 'vitest'
import { evaluateEligibility } from '../eligibility'
import { SCHEMES } from '../data/schemes'
import { EMPTY_PROFILE, type RankedScheme, type UserProfile } from '../types'
import { createEmptyApplicantProfile, withApplicantField, withApplicantFields } from '../../shared/applicantProfile'
import { assessReadiness } from './readiness'
import { buildPersonalizedReport } from './report'

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

describe('buildPersonalizedReport', () => {
  it('assembles every section from existing deterministic data, with no LLM call and no invented facts', () => {
    let applicant = createEmptyApplicantProfile()
    applicant = withApplicantField(applicant, 'businessSector', 'dairy', { source: 'user_provided', capturedAt: '2026-01-01T00:00:00.000Z' })
    applicant = withApplicantField(applicant, 'state', 'Karnataka', { source: 'user_provided', capturedAt: '2026-01-01T00:00:00.000Z' })

    const profile: UserProfile = { businessSector: 'dairy', state: 'Karnataka', socialCategory: 'sc', annualIncome: 150_000, rawNotes: [] }
    const ranked = [rankedFor('nsfdc-micro-finance', profile), rankedFor('pmegp', profile)]
    const readiness = assessReadiness({ userProfile: profile, ranked, missingFields: [] })

    const report = buildPersonalizedReport({
      applicantProfile: applicant,
      userProfile: profile,
      ranked,
      actionPlan: [],
      readiness,
      sourceStatus: { status: 'verified_local', checkedAt: '2026-01-01T00:10:00.000Z' },
      now: '2026-01-01T00:10:00.000Z',
      reportId: 'test-report-1',
    })

    expect(report.generatedAt).toBe('2026-01-01T00:10:00.000Z')
    expect(report.citizenSnapshot.businessSector).toEqual({
      value: 'dairy',
      source: 'user_provided',
      confidence: undefined,
      capturedAt: '2026-01-01T00:00:00.000Z',
      category: 'user_provided',
    })
    expect(report.businessIdea.sector).toBe('dairy')
    expect(report.businessContext.location?.state).toBe('Karnataka')
    expect(report.relevantSchemes).toHaveLength(2)
    expect(report.relevantSchemes[0].schemeId).toBe('nsfdc-micro-finance')
    expect(report.relevantSchemes[0].matchReasons.length).toBeGreaterThan(0)
    expect(report.verification).toEqual({ checkedAt: '2026-01-01T00:10:00.000Z', sourceStatus: 'verified_local' })
    expect(report.readiness).toBe(readiness)
    expect(report.opportunityAssessment.narrative).toBeUndefined()
    expect(report.executiveSummary.overallReadiness).toBe(readiness.status)
    expect(report.version).toBe(1)
    expect(Object.isFrozen(report)).toBe(true)
  })

  it('never mentions a scheme not present in the ranked evidence', () => {
    const applicant = createEmptyApplicantProfile()
    const profile: UserProfile = { businessSector: 'dairy', rawNotes: [] }
    const ranked = [rankedFor('pmegp', profile)]
    const readiness = assessReadiness({ userProfile: profile, ranked, missingFields: [] })
    const report = buildPersonalizedReport({ applicantProfile: applicant, userProfile: profile, ranked, actionPlan: [], readiness, sourceStatus: null })
    expect(report.relevantSchemes.map((s) => s.schemeId)).toEqual(['pmegp'])
    const allSchemeIds = SCHEMES.map((s) => s.id)
    for (const id of allSchemeIds) {
      if (id === 'pmegp') continue
      expect(report.relevantSchemes.some((s) => s.schemeId === id)).toBe(false)
    }
  })

  it('correctly separates verified-local from live-official scheme entries in source coverage', () => {
    const applicant = createEmptyApplicantProfile()
    const profile: UserProfile = { businessSector: 'dairy', rawNotes: [] }
    const withLiveEvidence: RankedScheme = {
      ...rankedFor('pmegp', profile),
      liveEvidence: [
        {
          schemeId: 'pmegp',
          sourceName: 'data.gov.in',
          sourceUrl: 'https://api.data.gov.in/resource/abc',
          sourceType: 'official_open_data',
          verificationStatus: 'live_official',
          retrievedAt: '2026-01-01T00:00:00.000Z',
          summary: '1,000 units sanctioned',
        },
      ],
    }
    const withoutLiveEvidence = rankedFor('nsfdc-micro-finance', profile)
    const ranked = [withLiveEvidence, withoutLiveEvidence]
    const readiness = assessReadiness({ userProfile: profile, ranked, missingFields: [] })
    const report = buildPersonalizedReport({ applicantProfile: applicant, userProfile: profile, ranked, actionPlan: [], readiness, sourceStatus: null })

    expect(report.sourceCoverage).toMatchObject({ verifiedLocalCount: 1, liveOfficialCount: 1, totalSchemesConsidered: 2 })
    expect(report.sourceCoverage.claimsAllGovernmentSchemesChecked).toBe(false)
    expect(report.relevantSchemes.find((s) => s.schemeId === 'pmegp')?.liveEvidence).toHaveLength(1)
    expect(report.relevantSchemes.find((s) => s.schemeId === 'nsfdc-micro-finance')?.liveEvidence).toEqual([])
  })

  it('an entirely empty profile produces an empty, honest report rather than throwing or guessing', () => {
    const applicant = createEmptyApplicantProfile()
    const readiness = assessReadiness({ userProfile: EMPTY_PROFILE, ranked: [], missingFields: [] })
    const report = buildPersonalizedReport({ applicantProfile: applicant, userProfile: EMPTY_PROFILE, ranked: [], actionPlan: [], readiness, sourceStatus: null })
    expect(report.citizenSnapshot).toEqual({})
    expect(report.relevantSchemes).toEqual([])
    expect(report.documentsNeeded).toEqual([])
    expect(report.readiness.status).toBe('exploratory')
    expect(report.maturity).toBe('exploratory')
    expect(report.financialPath.status).toBe('not_determined')
  })

  it('preserves provenance categories and never marks a profile field as verified government without that source', () => {
    let applicant = createEmptyApplicantProfile()
    applicant = withApplicantFields(
      applicant,
      {
        state: 'Karnataka',
        annualIncome: 120_000,
      },
      { source: 'user_provided', capturedAt: '2026-01-01T00:00:00.000Z' },
    )
    const readiness = assessReadiness({ userProfile: EMPTY_PROFILE, ranked: [], missingFields: [] })
    const report = buildPersonalizedReport({
      applicantProfile: applicant,
      ranked: [],
      actionPlan: [],
      readiness,
      sourceStatus: null,
    })
    expect(report.citizenSnapshot.state?.category).toBe('user_provided')
    expect(report.citizenSnapshot.annualIncome?.source).toBe('user_provided')
    expect(report.citizenSnapshot.annualIncome?.category).not.toBe('verified_government')
  })
})
