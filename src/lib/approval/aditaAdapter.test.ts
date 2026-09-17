import { describe, expect, it } from 'vitest'
import {
  buildSubmissionPackage,
  freezeSnapshot,
  type FrozenSnapshot,
} from '../../apply/application'
import { createVerifierPool } from '../multisig'
import { fixtureLokScore } from './fixtures'
import { ApprovalError, createApprovalService } from './service'
import type { AditaApprovalPackage, ApprovalFinanceOverlay } from './aditaAdapter'

const APP_ID = 'LP-APP-0123456789ABCDEF'
const FROZEN_AT = '2026-09-17T12:00:00.000Z'

function overlay(total = 69): ApprovalFinanceOverlay {
  return {
    lokScore: fixtureLokScore(total),
    villageId: 'dinka-mandya',
    projectCost: 1_000_000,
  }
}

function basePayload(applicationId = APP_ID): Record<string, unknown> {
  return {
    applicationId,
    schemeId: 'term_loan',
    schemeName: 'NSFDC Term Loan',
    channel: 'guided',
    conversation: null,
    fields: {
      applicant_name: 'Lakshmi S.',
      loan_amount_requested: 900_000,
    },
    documents: [],
    consentText: 'I confirm this application.',
    simulate: false,
    officialApplicationUrl: 'https://nsfdc.nic.in/',
  }
}

async function frozen(payload: Record<string, unknown> = basePayload()): Promise<FrozenSnapshot> {
  return freezeSnapshot(payload, FROZEN_AT)
}

async function validPackage(
  extras: Partial<AditaApprovalPackage> = {},
  payload: Record<string, unknown> = basePayload(),
): Promise<AditaApprovalPackage> {
  const snapshot = await frozen(payload)
  const pkg = buildSubmissionPackage({
    applicationId: APP_ID,
    filedWithGovernment: false,
    snapshot,
  })
  return { ...pkg, ...extras, snapshot: extras.snapshot ?? snapshot }
}

function service() {
  let t = 1_700_000_200_000
  return createApprovalService({ now: () => (t += 1) })
}

async function signUntil(
  svc: ReturnType<typeof service>,
  applicationId: string,
  count: number,
) {
  const ids = svc.getReviewerAllocation(applicationId).reviewers.map((r) => r.reviewerId)
  let view = svc.getApprovalCase(applicationId)
  for (const id of ids) {
    if (view.signaturesCollected >= count) break
    view = await svc.submitSignature(applicationId, id)
  }
  return view
}

