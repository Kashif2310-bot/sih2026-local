import { freezeSnapshot, verifySnapshot, type FrozenSnapshot } from '../../apply/application'
import type { ChannelConfig } from '../../apply/channels'
import type { ConsentRecord, FilingChannel, FilingOutcome } from '../../apply/types'
import { submitApplication } from '../../apply/workflow'
import type { EligibilityStatus, UserProfile } from '../../assistant/types'
import { MINISTRIES, routeApplication } from '../../platform/ministries'
import type { CriteriaReport } from './criteria'
import type { ApplicantDetails } from './extraction'
import type { FeasibilityReport, FeasibilityState } from './feasibility'
import type { ApplicationForm } from './requirements'

export type AdminStatus = 'submitted' | 'under_review' | 'approved' | 'rejected' | 'needs_correction'

export const ADMIN_STATUS_LABEL: Record<AdminStatus, string> = {
  submitted: 'Submitted',
  under_review: 'Under review',
  approved: 'Approved',
  rejected: 'Rejected',
  needs_correction: 'Needs correction',
}

export interface AuditEntry {
  at: string
  actor: 'applicant' | 'admin' | 'system'
  action: string
  note: string
}

export interface MatchAtSubmission {
  schemeId: string
  matchPercent: number
  eligibilityStatus: EligibilityStatus
  eligibilityScore: number
  rank: number
  basis: ApplicationForm['basis']
}

/** What the admin receives. Both snapshots are frozen at submission and never recomputed. */
export interface SubmittedApplication {
  version: 1
  applicationId: string
  trackingId: string
  submittedAt: string
  schemeId: string
  schemeName: string
  channel: FilingChannel
  outcome: FilingOutcome
  honestLabel: string
  filedWithGovernment: boolean
  applicantName: string
  consent: ConsentRecord
  /** Main's workflow snapshot: the application form fields, documents and consent text. */
  applicationSnapshot: FrozenSnapshot
  /** The two reports, sealed with the application snapshot's hash so they cannot drift apart. */
  reportSnapshot: FrozenSnapshot
  status: AdminStatus
  auditTrail: AuditEntry[]
}

export interface ReportSnapshotPayload {
  applicationId: string
  applicationSnapshotHash: string
  schemeId: string
  schemeName: string
  implementingMinistry: string
  match: MatchAtSubmission
  form: {
    fields: Array<{ key: string; label: string; group: string; required: boolean; display: string | null; status: string; note?: string }>
    documents: Array<{ key: string; label: string; required: boolean; declaration: string; status: string }>
    readiness: { fieldsDone: number; fieldsTotal: number; documentsDone: number; documentsTotal: number; percent: number }
  }
  criteriaReport: CriteriaReport
  feasibility: { status: 'ready'; report: FeasibilityReport } | { status: 'unavailable'; reason: string }
  routing: {
    leadMinistry: string
    supportingMinistries: string[]
    rationale: string[]
  } | null
  applicant: { profile: Omit<UserProfile, 'rawNotes'>; details: ApplicantDetails }
}

export type SubmitOutcome =
  | { ok: true; application: SubmittedApplication }
  | { ok: false; reason: string }

function feasibilityForSnapshot(state: FeasibilityState): ReportSnapshotPayload['feasibility'] {
  switch (state.status) {
    case 'ready':
      return { status: 'ready', report: state.report }
    case 'waiting':
      return { status: 'unavailable', reason: `Not computed: still needed ${state.missing.map((m) => m.label.toLowerCase()).join(', ')}.` }
    case 'computing':
      return { status: 'unavailable', reason: 'Not computed: the feasibility check had not finished at submission.' }
    default:
      return { status: 'unavailable', reason: state.reason }
  }
}

/**
 * Submits through the main prototype's workflow (explicit consent, validation,
 * channel adapter, frozen snapshot), then seals the government criteria report
 * and the LokScore report in a second snapshot that carries the first one's
 * hash. Nothing is filed with a government system: the channel adapters only
 * prepare the package and route it into the Ishaara review workflow.
 */
