import { describe, expect, it } from 'vitest'
import { evaluateEligibility } from '../eligibility'
import { SCHEMES } from '../data/schemes'
import { createEmptyApplicantProfile, withApplicantField, type ApplicantProfile } from '../../shared/applicantProfile'
import { EMPTY_PROFILE, type RankedScheme, type UserProfile } from '../types'
import { assessReadiness } from './readiness'
import { buildPersonalizedReport } from './report'
import type { PersonalizedReport } from './reportModel'
import {
  deriveApprovalFinanceOverlay,
  projectDocumentsForApplication,
  projectReportForApplicationStart,
} from './applicationHandoff'

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

function applicantFrom(profile: UserProfile): ApplicantProfile {
  let a = createEmptyApplicantProfile()
  const stamp = { source: 'user_provided' as const, capturedAt: '2026-01-01T00:00:00.000Z' }
  if (profile.state) a = withApplicantField(a, 'state', profile.state, stamp)
  if (profile.businessSector) a = withApplicantField(a, 'businessSector', profile.businessSector, stamp)
  if (profile.socialCategory) a = withApplicantField(a, 'socialCategory', profile.socialCategory, stamp)
  if (profile.annualIncome !== undefined) a = withApplicantField(a, 'annualIncome', profile.annualIncome, stamp)
  return a
}

function buildReportFor(profile: UserProfile, ranked: RankedScheme[]): PersonalizedReport {
  const missingFields: never[] = []
  const readiness = assessReadiness({ userProfile: profile, ranked, missingFields })
  return buildPersonalizedReport({
    applicantProfile: applicantFrom(profile),
    userProfile: profile,
    ranked,
    actionPlan: [],
    readiness,
    sourceStatus: { status: 'verified_local', checkedAt: '2026-01-02T00:00:00.000Z' },
    now: '2026-01-02T00:00:00.000Z',
    reportId: 'fixed-id',
  })
}

describe('projectReportForApplicationStart', () => {
  it('returns null when there is no candidate scheme yet — never fabricates one', () => {
    const report = buildReportFor(EMPTY_PROFILE, [])
    const applicantProfile = applicantFrom(EMPTY_PROFILE)
    expect(projectReportForApplicationStart(report, applicantProfile)).toBeNull()
  })

  it('projects the top-ranked scheme by default, carrying eligibility + ranking through untouched', () => {
    const profile: UserProfile = {
      state: 'Karnataka',
      businessSector: 'dairy',
      socialCategory: 'sc',
      annualIncome: 150_000,
      rawNotes: [],
    }
    const ranked = [rankedFor('pmegp', profile, 80), rankedFor('nsfdc-micro-finance', profile, 60)]
    const report = buildReportFor(profile, ranked)
    const applicantProfile = applicantFrom(profile)

    const draft = projectReportForApplicationStart(report, applicantProfile)
    expect(draft).not.toBeNull()
    expect(draft!.schemeId).toBe(report.relevantSchemes[0].schemeId)
    expect(draft!.eligibilityStatus).toBe(report.relevantSchemes[0].eligibilityStatus)
    expect(draft!.recommendation).toBe(report.relevantSchemes[0].recommendation)
    expect(draft!.sourceReportId).toBe(report.reportId)
    expect(draft!.sourceReportVersion).toBe(report.version)
    expect(draft!.applicationSteps).toEqual(report.relevantSchemes[0].applicationSteps)
  })

  it('projects a specific scheme when named, not just the top-ranked one', () => {
    const profile: UserProfile = { state: 'Karnataka', businessSector: 'dairy', rawNotes: [] }
    const ranked = [rankedFor('pmegp', profile, 80), rankedFor('nsfdc-micro-finance', profile, 60)]
    const report = buildReportFor(profile, ranked)
    const draft = projectReportForApplicationStart(report, applicantFrom(profile), 'nsfdc-micro-finance')
    expect(draft?.schemeId).toBe('nsfdc-micro-finance')
  })

  it('returns null for a scheme id not present in this report', () => {
    const profile: UserProfile = { state: 'Karnataka', businessSector: 'dairy', rawNotes: [] }
    const ranked = [rankedFor('pmegp', profile, 80)]
    const report = buildReportFor(profile, ranked)
    expect(projectReportForApplicationStart(report, applicantFrom(profile), 'not-a-real-scheme')).toBeNull()
  })

  it('carries every known applicant field with its provenance intact — never flattened to a bare value', () => {
    const profile: UserProfile = { state: 'Karnataka', businessSector: 'dairy', socialCategory: 'sc', rawNotes: [] }
    const ranked = [rankedFor('pmegp', profile, 80)]
    const report = buildReportFor(profile, ranked)
    const applicantProfile = applicantFrom(profile)
    const draft = projectReportForApplicationStart(report, applicantProfile)!

    expect(draft.fields.state?.value).toBe('Karnataka')
    expect(draft.fields.state?.provenance?.source).toBe('user_provided')
    expect(draft.fields.socialCategory?.value).toBe('sc')
    // Never invents a field the applicant profile doesn't actually have.
    expect(draft.fields.annualIncome).toBeUndefined()
  })
})