describe('Adita package → approval integration', () => {
  it('opens a case from a valid Adita snapshot (LP-APP id + SHA-256)', async () => {
    const svc = service()
    const pkg = await validPackage()
    const view = await svc.openApprovalCaseFromAditaPackage(pkg, overlay(69))

    expect(view.applicationId).toBe(APP_ID)
    expect(view.applicationId).toMatch(/^LP-APP-[A-F0-9]{16}$/i)
    expect(view.sourceSnapshotHash).toBe(pkg.snapshotHash)
    expect(view.sourceSnapshotHash).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(view.filedWithGovernment).toBe(false)
    expect(view.quorum).toMatchObject({ required: 3, pool: 5, mentorRequired: false })
    expect(view.audit[0]?.dataRef).toContain(pkg.snapshotHash)
    expect(view.audit[0]?.dataRef).toContain(`quorum:3/5`)
  })

  it('rejects a snapshot hash mismatch', async () => {
    const svc = service()
    const pkg = await validPackage()
    const tampered = {
      ...pkg,
      snapshot: { ...pkg.snapshot, payload: { ...pkg.snapshot.payload, schemeId: 'micro_finance' } },
    }
    await expect(svc.openApprovalCaseFromAditaPackage(tampered, overlay())).rejects.toMatchObject({
      code: 'SOURCE_HASH_MISMATCH',
    })
  })

  it('rejects applicationId mismatch between package and frozen payload', async () => {
    const svc = service()
    const snapshot = await frozen(basePayload('LP-APP-AAAAAAAAAAAAAAAA'))
    const pkg = buildSubmissionPackage({ applicationId: APP_ID, filedWithGovernment: false, snapshot })
    await expect(svc.openApprovalCaseFromAditaPackage(pkg, overlay())).rejects.toMatchObject({
      code: 'APPLICATION_ID_MISMATCH',
    })
  })

  it('rejects ready_for_approval=false (no consent / not review-complete)', async () => {
    const svc = service()
    const pkg = await validPackage({ readyForApproval: false })
    await expect(svc.openApprovalCaseFromAditaPackage(pkg, overlay())).rejects.toMatchObject({
      code: 'NOT_READY_FOR_APPROVAL',
    })
  })

  it('completes a valid 3-of-5 approval from an Adita package', async () => {
    const svc = service()
    const pkg = await validPackage()
    await svc.openApprovalCaseFromAditaPackage(pkg, overlay(69))
    const afterThree = await signUntil(svc, APP_ID, 3)
    expect(afterThree.quorumMet).toBe(true)
    expect(afterThree.status).toBe('quorum_met')
    const auth = svc.authorizeDisbursement(APP_ID)
    expect(auth.simulated).toBe(true)
    expect(auth.applicationId).toBe(APP_ID)
    expect(auth.sourceSnapshotHash).toBe(pkg.snapshotHash)
    expect(auth.acceptedSignerRefs).toHaveLength(3)
    expect(svc.getApprovalCase(APP_ID).status).toBe('authorized')
  })

  it('enforces mentor-required approval from an Adita package', async () => {
    const svc = service()
    const pkg = await validPackage()
    const opened = await svc.openApprovalCaseFromAditaPackage(pkg, overlay(48))
    expect(opened.quorum).toMatchObject({ required: 4, pool: 5, mentorRequired: true })

    const nonMentors = opened.allocation.reviewers.filter((r) => r.role !== 'mentor').map((r) => r.reviewerId)
    for (const id of nonMentors.slice(0, 4)) {
      await svc.submitSignature(APP_ID, id)
    }
    const beforeMentor = svc.getApprovalCase(APP_ID)
    expect(beforeMentor.quorumMet).toBe(false)
    expect(beforeMentor.mentorSatisfied).toBe(false)

    const mentorId = opened.allocation.mentorReviewerIds[0]
    if (mentorId && !beforeMentor.allocation.reviewers.find((r) => r.reviewerId === mentorId)?.hasSigned) {
      await svc.submitSignature(APP_ID, mentorId)
    }
    const after = svc.getApprovalCase(APP_ID)
    expect(after.mentorSatisfied).toBe(true)
    expect(after.quorumMet).toBe(true)
  })

  it('rejects a tampered application payload after the approval case is opened', async () => {
    const svc = service()
    const pkg = await validPackage()
    await svc.openApprovalCaseFromAditaPackage(pkg, overlay())
    const mutated = { ...pkg.snapshot.payload, schemeId: 'forged_scheme' }
    await expect(svc.assertSourceUnmutated(APP_ID, mutated)).rejects.toMatchObject({
      code: 'SOURCE_TAMPERED',
    })
    await expect(svc.assertSourceUnmutated(APP_ID, pkg.snapshot.payload)).resolves.toBeUndefined()
  })

  it('produces a simulated disbursement authorization (never a real filing)', async () => {
    const svc = service()
    const pkg = await validPackage({ filedWithGovernment: true })
    const view = await svc.openApprovalCaseFromAditaPackage(pkg, overlay(69))
    expect(view.filedWithGovernment).toBe(true)
    expect(view.status).toBe('open')
    expect(view.disbursementAuthorized).toBe(false)

    await signUntil(svc, APP_ID, 3)
    const auth = svc.authorizeDisbursement(APP_ID)
    expect(auth.simulated).toBe(true)
    expect(view.status).not.toBe('authorized')
    expect(svc.getApprovalStatus(APP_ID).simulatedInfrastructure).toBe(true)
  })

  it('does not treat submission_ready as government approval', async () => {
    const pkg = await validPackage()
    expect(pkg.status).toBe('submission_ready')
    expect(pkg.filedWithGovernment).toBe(false)
    const svc = service()
    const view = await svc.openApprovalCaseFromAditaPackage(pkg, overlay())
    expect(view.filedWithGovernment).toBe(false)
    expect(view.quorumMet).toBe(false)
  })

  it('rejects a duplicate signer on an Adita-opened case', async () => {
    const svc = service()
    await svc.openApprovalCaseFromAditaPackage(await validPackage(), overlay(69))
    const first = svc.getReviewerAllocation(APP_ID).reviewers[0].reviewerId
    await svc.submitSignature(APP_ID, first)
    await expect(svc.submitSignature(APP_ID, first)).rejects.toMatchObject({
      code: 'DUPLICATE_SIGNATURE',
    })
    expect(svc.getApprovalStatus(APP_ID).signaturesCollected).toBe(1)
  })

  it('rejects an outsider reviewer on an Adita-opened case', async () => {
    const svc = service()
    const opened = await svc.openApprovalCaseFromAditaPackage(await validPackage(), overlay(84))
    expect(opened.quorum.pool).toBe(3)
    const allocated = opened.allocation.reviewers.map((r) => r.reviewerId)
    const outsider = createVerifierPool().find((v) => !allocated.includes(v.id))
    expect(outsider).toBeTruthy()
    await expect(svc.submitSignature(APP_ID, outsider!.id)).rejects.toMatchObject({
      code: 'REVIEWER_NOT_ALLOCATED',
    })
    expect(svc.getApprovalStatus(APP_ID).signaturesCollected).toBe(0)
  })

  it('exposes ApprovalStatusView / ApprovalCaseView for admin consumption', async () => {
    const svc = service()
    await svc.openApprovalCaseFromAditaPackage(await validPackage(), overlay(69))
    const status = svc.getApprovalStatus(APP_ID)
    expect(status).toMatchObject({
      applicationId: APP_ID,
      status: 'open',
      quorumMet: false,
      disbursementAuthorized: false,
      simulatedInfrastructure: true,
      filedWithGovernment: false,
    })
    expect(status.quorum).toEqual({
      required: 3,
      pool: 5,
      mentorRequired: false,
      derivedFromScore: 69,
    })
    const board = svc.listApplicationIds().map((id) => svc.getApprovalStatus(id))
    expect(board).toHaveLength(1)
    expect(board[0]?.applicationId).toBe(APP_ID)
    expect(svc.getApprovalCase(APP_ID).allocation.reviewers.length).toBe(5)
  })

  it('blocks DisbursementAuthorization until quorum is met', async () => {
    const svc = service()
    await svc.openApprovalCaseFromAditaPackage(await validPackage(), overlay(69))
    expect(() => svc.authorizeDisbursement(APP_ID)).toThrow(ApprovalError)
    try {
      svc.authorizeDisbursement(APP_ID)
    } catch (e) {
      expect((e as ApprovalError).code).toBe('QUORUM_NOT_MET')
    }
    expect(svc.getApprovalCase(APP_ID).disbursement).toBeNull()
  })

  it('rejects a provisional applicationId on the Adita path', async () => {
    const svc = service()
    const snapshot = await frozen({ ...basePayload(), applicationId: 'provisional:deadbeef' })
    const pkg: AditaApprovalPackage = {
      applicationId: 'provisional:deadbeef',
      application_id: 'provisional:deadbeef',
      status: 'submission_ready',
      readyForApproval: true,
      filedWithGovernment: false,
      simulation: false,
      snapshotHash: snapshot.snapshotHash,
      snapshot,
      handoff: {
        fromService: 'application-automation',
        fromOwner: 'adita',
        nextService: 'approval-service',
        nextOwner: 'jordan',
        then: [],
        note: '',
      },
    }
    await expect(svc.openApprovalCaseFromAditaPackage(pkg, overlay())).rejects.toMatchObject({
      code: 'INVALID_APPLICATION_ID',
    })
  })
})

describe('ApprovalError codes from Adita adapter', () => {
  it('is an ApprovalError instance', async () => {
    const svc = service()
    try {
      await svc.openApprovalCaseFromAditaPackage(await validPackage({ readyForApproval: false }), overlay())
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(ApprovalError)
    }
  })
})