export async function submitToIshaara(input: {
  form: ApplicationForm
  criteria: CriteriaReport
  feasibility: FeasibilityState
  match: MatchAtSubmission
  profile: UserProfile
  details: ApplicantDetails
  implementingMinistry: string
  consentAccepted: boolean
  config?: ChannelConfig
}): Promise<SubmitOutcome> {
  const { form } = input
  if (!input.consentAccepted) return { ok: false, reason: 'Please read the consent statement and tick the box to submit.' }
  if (!form.readiness.canSubmit || !form.prepared.packet) {
    const first = form.readiness.blocking[0]
    return { ok: false, reason: first ? first.message : 'The application is not complete yet.' }
  }

  const { rawNotes: _rawNotes, ...profile } = input.profile
  const tracked = await submitApplication({
    prepared: form.prepared,
    channel: form.channel,
    consentAccepted: true,
    simulate: false,
    config: input.config,
    conversation: { source: 'assistant', extractedProfile: { ...profile, ...input.details }, citedScheme: form.schemeId },
  })
  if (!tracked.snapshot || tracked.outcome === 'blocked_by_validation' || tracked.outcome === 'consent_required') {
    return { ok: false, reason: tracked.detail || tracked.honestLabel }
  }

  const feasibility = feasibilityForSnapshot(input.feasibility)
  const report = feasibility.status === 'ready' ? feasibility.report : null
  const routing = report
    ? routeApplication({ category: report.inputs.category, gender: report.inputs.gender, community: report.inputs.community })
    : null

  const payload: ReportSnapshotPayload = {
    applicationId: tracked.applicationId,
    applicationSnapshotHash: tracked.snapshot.snapshotHash,
    schemeId: form.schemeId,
    schemeName: form.schemeName,
    implementingMinistry: input.implementingMinistry,
    match: input.match,
    form: {
      fields: form.fields.map(({ key, label, group, required, display, status, note }) => ({ key, label, group, required, display, status, ...(note ? { note } : {}) })),
      documents: form.documents.map(({ key, label, required, declaration, status }) => ({ key, label, required, declaration, status })),
      readiness: {
        fieldsDone: form.readiness.fieldsDone,
        fieldsTotal: form.readiness.fieldsTotal,
        documentsDone: form.readiness.documentsDone,
        documentsTotal: form.readiness.documentsTotal,
        percent: form.readiness.percent,
      },
    },
    criteriaReport: input.criteria,
    feasibility,
    routing: routing
      ? {
          leadMinistry: MINISTRIES[routing.leadMinistryId].name,
          supportingMinistries: routing.supportingMinistryIds.map((id) => MINISTRIES[id].name),
          rationale: routing.rationaleEn,
        }
      : null,
    applicant: { profile, details: input.details },
  }
  const reportSnapshot = await freezeSnapshot(payload as unknown as Record<string, unknown>, tracked.createdAt)

  return {
    ok: true,
    application: {
      version: 1,
      applicationId: tracked.applicationId,
      trackingId: tracked.trackingId,
      submittedAt: tracked.createdAt,
      schemeId: form.schemeId,
      schemeName: form.schemeName,
      channel: tracked.channel,
      outcome: tracked.outcome,
      honestLabel: tracked.honestLabel,
      filedWithGovernment: tracked.filedWithGovernment,
      applicantName: input.details.applicantName ?? '',
      consent: tracked.consent,
      applicationSnapshot: tracked.snapshot,
      reportSnapshot,
      status: 'submitted',
      auditTrail: [
        ...tracked.statusHistory.map((entry) => ({ at: entry.at, actor: 'system' as const, action: entry.step, note: entry.note })),
        { at: tracked.createdAt, actor: 'applicant', action: 'submitted', note: 'Applicant reviewed the form, gave consent and submitted it to Ishaara.' },
      ],
    },
  }
}

export interface IntegrityCheck {
  applicationSnapshotValid: boolean
  reportSnapshotValid: boolean
  reportsBoundToApplication: boolean
}

/** The admin re-hashes both snapshots on open; any edit after submission shows up here. */
export async function checkIntegrity(application: SubmittedApplication): Promise<IntegrityCheck> {
  const [applicationSnapshotValid, reportSnapshotValid] = await Promise.all([
    verifySnapshot(application.applicationSnapshot),
    verifySnapshot(application.reportSnapshot),
  ])
  const payload = application.reportSnapshot.payload as unknown as ReportSnapshotPayload
  return {
    applicationSnapshotValid,
    reportSnapshotValid,
    reportsBoundToApplication:
      payload.applicationSnapshotHash === application.applicationSnapshot.snapshotHash &&
      payload.applicationId === application.applicationId &&
      application.applicationSnapshot.payload.applicationId === application.applicationId,
  }
}
