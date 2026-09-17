/**
 * Approval service boundary.
 *
 * This is the ONLY module other teams should call. It hides multisig/ECDSA
 * internals (attestation construction, wallets, signature records) behind
 * plain data views.
 *
 * Ownership boundary:
 *   Adita  → owns Application + applicationId + ApplicationSnapshot payload.
 *   Prerna → owns LokScore; its quorum fields are consumed, never recomputed.
 *   Jordan → owns everything from openApprovalCase() inwards.
 */

import {
  buildAttestationFromSnapshot,
  createVerifierPool,
  signAttestation,
  verifySignatureForReviewer,
  type Attestation,
  type SignatureRecord,
  type Verifier,
} from '../multisig'
import { verifySnapshot } from '../../apply/application'
import { allocateReviewers, demoAuthorizedPool } from './allocate'
import { appendAuditEvent, verifyAuditChain } from './audit'
import { adaptAditaPackage, type AditaApprovalPackage, type ApprovalFinanceOverlay } from './aditaAdapter'
import {
  hashApplicationSnapshot,
  type ApplicationSnapshot,
  type ApprovalSignature,
  type ApprovalStatus,
  type AuditEvent,
  type AuthorizedReviewer,
  type DisbursementAuthorization,
  type QuorumPolicy,
  type ReviewerAllocation,
} from './contracts'
import { ApprovalError, type ApprovalErrorCode } from './errors'
import { authorizeDisbursement as buildAuthorization } from './disbursement'
import { evaluateApproval, freezeQuorumPolicy, QuorumPolicyMismatchError } from './quorum'
import type {
  ApprovalCaseView,
  ApprovalStatusView,
  AuditEventView,
  ReviewerAllocationView,
  ReviewerView,
} from './views'

export { ApprovalError, type ApprovalErrorCode } from './errors'

interface CaseRecord {
  snapshot: ApplicationSnapshot
  snapshotDigest: string
  policy: QuorumPolicy
  allocation: ReviewerAllocation
  pool: AuthorizedReviewer[]
  attestation: Attestation
  signatures: ApprovalSignature[]
  audit: AuditEvent[]
  disbursement: DisbursementAuthorization | null
  status: ApprovalStatus
  sourceSnapshotHash: string | null
  sourcePayload: Record<string, unknown> | null
  filedWithGovernment: boolean
}

export interface ApprovalService {
  openApprovalCase(snapshot: ApplicationSnapshot): ApprovalCaseView
  /** Adita package path: re-hash payload, then open with LP-APP-… applicationId. */
  openApprovalCaseFromAditaPackage(
    pkg: AditaApprovalPackage,
    overlay: ApprovalFinanceOverlay,
  ): Promise<ApprovalCaseView>
  getApprovalCase(applicationId: string): ApprovalCaseView
  getReviewerAllocation(applicationId: string): ReviewerAllocationView
  submitSignature(applicationId: string, reviewerId: string): Promise<ApprovalCaseView>
  getApprovalStatus(applicationId: string): ApprovalStatusView
  authorizeDisbursement(applicationId: string): DisbursementAuthorization
  hasApprovalCase(applicationId: string): boolean
  listApplicationIds(): string[]
  /** Rejects if the caller's copy of Adita payload no longer matches the frozen hash. */
  assertSourceUnmutated(applicationId: string, payload: Record<string, unknown>): Promise<void>
}

export interface ApprovalServiceOptions {
  /**
   * Demo signing identities. Defaults to the fixture SCA wallets. Consumers
   * should not pass this; it exists for tests and for a future adapter that
   * swaps in real officer authentication.
   */
  reviewers?: Verifier[]
  /** Authorization registry override, e.g. to mark a reviewer unauthorized. */
  pool?: AuthorizedReviewer[]
  /** Clock injection for deterministic audit timestamps in tests. */
  now?: () => number
}

function requireSnapshot(snapshot: ApplicationSnapshot) {
  if (!snapshot || typeof snapshot !== 'object') {
    throw new ApprovalError('INVALID_SNAPSHOT', 'ApplicationSnapshot is required')
  }
  const missing: string[] = []
  if (!snapshot.applicationId) missing.push('applicationId')
  if (!snapshot.applicantRef) missing.push('applicantRef')
  if (!snapshot.schemeId) missing.push('schemeId')
  if (!snapshot.lokScore) missing.push('lokScore')
  if (!Number.isFinite(snapshot.frozenAt)) missing.push('frozenAt')
  if (!Number.isFinite(snapshot.projectCost)) missing.push('projectCost')
  if (!Number.isFinite(snapshot.loanAmount)) missing.push('loanAmount')
  if (missing.length > 0) {
    throw new ApprovalError(
      'INVALID_SNAPSHOT',
      `ApplicationSnapshot is missing required fields: ${missing.join(', ')}`,
      snapshot.applicationId,
      missing,
    )
  }
}

