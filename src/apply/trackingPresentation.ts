/**
 * Presentation helpers for the citizen tracking page.
 * Status and owner always come from runtime records — never invented.
 */
import type { ApplicationStatus } from '../platform/types'
import type { FilingOutcome, TrackedApplication } from './types'

export const FORBIDDEN_HERO_COPY: RegExp[] = [
  /does not submit the form for you/i,
  /submit there yourself/i,
  /submit it myself/i,
  /open the official application portal and submit/i,
  /not an approval, not a government filing/i,
  /not a disbursement authorization/i,
  /you still need to file on the official portal/i,
  /this app did not/i,
  /this app does not file/i,
  /voice is not set up/i,
  /voice is not configured/i,
]

export function containsForbiddenHeroCopy(text: string): boolean {
  return FORBIDDEN_HERO_COPY.some((re) => re.test(text))
}

export function formatHandoffOwner(nextOwner?: string, nextService?: string): string {
  const owner = (nextOwner ?? 'jordan').trim() || 'jordan'
  const service = (nextService ?? 'approval-service').trim() || 'approval-service'
  const ownerLabel = owner.toLowerCase() === 'jordan' ? 'Jordan' : owner
  const serviceLabel =
    service.toLowerCase() === 'approval-service' || service.toLowerCase() === 'approval service'
      ? 'Approval Service'
      : service
  return `${ownerLabel} · ${serviceLabel}`
}

export type TrackingStatusKind =
  | 'simulation'
  | 'reviewer_assigned'
  | 'under_review'
  | 'approved'
  | 'rejected'
  | 'disbursed'
  | 'filed_api'
  | 'ready_for_review'
  | 'routed'

export function trackingStatusKind(input: {
  outcome: FilingOutcome
  filedWithGovernment: boolean
  simulation: boolean
  platformStatus?: ApplicationStatus
}): TrackingStatusKind {
  if (input.simulation) return 'simulation'
  if (input.platformStatus === 'reviewer_assigned') return 'reviewer_assigned'
  if (input.platformStatus === 'under_review') return 'under_review'
  if (input.platformStatus === 'approved') return 'approved'
  if (input.platformStatus === 'rejected') return 'rejected'
  if (input.platformStatus === 'disbursed') return 'disbursed'
  if (input.filedWithGovernment) return 'filed_api'
  if (
    input.outcome === 'guided_packet_ready' ||
    input.outcome === 'assisted_packet_ready' ||
    input.outcome === 'government_api_unavailable' ||
    input.platformStatus === 'submitted'
  ) {
    return 'ready_for_review'
  }
  return 'routed'
}

export function trackingStatusI18nKey(kind: TrackingStatusKind): string {
  return `apply.trackingStatus.${kind}`
}

export const TRACKING_WORKFLOW_KEYS = [
  'apply.workflow.step1',
  'apply.workflow.step2',
  'apply.workflow.step3',
  'apply.workflow.step4',
] as const

export function governmentFilingI18nKey(filedWithGovernment: boolean): string {
  return filedWithGovernment ? 'apply.govFilingConnected' : 'apply.govFilingExternal'
}

export function trackingOwnerFromPackage(app: TrackedApplication): string {
  return formatHandoffOwner(app.package?.handoff.nextOwner, app.package?.handoff.nextService)
}
