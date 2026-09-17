import { describe, expect, it, vi } from 'vitest'
import { newApplicationId } from '../../apply/application'
import type { TrackedApplication } from '../../apply/types'
import type { ApprovalCase } from '../../lib/approval/contracts'
import { fixtureApplicationSnapshot, fixtureLokScore } from '../../lib/approval/fixtures'
import { BackendError } from '../errors'
import { createMemoryAditaApplicationPersistence } from './aditaApplicationPersistence'
import { createMemoryJordanApprovalPersistence } from './jordanApprovalPersistence'
import { persistApplicationThenApproval } from './persistApplicationThenApproval'

function sampleApplication(applicationId: string): TrackedApplication {
  const now = new Date().toISOString()
  return {
    applicationId,
    trackingId: `TRK-${applicationId}`,
    schemeId: 'nsfdc-micro-finance',
    schemeName: 'NSFDC Micro Finance',
    channel: 'guided',
    outcome: 'guided_packet_ready',
    filedWithGovernment: false,
    simulation: false,
    honestLabel: 'Guided packet ready',
    detail: 'Local packet only',
    nextSteps: ['Visit the State Channelising Agency.'],
    packet: {
      schemeId: 'nsfdc-micro-finance',
      schemeName: 'NSFDC Micro Finance',
      channel: 'guided',
      fields: {},
      documents: [],
      officialApplicationUrl: 'https://nsfdc.nic.in/',
      generatedAt: now,
    },
    consent: {
      accepted: true,
      acceptedAt: now,
      text: 'I consent',
      channel: 'guided',
      simulate: false,
    },
    statusHistory: [{ at: now, step: 'application_id', note: 'Issued' }],
    createdAt: now,
    updatedAt: now,
  }
}

function sampleApprovalCase(applicationId: string): ApprovalCase {
  const snapshot = fixtureApplicationSnapshot(70, {
    applicationId,
    schemeId: 'nsfdc-micro-finance',
    lokScore: fixtureLokScore(70),
  })
  return {
    applicationId,
    snapshot,
    snapshotDigest: '0xabc',
    policy: { quorumRequired: 2, quorumPool: 3, mentorRequired: false, derivedFromScore: 70 },
    allocation: {
      applicationId,
      allocatedReviewerIds: ['r1', 'r2'],
      allocatedAddresses: ['0x1', '0x2'],
      quorumPool: 3,
      mentorRequired: false,
      mentorReviewerIds: [],
      allocationDigest: '0xdef',
      allocatedAt: Date.now(),
    },
    signatures: [],
    status: 'open',
  }
}

describe('persistApplicationThenApproval', () => {
  it('persists the TrackedApplication before its Jordan ApprovalCase', async () => {
    const applicationId = newApplicationId()
    const applications = createMemoryAditaApplicationPersistence()
    const approvals = createMemoryJordanApprovalPersistence()
    const order: string[] = []
    const saveApplication = vi.spyOn(applications, 'save').mockImplementation(async (app) => {
      order.push('application')
      return app
    })
    const saveApproval = vi.spyOn(approvals, 'saveCase').mockImplementation(async (approvalCase) => {
      order.push('approval')
      return approvalCase
    })

    const result = await persistApplicationThenApproval({
      applications,
      approvals,
      application: sampleApplication(applicationId),
      approvalCase: sampleApprovalCase(applicationId),
    })

    expect(order).toEqual(['application', 'approval'])
    expect(saveApplication).toHaveBeenCalledOnce()
    expect(saveApproval).toHaveBeenCalledOnce()
    expect(result.application.applicationId).toBe(applicationId)
    expect(result.approvalCase?.applicationId).toBe(applicationId)
  })

  it('rejects mismatched identities before either persistence service runs', async () => {
    const applications = createMemoryAditaApplicationPersistence()
    const approvals = createMemoryJordanApprovalPersistence()
    const saveApplication = vi.spyOn(applications, 'save')
    const saveApproval = vi.spyOn(approvals, 'saveCase')

    await expect(
      persistApplicationThenApproval({
        applications,
        approvals,
        application: sampleApplication(newApplicationId()),
        approvalCase: sampleApprovalCase(newApplicationId()),
      }),
    ).rejects.toThrow(BackendError)

    expect(saveApplication).not.toHaveBeenCalled()
    expect(saveApproval).not.toHaveBeenCalled()
  })

  it('persists an application without fabricating an approval case', async () => {
    const applicationId = newApplicationId()
    const applications = createMemoryAditaApplicationPersistence()
    const approvals = createMemoryJordanApprovalPersistence()

    const result = await persistApplicationThenApproval({
      applications,
      approvals,
      application: sampleApplication(applicationId),
    })

    expect((await applications.get(applicationId))?.applicationId).toBe(applicationId)
    expect(await approvals.getCase(applicationId)).toBeNull()
    expect(result.approvalCase).toBeNull()
  })
})
