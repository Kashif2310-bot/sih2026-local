import { describe, expect, it } from 'vitest'
import { SCHEMES } from '../../assistant/data/schemes'
import type { UserProfile } from '../../assistant/types'
import { buildCriteriaReport } from './criteria'
import { DOCUMENT_KIND_LABEL, type DocumentDeclarations } from './documents'
import type { ApplicantDetails } from './extraction'
import { buildApplicationForm } from './requirements'
import { checkIntegrity, submitToIshaara, type ReportSnapshotPayload, type SubmittedApplication } from './submission'

const PROFILE: UserProfile = {
  rawNotes: ['free text the citizen said'],
  state: 'Karnataka',
  district: 'Mandya',
  areaType: 'rural',
  age: 32,
  gender: 'female',
  socialCategory: 'sc',
  annualIncome: 180_000,
  businessSector: 'dairy',
  businessStage: 'new',
  financingRequired: 500_000,
}
const DETAILS: ApplicantDetails = { applicantName: 'Lakshmi Devi', mobile: '9845012345' }
const DOCS = Object.fromEntries(Object.keys(DOCUMENT_KIND_LABEL).map((kind) => [kind, 'declared_available'])) as DocumentDeclarations
const SCHEME = SCHEMES.find((s) => s.id === 'pm-mudra-yojana')!

function input(overrides: { documents?: DocumentDeclarations; consent?: boolean } = {}) {
  const form = buildApplicationForm({ schemeId: SCHEME.id, basis: 'top_match', profile: PROFILE, details: DETAILS, documents: overrides.documents ?? DOCS })
  return {
    form,
    criteria: buildCriteriaReport(PROFILE, SCHEME),
    feasibility: { status: 'waiting' as const, missing: [{ key: 'experience_years' as const, label: 'Experience', question: '' }] },
    match: { schemeId: SCHEME.id, matchPercent: 81, eligibilityStatus: 'likely_eligible' as const, eligibilityScore: 88, rank: 1, basis: 'top_match' as const },
    profile: PROFILE,
    details: DETAILS,
    implementingMinistry: SCHEME.ministry,
    consentAccepted: overrides.consent ?? true,
  }
}

async function submitted(): Promise<SubmittedApplication> {
  const outcome = await submitToIshaara(input())
  if (!outcome.ok) throw new Error(outcome.reason)
  return outcome.application
}

describe('one submission package to the Ishaara admin', () => {
  it('holds the application form, the criteria report and the LokScore status, never filed with government', async () => {
    const app = await submitted()
    expect(app.filedWithGovernment).toBe(false)
    expect(app.status).toBe('submitted')
    expect(app.applicantName).toBe('Lakshmi Devi')
    expect(app.consent.accepted).toBe(true)

    const payload = app.reportSnapshot.payload as unknown as ReportSnapshotPayload
    expect(payload.applicationSnapshotHash).toBe(app.applicationSnapshot.snapshotHash)
    expect(payload.form.readiness.percent).toBe(100)
    expect(payload.criteriaReport.schemeId).toBe(SCHEME.id)
    expect(payload.feasibility).toEqual({ status: 'unavailable', reason: 'Not computed: still needed experience.' })
    expect(payload.match.matchPercent).toBe(81)
    expect('rawNotes' in payload.applicant.profile).toBe(false)
    expect(app.applicationSnapshot.payload.fields).toMatchObject({ applicant_name: 'Lakshmi Devi', loan_amount_requested: 500_000 })
  })

  it('refuses without consent or with an incomplete form', async () => {
    expect(await submitToIshaara(input({ consent: false }))).toMatchObject({ ok: false })
    expect(await submitToIshaara(input({ documents: {} }))).toMatchObject({ ok: false })
  })

  it('integrity holds for an untouched package', async () => {
    expect(await checkIntegrity(await submitted())).toEqual({ applicationSnapshotValid: true, reportSnapshotValid: true, reportsBoundToApplication: true })
  })

  it('detects an edited form, an edited report, and a report taken from another application', async () => {
    const app = await submitted()
    const clone = () => JSON.parse(JSON.stringify(app)) as SubmittedApplication

    const editedForm = clone()
    ;(editedForm.applicationSnapshot.payload.fields as Record<string, unknown>).loan_amount_requested = 900_000
    expect((await checkIntegrity(editedForm)).applicationSnapshotValid).toBe(false)

    const editedReport = clone()
    ;(editedReport.reportSnapshot.payload as unknown as ReportSnapshotPayload).criteriaReport.counts.not_met = 0
    ;(editedReport.reportSnapshot.payload as unknown as ReportSnapshotPayload).match.matchPercent = 99
    expect((await checkIntegrity(editedReport)).reportSnapshotValid).toBe(false)

    const other = await submitted()
    const swapped = clone()
    swapped.reportSnapshot = other.reportSnapshot
    const check = await checkIntegrity(swapped)
    expect(check.reportSnapshotValid).toBe(true)
    expect(check.reportsBoundToApplication).toBe(false)
  })
})