function toApprovalSignature(record: SignatureRecord): ApprovalSignature {
  return {
    reviewerId: record.verifierId,
    address: record.address,
    signature: record.signature,
    signedAt: record.signedAt,
  }
}

export function createApprovalService(options: ApprovalServiceOptions = {}): ApprovalService {
  const reviewers = options.reviewers ?? createVerifierPool()
  const pool = options.pool ?? demoAuthorizedPool(reviewers)
  const signers = new Map(reviewers.map((v) => [v.id, v]))
  const now = options.now ?? (() => Date.now())
  const cases = new Map<string, CaseRecord>()

  function record(applicationId: string): CaseRecord {
    const found = cases.get(applicationId)
    if (!found) {
      throw new ApprovalError(
        'UNKNOWN_APPLICATION',
        `No approval case for applicationId ${applicationId}`,
        applicationId,
      )
    }
    return found
  }

  function evaluate(c: CaseRecord) {
    return evaluateApproval({
      snapshot: c.snapshot,
      snapshotDigest: c.snapshotDigest,
      policy: c.policy,
      allocation: c.allocation,
      pool: c.pool,
      attestation: c.attestation,
      signatures: c.signatures,
    })
  }

  function reviewerViews(c: CaseRecord): ReviewerView[] {
    return c.allocation.allocatedReviewerIds.map((id) => {
      const reviewer = c.pool.find((r) => r.id === id)
      const signature = c.signatures.find((s) => s.reviewerId === id)
      return {
        reviewerId: id,
        role: reviewer?.role ?? 'sca_officer',
        department: reviewer?.department ?? 'Unknown',
        departmentKn: reviewer?.departmentKn,
        displayName: reviewer?.displayName,
        displayNameKn: reviewer?.displayNameKn,
        address: reviewer?.address ?? '',
        jurisdiction: reviewer?.jurisdiction,
        allocated: true,
        hasSigned: !!signature,
        signaturePreview: signature ? `${signature.signature.slice(0, 42)}…` : undefined,
        signedAt: signature?.signedAt,
      }
    })
  }

  function allocationView(c: CaseRecord): ReviewerAllocationView {
    return {
      applicationId: c.allocation.applicationId,
      quorumPool: c.allocation.quorumPool,
      mentorRequired: c.allocation.mentorRequired,
      mentorReviewerIds: [...c.allocation.mentorReviewerIds],
      allocationDigest: c.allocation.allocationDigest,
      allocatedAt: c.allocation.allocatedAt,
      reviewers: reviewerViews(c),
    }
  }

  function auditViews(c: CaseRecord): AuditEventView[] {
    return c.audit.map((e) => ({
      eventId: e.eventId,
      eventType: e.eventType,
      timestamp: e.timestamp,
      actorRef: e.actorRef,
      dataRef: e.dataRef,
      eventHash: e.eventHash,
      prevEventHash: e.prevEventHash,
    }))
  }

  function statusView(c: CaseRecord): ApprovalStatusView {
    const evaluation = evaluate(c)
    return {
      applicationId: c.snapshot.applicationId,
      status: c.status,
      quorum: {
        required: c.policy.quorumRequired,
        pool: c.policy.quorumPool,
        mentorRequired: c.policy.mentorRequired,
        derivedFromScore: c.policy.derivedFromScore,
      },
      signaturesCollected: c.signatures.length,
      validSignatures: evaluation.uniqueValidCount,
      mentorSatisfied: evaluation.mentorSatisfied,
      quorumMet: evaluation.ok,
      disbursementAuthorized: !!c.disbursement,
      blockers: evaluation.ok ? [] : [...evaluation.reasons],
      simulatedInfrastructure: true,
      sourceSnapshotHash: c.sourceSnapshotHash,
      filedWithGovernment: c.filedWithGovernment,
    }
  }

  function caseView(c: CaseRecord): ApprovalCaseView {
    return {
      ...statusView(c),
      applicationHash: c.snapshotDigest,
      lokScoreTotal: c.snapshot.lokScore.total,
      allocation: allocationView(c),
      audit: auditViews(c),
      auditChainValid: verifyAuditChain(c.audit).ok,
      disbursement: c.disbursement,
    }
  }

  function appendEvent(c: CaseRecord, input: Parameters<typeof appendAuditEvent>[1]) {
    c.audit = appendAuditEvent(c.audit, { ...input, timestamp: input.timestamp ?? now() })
  }

  function insertOpenedCase(
    snapshot: ApplicationSnapshot,
    source?: {
      sourceSnapshotHash: string
      sourcePayload: Record<string, unknown>
      filedWithGovernment: boolean
    },
  ): CaseRecord {
    requireSnapshot(snapshot)
    if (cases.has(snapshot.applicationId)) {
      throw new ApprovalError(
        'DUPLICATE_APPLICATION',
        `An approval case is already open for ${snapshot.applicationId}`,
        snapshot.applicationId,
      )
    }

    let policy: QuorumPolicy
    try {
      policy = freezeQuorumPolicy(snapshot.lokScore)
    } catch (e) {
      if (e instanceof QuorumPolicyMismatchError) {
        throw new ApprovalError('QUORUM_POLICY_MISMATCH', e.message, snapshot.applicationId)
      }
      throw e
    }

    const snapshotDigest = hashApplicationSnapshot(snapshot)
    let allocation: ReviewerAllocation
    try {
      allocation = allocateReviewers({
        snapshot,
        snapshotDigest,
        policy,
        pool,
        allocatedAt: snapshot.frozenAt,
      })
    } catch (e) {
      throw new ApprovalError(
        'ALLOCATION_FAILED',
        e instanceof Error ? e.message : 'reviewer allocation failed',
        snapshot.applicationId,
      )
    }

    const evidenceRef = source
      ? `${snapshotDigest}|adita:${source.sourceSnapshotHash}|quorum:${policy.quorumRequired}/${policy.quorumPool}|mentor:${policy.mentorRequired ? 1 : 0}`
      : snapshotDigest

    const c: CaseRecord = {
      snapshot,
      snapshotDigest,
      policy,
      allocation,
      pool,
      attestation: buildAttestationFromSnapshot(snapshot),
      signatures: [],
      audit: [],
      disbursement: null,
      status: 'open',
      sourceSnapshotHash: source?.sourceSnapshotHash ?? null,
      sourcePayload: source?.sourcePayload ?? null,
      filedWithGovernment: source?.filedWithGovernment ?? false,
    }
    appendEvent(c, {
      applicationId: snapshot.applicationId,
      eventType: 'application_opened',
      dataRef: evidenceRef,
    })
    appendEvent(c, {
      applicationId: snapshot.applicationId,
      eventType: 'reviewer_allocation_created',
      dataRef: allocation.allocationDigest,
    })
    cases.set(snapshot.applicationId, c)
    return c
  }

  return {
    openApprovalCase(snapshot) {
      return caseView(insertOpenedCase(snapshot))
    },

    async openApprovalCaseFromAditaPackage(pkg, overlay) {
      const adapted = await adaptAditaPackage(pkg, overlay)
      const c = insertOpenedCase(adapted.snapshot, {
        sourceSnapshotHash: adapted.sourceSnapshotHash,
        sourcePayload: adapted.payload,
        filedWithGovernment: adapted.filedWithGovernment,
      })
      return caseView(c)
    },

    getApprovalCase(applicationId) {
      return caseView(record(applicationId))
    },

    getReviewerAllocation(applicationId) {
      return allocationView(record(applicationId))
    },

    getApprovalStatus(applicationId) {
      return statusView(record(applicationId))
    },

    hasApprovalCase(applicationId) {
      return cases.has(applicationId)
    },

    listApplicationIds() {
      return [...cases.keys()]
    },

    async submitSignature(applicationId, reviewerId) {
      const c = record(applicationId)
      appendEvent(c, {
        applicationId,
        eventType: 'signature_requested',
        actorRef: reviewerId,
        dataRef: c.allocation.allocationDigest,
      })

      const reject = (code: ApprovalErrorCode, message: string, dataRef: string) => {
        appendEvent(c, {
          applicationId,
          eventType: 'signature_rejected',
          actorRef: reviewerId,
          dataRef,
        })
        throw new ApprovalError(code, message, applicationId)
      }

      const reviewer = c.pool.find((r) => r.id === reviewerId)
      if (!reviewer) {
        reject('REVIEWER_UNKNOWN', `Reviewer ${reviewerId} is not in the authorized pool`, 'unknown_reviewer')
      }
      if (!reviewer!.authorized) {
        reject('REVIEWER_NOT_AUTHORIZED', `Reviewer ${reviewerId} is not authorized`, 'not_authorized')
      }
      if (!c.allocation.allocatedReviewerIds.includes(reviewerId)) {
        reject(
          'REVIEWER_NOT_ALLOCATED',
          `Reviewer ${reviewerId} is not in the allocated set for ${applicationId}`,
          'outside_allocated_set',
        )
      }
      if (c.signatures.some((s) => s.reviewerId === reviewerId)) {
        reject('DUPLICATE_SIGNATURE', `Reviewer ${reviewerId} has already signed`, 'duplicate_signature')
      }
      const signer = signers.get(reviewerId)
      if (!signer) {
        reject(
          'REVIEWER_NO_SIGNING_KEY',
          `No signing identity available for reviewer ${reviewerId}`,
          'no_signing_key',
        )
      }

      const signed = await signAttestation(signer!, c.attestation)
      if (!verifySignatureForReviewer(c.attestation, signed, reviewer!.address)) {
        reject('SIGNATURE_INVALID', `Signature from ${reviewerId} failed verification`, 'invalid_signature')
      }

      c.signatures = [...c.signatures, toApprovalSignature(signed)]
      appendEvent(c, {
        applicationId,
        eventType: 'signature_collected',
        actorRef: reviewerId,
        dataRef: signed.signature.slice(0, 18),
      })

      const evaluation = evaluate(c)
      appendEvent(c, {
        applicationId,
        eventType: 'quorum_evaluated',
        dataRef: `${evaluation.uniqueValidCount}/${c.policy.quorumRequired}`,
      })
      appendEvent(c, {
        applicationId,
        eventType: 'mentor_condition_evaluated',
        dataRef: evaluation.mentorSatisfied ? 'mentor_ok' : 'mentor_pending',
      })

      if (evaluation.integrityFailed) {
        c.status = 'blocked'
      } else if (evaluation.ok) {
        c.status = 'quorum_met'
        appendEvent(c, {
          applicationId,
          eventType: 'quorum_reached',
          dataRef: c.snapshotDigest,
        })
      } else {
        c.status = 'collecting'
      }

      return caseView(c)
    },

    authorizeDisbursement(applicationId) {
      const c = record(applicationId)
      if (c.disbursement) {
        throw new ApprovalError(
          'ALREADY_AUTHORIZED',
          `Disbursement for ${applicationId} is already authorized`,
          applicationId,
        )
      }
      const result = buildAuthorization({
        snapshot: c.snapshot,
        snapshotDigest: c.snapshotDigest,
        policy: c.policy,
        allocation: c.allocation,
        pool: c.pool,
        attestation: c.attestation,
        signatures: c.signatures,
        auditLog: c.audit,
        authorizedAt: now(),
        sourceSnapshotHash: c.sourceSnapshotHash,
      })
      if (!result.ok) {
        appendEvent(c, {
          applicationId,
          eventType: 'disbursement_blocked',
          dataRef: result.reasons[0],
        })
        throw new ApprovalError(
          'QUORUM_NOT_MET',
          `Disbursement blocked for ${applicationId}`,
          applicationId,
          result.reasons,
        )
      }
      c.disbursement = result.authorization
      c.status = 'authorized'
      appendEvent(c, {
        applicationId,
        eventType: 'disbursement_authorized',
        dataRef: result.authorization.authorizationDigest,
      })
      return result.authorization
    },

    async assertSourceUnmutated(applicationId, payload) {
      const c = record(applicationId)
      if (!c.sourceSnapshotHash || !c.sourcePayload) {
        throw new ApprovalError(
          'INVALID_SNAPSHOT',
          `No Adita source snapshot bound for ${applicationId}`,
          applicationId,
        )
      }
      const ok = await verifySnapshot({
        frozen: true,
        frozenAt: new Date(c.snapshot.frozenAt).toISOString(),
        snapshotHash: c.sourceSnapshotHash,
        payload,
      })
      if (!ok) {
        throw new ApprovalError(
          'SOURCE_TAMPERED',
          'Application payload no longer matches the frozen Adita snapshot hash',
          applicationId,
        )
      }
    },
  }
}
