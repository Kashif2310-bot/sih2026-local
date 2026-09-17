/**
 * Read-only projections of approval state for consumers (admin UI, /sanction).
 *
 * These types deliberately contain no cryptographic implementation objects:
 * no ethers `Wallet`, no `Verifier`, no `Attestation`, no `SignatureRecord`.
 * A consumer can render an entire approval board from these views without
 * importing anything from `src/lib/multisig`.
 */

import type {
  ApprovalStatus,
  AuditEventType,
  DisbursementAuthorization,
  ReviewerRole,
} from './contracts'

export interface QuorumView {
  required: number
  pool: number
  mentorRequired: boolean
  derivedFromScore: number
}

export interface ReviewerView {
  reviewerId: string
  role: ReviewerRole
  department: string
  departmentKn?: string
  displayName?: string
  displayNameKn?: string
  /** Public signer address only — never a private key or wallet object. */
  address: string
  jurisdiction?: string
  allocated: boolean
  hasSigned: boolean
  /** Truncated signature for display; full signature stays inside the service. */
  signaturePreview?: string
  signedAt?: number
}

export interface AuditEventView {
  eventId: string
  eventType: AuditEventType
  timestamp: number
  actorRef?: string
  dataRef?: string
  eventHash: string
  prevEventHash: string | null
}

export interface ReviewerAllocationView {
  applicationId: string
  quorumPool: number
  mentorRequired: boolean
  mentorReviewerIds: string[]
  allocationDigest: string
  allocatedAt: number
  reviewers: ReviewerView[]
}

export interface ApprovalStatusView {
  applicationId: string
  status: ApprovalStatus
  quorum: QuorumView
  signaturesCollected: number
  validSignatures: number
  mentorSatisfied: boolean
  quorumMet: boolean
  disbursementAuthorized: boolean
  /** Human-readable outstanding conditions or integrity failures. */
  blockers: string[]
  /** Cryptography is real; settlement rails are not. Always true here. */
  simulatedInfrastructure: true
  /** Adita SHA-256 of snapshot.payload when opened from a real package. */
  sourceSnapshotHash: string | null
  /** True only when a real government API returned a filing id — never inferred. */
  filedWithGovernment: boolean
}

export interface ApprovalCaseView extends ApprovalStatusView {
  /** Canonical digest of the frozen application snapshot. */
  applicationHash: string
  lokScoreTotal: number
  allocation: ReviewerAllocationView
  audit: AuditEventView[]
  auditChainValid: boolean
  disbursement: DisbursementAuthorization | null
}
