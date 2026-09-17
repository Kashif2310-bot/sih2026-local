/**
 * Application package resolution (Option A / LP-APP-*) — backs
 * GET /api/apply/applications/{application_id}/package.
 *
 * Pure read/projection over the existing canonical persistence: Adita's
 * TrackedApplication (via AdminApplicationQueries.getDetail(), which itself
 * reads AditaApplicationPersistence — no second application model) plus the
 * one persisted canonical status (ApplicationStatusStore.getStatus() — no
 * second status model, never recomputed here).
 *
 * Every field below is copied verbatim from what is already stored. This
 * function never sets/upgrades/infers governmentApplicationId,
 * filedWithGovernment, or outcome — those stay exactly what Adita's
 * workflow already recorded. In particular, applicationStatus ===
 * 'submitted' never implies government acceptance; that fact lives only in
 * outcome / filedWithGovernment, which are returned alongside it, honestly,
 * independent of applicationStatus.
 */

import { assertApplicationId } from '../optionA/identity'
import type { AdminApplicationQueries } from '../adminApplicationQueries'
import type { ApplicationStatusStore } from '../types'
import type {
  ConsentRecord,
  FilingChannel,
  FilingOutcome,
  GeneratedPacket,
  SubmissionPackage,
  TrackedApplication,
} from '../../../apply/types'
import type { CanonicalApplicationStatus } from '../../../contracts/applicationStatus'

export interface ApplicationPackageResponse {
  applicationId: string
  /** Persisted canonical lifecycle status — never derived here. */
  applicationStatus: CanonicalApplicationStatus
  schemeId: string
  schemeName: string
  channel: FilingChannel
  /** Honest filing outcome — 'submitted_to_government' only if a real API confirmed it. */
  outcome: FilingOutcome
  /** True only when a live government system actually accepted the packet. */
  filedWithGovernment: boolean
  simulation: boolean
  governmentApplicationId: string | null
  officialPortalUrl: string | null
  honestLabel: string
  detail: string
  nextSteps: string[]
  consent: ConsentRecord
  /** The generated application packet (fields/documents/officialApplicationUrl). Always present once generated. */
  packet: GeneratedPacket
  /** Frozen submission-ready package — null until consented, frozen, and non-simulation. Never fabricated. */
  submissionPackage: SubmissionPackage | null
  statusHistory: TrackedApplication['statusHistory']
  createdAt: string
  updatedAt: string
}

export interface ApplicationPackageDeps {
  admin: AdminApplicationQueries
  canonicalApplicationStatus: ApplicationStatusStore
}

/** Returns null when the application does not exist — never throws NOT_FOUND itself; the HTTP layer maps that. */
export async function getApplicationPackage(
  deps: ApplicationPackageDeps,
  applicationId: string,
): Promise<ApplicationPackageResponse | null> {
  assertApplicationId(applicationId)

  const detail = await deps.admin.getDetail(applicationId)
  if (!detail) return null
  const app = detail.application

  const status = (await deps.canonicalApplicationStatus.getStatus(applicationId)) ?? 'draft'

  return {
    applicationId: app.applicationId,
    applicationStatus: status,
    schemeId: app.schemeId,
    schemeName: app.schemeName,
    channel: app.channel,
    outcome: app.outcome,
    filedWithGovernment: app.filedWithGovernment,
    simulation: app.simulation,
    governmentApplicationId: app.governmentApplicationId ?? null,
    officialPortalUrl: app.officialPortalUrl ?? null,
    honestLabel: app.honestLabel,
    detail: app.detail,
    nextSteps: app.nextSteps,
    consent: app.consent,
    packet: app.packet,
    submissionPackage: app.package ?? null,
    statusHistory: app.statusHistory,
    createdAt: app.createdAt,
    updatedAt: app.updatedAt,
  }
}
