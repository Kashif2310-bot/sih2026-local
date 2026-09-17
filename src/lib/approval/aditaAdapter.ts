/**
 * Isolated adapter: Adita SubmissionPackage / FrozenSnapshot
 * → Jordan ApplicationSnapshot.
 *
 * Does not redefine Adita's Application model. Types are imported from
 * src/apply/application.ts (Adita-owned). Jordan's ApplicationSnapshot
 * remains the approval-layer hash input and is a different type.
 */

import {
  isApplicationId,
  verifySnapshot,
  type FrozenSnapshot,
  type SubmissionPackage,
} from '../../apply/application'
import type { LokScoreBreakdown } from '../lokScore'
import type { ApplicationSnapshot } from './contracts'
import { ApprovalError } from './errors'

/**
 * Inbound package. Adita's SubmissionPackage literals `readyForApproval: true`
 * and `simulation: false` — this input widens those two fields so the adapter
 * can reject not-ready packages instead of making them unrepresentable.
 */
export type AditaApprovalPackage = Omit<
  SubmissionPackage,
  'readyForApproval' | 'simulation' | 'status' | 'handoff'
> & {
  readyForApproval: boolean
  simulation?: boolean
  status?: SubmissionPackage['status'] | string
  governmentApplicationId?: string
  handoff?: SubmissionPackage['handoff'] | { nextOwner?: string }
}

/**
 * Fields Adita does not freeze (LokScore / village / project cost live in the
 * NSFDC engines). Passed through unchanged; never written back into Adita payload.
 */
export interface ApprovalFinanceOverlay {
  lokScore: LokScoreBreakdown
  villageId: string
  projectCost: number
  loanAmount?: number
  applicantRef?: string
}

export interface AdaptedAditaHandoff {
  snapshot: ApplicationSnapshot
  sourceSnapshotHash: string
  filedWithGovernment: boolean
  simulation: boolean
  payload: Record<string, unknown>
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function fieldString(fields: Record<string, unknown>, key: string): string | undefined {
  const v = fields[key]
  if (typeof v === 'string' && v.trim()) return v.trim()
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  return undefined
}

function fieldNumber(fields: Record<string, unknown>, key: string): number | undefined {
  const v = fields[key]
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v)
  return undefined
}

export async function verifyAditaSnapshotHash(snapshot: FrozenSnapshot): Promise<string> {
  const ok = await verifySnapshot(snapshot)
  if (!ok) {
    throw new ApprovalError(
      'SOURCE_HASH_MISMATCH',
      'Adita snapshot_hash does not match SHA-256 of snapshot.payload',
      typeof snapshot.payload.applicationId === 'string' ? snapshot.payload.applicationId : undefined,
    )
  }
  return snapshot.snapshotHash
}

export async function adaptAditaPackage(
  pkg: AditaApprovalPackage,
  overlay: ApprovalFinanceOverlay,
): Promise<AdaptedAditaHandoff> {
  if (!pkg || typeof pkg !== 'object') {
    throw new ApprovalError('INVALID_SNAPSHOT', 'Adita submission package is required')
  }

  const applicationId = pkg.applicationId || pkg.application_id
  if (!applicationId || !isApplicationId(applicationId)) {
    throw new ApprovalError(
      'INVALID_APPLICATION_ID',
      'Adita applicationId must match LP-APP-[16 hex]',
      applicationId,
    )
  }
  if (pkg.application_id && pkg.applicationId && pkg.application_id !== pkg.applicationId) {
    throw new ApprovalError(
      'APPLICATION_ID_MISMATCH',
      'applicationId and application_id disagree',
      pkg.applicationId,
    )
  }

  if (pkg.readyForApproval !== true) {
    throw new ApprovalError(
      'NOT_READY_FOR_APPROVAL',
      'Package is not ready_for_approval — explicit review + consent are required',
      applicationId,
    )
  }

  if (pkg.handoff && pkg.handoff.nextOwner && pkg.handoff.nextOwner !== 'jordan') {
    throw new ApprovalError(
      'INVALID_SNAPSHOT',
      `Package handoff.nextOwner is ${pkg.handoff.nextOwner}, expected jordan`,
      applicationId,
    )
  }

  const frozen = pkg.snapshot
  if (!frozen || frozen.frozen !== true || !frozen.payload) {
    throw new ApprovalError('INVALID_SNAPSHOT', 'Frozen snapshot payload is required', applicationId)
  }

  if (pkg.snapshotHash && pkg.snapshotHash !== frozen.snapshotHash) {
    throw new ApprovalError(
      'SOURCE_HASH_MISMATCH',
      'Package snapshotHash does not match snapshot.snapshotHash',
      applicationId,
    )
  }

  const payloadId = frozen.payload.applicationId
  if (typeof payloadId === 'string' && payloadId !== applicationId) {
    throw new ApprovalError(
      'APPLICATION_ID_MISMATCH',
      'Frozen payload.applicationId does not match package applicationId',
      applicationId,
    )
  }

  const sourceSnapshotHash = await verifyAditaSnapshotHash(frozen)
  const fields = asRecord(frozen.payload.fields)
  const schemeId =
    typeof frozen.payload.schemeId === 'string' && frozen.payload.schemeId
      ? frozen.payload.schemeId
      : undefined
  const applicantRef =
    overlay.applicantRef ?? fieldString(fields, 'applicant_name') ?? fieldString(fields, 'name')
  const loanAmount = overlay.loanAmount ?? fieldNumber(fields, 'loan_amount_requested')
  const frozenAt = Date.parse(frozen.frozenAt)

  if (!schemeId || !applicantRef || !Number.isFinite(loanAmount) || !Number.isFinite(frozenAt)) {
    throw new ApprovalError(
      'INVALID_SNAPSHOT',
      'Cannot adapt Adita package: missing schemeId, applicant name, loan amount, or frozenAt',
      applicationId,
    )
  }

  const snapshot: ApplicationSnapshot = {
    applicationId,
    applicantRef,
    villageId: overlay.villageId,
    schemeId,
    projectCost: overlay.projectCost,
    loanAmount: loanAmount as number,
    lokScore: overlay.lokScore,
    frozenAt,
  }

  return {
    snapshot,
    sourceSnapshotHash,
    filedWithGovernment: pkg.filedWithGovernment === true,
    simulation: pkg.simulation === true,
    payload: JSON.parse(JSON.stringify(frozen.payload)) as Record<string, unknown>,
  }
}
