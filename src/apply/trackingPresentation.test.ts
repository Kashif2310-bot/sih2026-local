import { describe, expect, it } from 'vitest'
import {
  containsForbiddenHeroCopy,
  formatHandoffOwner,
  governmentFilingI18nKey,
  trackingStatusKind,
} from './trackingPresentation'

describe('tracking presentation', () => {
  it('formats Jordan as the visible next owner', () => {
    expect(formatHandoffOwner('jordan', 'approval-service')).toBe('Jordan · Approval Service')
  })

  it('uses runtime platform status when a reviewer is assigned', () => {
    expect(
      trackingStatusKind({
        outcome: 'guided_packet_ready',
        filedWithGovernment: false,
        simulation: false,
        platformStatus: 'reviewer_assigned',
      }),
    ).toBe('reviewer_assigned')
  })

  it('does not invent a government filing from a guided packet', () => {
    const kind = trackingStatusKind({
      outcome: 'guided_packet_ready',
      filedWithGovernment: false,
      simulation: false,
      platformStatus: 'submitted',
    })
    expect(kind).toBe('ready_for_review')
    expect(governmentFilingI18nKey(false)).toBe('apply.govFilingExternal')
  })

  it('rejects leftover submit-yourself hero copy', () => {
    expect(containsForbiddenHeroCopy('Open the official application portal and submit there yourself.')).toBe(true)
    expect(containsForbiddenHeroCopy('Application package prepared')).toBe(false)
  })
})
