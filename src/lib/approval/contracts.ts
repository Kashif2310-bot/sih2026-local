import { solidityPackedKeccak256 } from 'ethers'
import type { LokScoreBreakdown } from '../lokScore'

/**
 * Approval-layer contracts.
 *
 * Application ownership is Adita's. This module only *consumes* an
 * applicationId and a frozen snapshot — it does not define Application
 * lifecycle, payload authorship, or status machines.
 */

export type ReviewerRole =
  | 'sca_officer'
  | 'bank_channel'
  | 'mentor'
  | 'nsfdc_nodal'
  | 'shg_lead'

export interface ApplicationSnapshot {
  /** External id from Adita's Application layer. */
  applicationId: string
  /** Applicant display/reference only — not documents or KYC payloads. */
  applicantRef: string
  villageId: string
  schemeId: string
  projectCost: number
  loanAmount: number
  lokScore: LokScoreBreakdown
  frozenAt: number
}

export interface QuorumPolicy {
  quorumRequired: number
  quorumPool: number
  mentorRequired: boolean
  derivedFromScore: number
}

export interface AuthorizedReviewer {
  id: string
  address: string
  role: ReviewerRole
  department: string
  departmentKn?: string
  authorized: boolean
  jurisdiction?: string
  displayName?: string
  displayNameKn?: string
}

export interface ReviewerAllocation {
  applicationId: string
  allocatedReviewerIds: string[]
  allocatedAddresses: string[]
  quorumPool: number
  mentorRequired: boolean
  mentorReviewerIds: string[]
  allocationDigest: string
  allocatedAt: number
}

export interface ApprovalSignature {
  reviewerId: string
  address: string
  signature: string
  signedAt: number
}

export type ApprovalStatus = 'open' | 'collecting' | 'quorum_met' | 'authorized' | 'blocked'

export interface ApprovalCase {
  applicationId: string
  snapshot: ApplicationSnapshot
  snapshotDigest: string
  policy: QuorumPolicy
  allocation: ReviewerAllocation
  signatures: ApprovalSignature[]
  status: ApprovalStatus
}

export type AuditEventType =
  | 'application_opened'
  | 'reviewer_allocation_created'
  | 'signature_requested'
  | 'signature_collected'
  | 'signature_rejected'
  | 'quorum_evaluated'
  | 'mentor_condition_evaluated'
  | 'quorum_reached'
  | 'disbursement_authorized'
  | 'disbursement_blocked'

export interface AuditEvent {
  eventId: string
  applicationId: string
  eventType: AuditEventType
  timestamp: number
  actorRef?: string
  dataRef?: string
  prevEventHash: string | null
  eventHash: string
}

export interface DisbursementAuthorization {
  applicationId: string
  applicationHash: string
  quorumRequired: number
  quorumPool: number
  mentorRequired: boolean
  acceptedSignerRefs: string[]
  authorizedAt: number
  auditHeadHash: string
  authorizationDigest: string
  /** Adita SHA-256 bound into authorization evidence when present. */
  sourceSnapshotHash: string | null
  /** Infrastructure is simulated; crypto is real. */
  simulated: true
}

export interface ApprovalPayload {
  applicationId: string
  applicantRef: string
  villageId: string
  schemeId: string
  projectCost: number
  loanAmount: number
  demand: number
  competitionGap: number
  weatherFit: number
  financialFit: number
  eligibility: number
  lokScoreTotal: number
  quorumRequired: number
  quorumPool: number
  mentorRequired: boolean
  frozenAt: number
}

/** Canonical packed digest for the frozen approval decision. */
export function hashApprovalPayload(p: ApprovalPayload): string {
  return solidityPackedKeccak256(
    [
      'string',
      'string',
      'string',
      'string',
      'uint256',
      'uint256',
      'uint256',
      'uint256',
      'uint256',
      'uint256',
      'uint256',
      'uint256',
      'uint256',
      'uint256',
      'uint8',
      'uint256',
    ],
    [
      p.applicationId,
      p.applicantRef,
      p.villageId,
      p.schemeId,
      p.projectCost,
      p.loanAmount,
      p.demand,
      p.competitionGap,
      p.weatherFit,
      p.financialFit,
      p.eligibility,
      p.lokScoreTotal,
      p.quorumRequired,
      p.quorumPool,
      p.mentorRequired ? 1 : 0,
      p.frozenAt,
    ],
  )
}

export function payloadFromSnapshot(snapshot: ApplicationSnapshot): ApprovalPayload {
  const s = snapshot.lokScore
  return {
    applicationId: snapshot.applicationId,
    applicantRef: snapshot.applicantRef,
    villageId: snapshot.villageId,
    schemeId: snapshot.schemeId,
    projectCost: snapshot.projectCost,
    loanAmount: snapshot.loanAmount,
    demand: s.demand,
    competitionGap: s.competitionGap,
    weatherFit: s.weatherFit,
    financialFit: s.financialFit,
    eligibility: s.eligibility,
    lokScoreTotal: s.total,
    quorumRequired: s.quorumRequired,
    quorumPool: s.quorumPool,
    mentorRequired: s.mentorRequired,
    frozenAt: snapshot.frozenAt,
  }
}

export function hashApplicationSnapshot(snapshot: ApplicationSnapshot): string {
  return hashApprovalPayload(payloadFromSnapshot(snapshot))
}

/**
 * Session adapter used only until Adita's Application layer supplies
 * applicationId. This is not an Application entity.
 */
export const PROVISIONAL_APPLICATION_ID_PREFIX = 'provisional:'

export function provisionalApplicationId(input: {
  applicantRef: string
  villageId: string
  schemeId: string
  frozenAt: number
}): string {
  const digest = solidityPackedKeccak256(
    ['string', 'string', 'string', 'string', 'uint256'],
    [
      'lokpulse.provisionalApplicationId.v1',
      input.applicantRef,
      input.villageId,
      input.schemeId,
      input.frozenAt,
    ],
  )
  return `${PROVISIONAL_APPLICATION_ID_PREFIX}${digest.slice(2, 18)}`
}