describe('projectDocumentsForApplication', () => {
  it('produces one drafted document per required document, all declared "missing" — never "declared_available" without evidence', () => {
    const profile: UserProfile = {
      state: 'Karnataka',
      businessSector: 'dairy',
      socialCategory: 'sc',
      annualIncome: 150_000,
      rawNotes: [],
    }
    const ranked = [rankedFor('pmegp', profile, 80)]
    const report = buildReportFor(profile, ranked)
    const drafts = projectDocumentsForApplication(report, 'pmegp')

    expect(drafts.length).toBeGreaterThan(0)
    for (const d of drafts) {
      expect(d.declaration).toBe('missing')
      expect(d.schemeId).toBe('pmegp')
      expect(d.docKey).toMatch(/^[a-z0-9_]+$/)
    }
  })

  it('falls back to the scheme\'s own document list when documentReadiness has no entries for it', () => {
    const profile: UserProfile = { state: 'Karnataka', businessSector: 'dairy', rawNotes: [] } // thin — likely insufficient_data
    const ranked = [rankedFor('pmegp', profile, 80)]
    const report = buildReportFor(profile, ranked)
    const drafts = projectDocumentsForApplication(report, 'pmegp')
    const expectedLabels = schemeById('pmegp').documents
    expect(drafts.map((d) => d.label)).toEqual(expectedLabels)
  })

  it('never duplicates a document key for the same scheme', () => {
    const profile: UserProfile = { state: 'Karnataka', businessSector: 'dairy', rawNotes: [] }
    const ranked = [rankedFor('pmegp', profile, 80)]
    const report = buildReportFor(profile, ranked)
    const drafts = projectDocumentsForApplication(report, 'pmegp')
    const keys = drafts.map((d) => d.docKey)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('returns an empty list for a scheme this report never ranked', () => {
    const profile: UserProfile = { state: 'Karnataka', businessSector: 'dairy', rawNotes: [] }
    const report = buildReportFor(profile, [rankedFor('pmegp', profile, 80)])
    expect(projectDocumentsForApplication(report, 'nsfdc-micro-finance')).toEqual([])
  })
})

describe('deriveApprovalFinanceOverlay', () => {
  it('is always honestly unavailable today — never fabricates a LokScore for an AI-originated application', () => {
    const profile: UserProfile = { state: 'Karnataka', businessSector: 'dairy', rawNotes: [] }
    const report = buildReportFor(profile, [rankedFor('pmegp', profile, 80)])
    const overlay = deriveApprovalFinanceOverlay(report)
    expect(overlay.available).toBe(false)
    expect(overlay.reason).toMatch(/LokScore/)
    expect(overlay.reason.toLowerCase()).not.toMatch(/estimated|approx|guessed/)
  })
})
