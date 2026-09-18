/**
 * Thin adapter between Prerna's Application records and Jordan's approval
 * service. UI code should call these helpers — never `src/lib/multisig`.
 */
import { LOKSCORE_WEIGHTS } from '../lib/config'
import { createApprovalService, ApprovalError, type ApprovalService } from '../lib/approval/service'
import { expectedQuorumFromTotal } from '../lib/approval/quorum'
import type { ApplicationSnapshot } from '../lib/approval/contracts'
import type { ApprovalCaseView } from '../lib/approval/views'
import type { LokScoreBreakdown } from '../lib/lokScore'
import { appendAudit, setStatus } from './store'
import type { Application, ApplicationStatus } from './types'

let service: ApprovalService | null = null

export function getApprovalService(): ApprovalService {
  if (!service) service = createApprovalService()
  return service
}

/** Test-only: drop the singleton so cases do not leak across specs. */
export function resetApprovalService() {
  service = createApprovalService()
}

export function lokScoreForApproval(app: Application): LokScoreBreakdown {
  if (app.lokScoreBreakdown) return app.lokScoreBreakdown
  const quorum = expectedQuorumFromTotal(app.lokScore)
  const grade: LokScoreBreakdown['grade'] =
    app.lokScore >= 80 ? 'A' : app.lokScore >= 65 ? 'B' : app.lokScore >= 50 ? 'C' : 'D'
  return {
    demand: 0,
    competitionGap: 0,
    weatherFit: 0,
    financialFit: 0,
    eligibility: 0,
    total: app.lokScore,
    grade,
    quorumRequired: app.quorumRequired || quorum.quorumRequired,
    quorumPool: app.quorumPool || quorum.quorumPool,
    mentorRequired: app.mentorRequired || quorum.mentorRequired,
    rationale: [],
    rationaleKn: [],
    weights: LOKSCORE_WEIGHTS,
  }
}

export function snapshotFromApplication(app: Application): ApplicationSnapshot {
  const lokScore = lokScoreForApproval(app)
  const expected = expectedQuorumFromTotal(lokScore.total)
  // Jordan's service fails closed if quorum fields disagree with the 80/60 table.
  const aligned: LokScoreBreakdown = {
    ...lokScore,
    quorumRequired: expected.quorumRequired,
    quorumPool: expected.quorumPool,
    mentorRequired: expected.mentorRequired,
  }
  return {
    applicationId: app.id,
    applicantRef: app.applicant.name,
    villageId: app.applicant.villageOrTown || 'unknown',
    schemeId: app.schemeId,
    projectCost: app.projectCost,
    loanAmount: app.loanAmount,
    lokScore: aligned,
    frozenAt: app.createdAt,
  }
}

export function peekApprovalCase(applicationId: string): ApprovalCaseView | null {
  const svc = getApprovalService()
  if (!svc.hasApprovalCase(applicationId)) return null
  return svc.getApprovalCase(applicationId)
}

export function listOpenApprovalViews(): ApprovalCaseView[] {
  const svc = getApprovalService()
  return svc.listApplicationIds().map((id) => svc.getApprovalCase(id))
}

export type AditaSourceEvidence = {
  sourceSnapshotHash: string
  sourcePayload: Record<string, unknown>
  filedWithGovernment: boolean
}

export function ensureApprovalCase(app: Application, source?: AditaSourceEvidence): ApprovalCaseView {
  const svc = getApprovalService()
  if (svc.hasApprovalCase(app.id)) return svc.getApprovalCase(app.id)
  return svc.openApprovalCase(snapshotFromApplication(app), source)
}

function statusFromApproval(view: ApprovalCaseView): ApplicationStatus | null {
  if (view.status === 'authorized' || view.disbursementAuthorized) return 'disbursed'
  if (view.status === 'quorum_met' || view.quorumMet) return 'approved'
  if (view.status === 'collecting' || view.status === 'open') return 'reviewer_assigned'
  return null
}

export function syncApplicationFromApproval(view: ApprovalCaseView, actor: string) {
  const next = statusFromApproval(view)
  if (!next) return
  appendAudit(view.applicationId, {
    actor,
    action: `approval:${view.status}`,
    detail: `${view.validSignatures}/${view.quorum.required} valid signatures · hash ${view.applicationHash.slice(0, 18)}…`,
  })
  setStatus(view.applicationId, next, actor, `Jordan approval service → ${view.status}`)
}

export async function submitApprovalSignature(
  app: Application,
  reviewerId: string,
  actor: string,
): Promise<ApprovalCaseView> {
  const svc = getApprovalService()
  ensureApprovalCase(app)
  const view = await svc.submitSignature(app.id, reviewerId)
  syncApplicationFromApproval(view, actor)
  return view
}

export function authorizeApprovalDisbursement(app: Application, actor: string): ApprovalCaseView {
  const svc = getApprovalService()
  ensureApprovalCase(app)
  svc.authorizeDisbursement(app.id)
  const view = svc.getApprovalCase(app.id)
  syncApplicationFromApproval(view, actor)
  return view
}

export { ApprovalError }
