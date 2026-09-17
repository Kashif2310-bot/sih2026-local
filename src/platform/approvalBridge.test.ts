import { beforeEach, describe, expect, it } from 'vitest'
import { expectedQuorumFromTotal } from '../lib/approval/quorum'
import {
  authorizeApprovalDisbursement,
  ensureApprovalCase,
  peekApprovalCase,
  resetApprovalService,
  snapshotFromApplication,
  submitApprovalSignature,
} from './approvalBridge'
import { createApplication, getApplication, newApplicationId } from './store'
import type { Application } from './types'

function makeApp(total: number): Application {
  const quorum = expectedQuorumFromTotal(total)
  const now = Date.now()
  return {
    id: newApplicationId(),
    createdAt: now,
    updatedAt: now,
    applicant: {
      name: 'Lakshmi S.',
      age: 29,
      gender: 'female',
      community: 'sc',
      phone: '9900000000',
      address: 'Addr',
      villageOrTown: 'Dinka',
      district: 'Mandya',
      state: 'Karnataka',
      bankAccountNumber: '1234',
      bankIfsc: 'SBIN0001234',
      category: 'dairy',
      businessDescription: 'Test',
    },
    leadMinistryId: 'animal_husbandry',
    supportingMinistryIds: ['finance', 'social_justice'],
    schemeId: 'term_loan',
    schemeName: 'NSFDC Term Loan Scheme',
    projectCost: 1_000_000,
    loanAmount: 900_000,
    lokScore: total,
    lokScoreBreakdown: null,
    quorumRequired: quorum.quorumRequired,
    quorumPool: quorum.quorumPool,
    mentorRequired: quorum.mentorRequired,
    documents: [],
    signatures: [],
    status: 'submitted',
    consentGiven: true,
    consentAt: now,
    auditTrail: [],
  }
}

beforeEach(() => {
  localStorage.clear()
  resetApprovalService()
})

describe('approvalBridge', () => {
  it('builds a snapshot whose quorum fields match Jordan\'s 80/60 table', () => {
    const snap = snapshotFromApplication(makeApp(84))
    expect(snap.lokScore.quorumRequired).toBe(2)
    expect(snap.lokScore.quorumPool).toBe(3)
    expect(snap.lokScore.mentorRequired).toBe(false)
    expect(snap.applicantRef).toBe('Lakshmi S.')
  })

  it('opens a Jordan approval case from a citizen application', () => {
    const app = makeApp(84)
    createApplication(app)
    const view = ensureApprovalCase(app)
    expect(view.applicationId).toBe(app.id)
    expect(view.quorum.required).toBe(2)
    expect(view.allocation.reviewers.length).toBe(3)
    expect(view.simulatedInfrastructure).toBe(true)
    expect(ensureApprovalCase(app).applicationHash).toBe(view.applicationHash)
    expect(peekApprovalCase(app.id)?.applicationId).toBe(app.id)
  })

  it('submits ECDSA signatures and syncs application status through authorize', async () => {
    const app = makeApp(84)
    createApplication(app)
    const opened = ensureApprovalCase(app)
    expect(opened.allocation.reviewers.length).toBe(3)

    const first = opened.allocation.reviewers[0]!.reviewerId
    const second = opened.allocation.reviewers[1]!.reviewerId
    const afterOne = await submitApprovalSignature(app, first, 'Admin')
    expect(afterOne.validSignatures).toBe(1)
    expect(getApplication(app.id)?.status).toBe('reviewer_assigned')

    const afterTwo = await submitApprovalSignature(app, second, 'Admin')
    expect(afterTwo.quorumMet).toBe(true)
    expect(getApplication(app.id)?.status).toBe('approved')

    const authorized = authorizeApprovalDisbursement(app, 'Admin')
    expect(authorized.disbursementAuthorized).toBe(true)
    expect(getApplication(app.id)?.status).toBe('disbursed')
  })
})
