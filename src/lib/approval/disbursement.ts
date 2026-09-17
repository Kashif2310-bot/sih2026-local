import { solidityPackedKeccak256 } from 'ethers'
import type { Attestation } from '../multisig'
import { auditHeadHash } from './audit'
import type {
  ApplicationSnapshot,
  ApprovalSignature,
  AuditEvent,
  AuthorizedReviewer,
  DisbursementAuthorization,
  QuorumPolicy,
  ReviewerAllocation,
} from './contracts'
import { evaluateApproval } from './quorum'

export function computeAuthorizationDigest(a: Omit<DisbursementAuthorization, 'authorizationDigest'>): string {
  return solidityPackedKeccak256(
    ['string', 'bytes32', 'uint256', 'uint256', 'uint8', 'string', 'uint256', 'bytes32', 'string'],
    [
      a.applicationId,
      a.applicationHash,
      a.quorumRequired,
      a.quorumPool,
      a.mentorRequired ? 1 : 0,
      a.acceptedSignerRefs.join(','),
      a.authorizedAt,
      a.auditHeadHash,
      a.sourceSnapshotHash ?? '',
    ],
  )
}

export function authorizeDisbursement(input: {
  snapshot: ApplicationSnapshot
  snapshotDigest: string
  policy: QuorumPolicy
  allocation: ReviewerAllocation
  pool: AuthorizedReviewer[]
  attestation: Attestation
  signatures: ApprovalSignature[]
  auditLog: readonly AuditEvent[]
  authorizedAt?: number
  sourceSnapshotHash?: string | null
}): { ok: true; authorization: DisbursementAuthorization } | { ok: false; reasons: string[] } {
  const evaluation = evaluateApproval(input)
  if (!evaluation.ok) {
    return { ok: false, reasons: evaluation.reasons }
  }

  const authorizedAt = input.authorizedAt ?? Date.now()
  const unsigned: Omit<DisbursementAuthorization, 'authorizationDigest'> = {
    applicationId: input.snapshot.applicationId,
    applicationHash: input.snapshotDigest,
    quorumRequired: input.policy.quorumRequired,
    quorumPool: input.policy.quorumPool,
    mentorRequired: input.policy.mentorRequired,
    acceptedSignerRefs: [...evaluation.validSignerIds].sort(),
    authorizedAt,
    auditHeadHash: auditHeadHash(input.auditLog),
    sourceSnapshotHash: input.sourceSnapshotHash ?? null,
    simulated: true,
  }
  return {
    ok: true,
    authorization: {
      ...unsigned,
      authorizationDigest: computeAuthorizationDigest(unsigned),
    },
  }
}
