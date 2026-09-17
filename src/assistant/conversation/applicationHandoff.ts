/**
 * Report -> application-start handoff (safe adapter layer).
 *
 * This module does NOT implement application automation — that remains
 * Adita's workstream (src/apply/* on her own branch, not present here).
 * It exists so that, once this branch and hers coexist, there is one
 * small, well-documented seam a caller can wire into her `newApplicationId()`
 * / `PreparedApplication` flow instead of hand-rolling a projection from
 * PersonalizedReport ad hoc. Every function here is a pure, read-only
 * projection of already-computed deterministic data (PersonalizedReport,
 * ApplicantProfile) — nothing here invents a scheme, a document, a status,
 * or a score.
 *
 * Target shapes this is designed to feed (observed on origin/ai-assistant-dev,
 * read-only, via `git show` — not imported, since that branch's files don't
 * exist here):
 *   - src/apply/types.ts SchemeApplicationSpec / ApplicationFieldSpec
 *   - src/apply/application.ts newApplicationId() / TrackedApplication
 *   - src/contracts/documents.ts UpsertApplicationDocumentInput (Sharan)
 *   - src/lib/approval/aditaAdapter.ts ApprovalFinanceOverlay (Jordan)
 * A future integration maps this module's output fields onto those types
 * field-by-field; this module intentionally does not import them (they are
 * not part of this branch), so it stays compilable and testable in
 * isolation today.
 */

import type { ApplicantProfile, ApplicantProfileFieldKey, FieldProvenance } from '../../shared/applicantProfile'
import { APPLICANT_PROFILE_FIELD_KEYS } from '../../shared/applicantProfile'
import type { PersonalizedReport, ReportSchemeEntry } from './reportModel'

/** One applicant fact plus its provenance — never a bare value with provenance discarded. */
export interface ApplicationStartField {
  value: NonNullable<ApplicantProfile['data'][ApplicantProfileFieldKey]>
  provenance: FieldProvenance | undefined
}

/**
 * The minimal input an application-start action needs from this assistant's
 * output. Deliberately scoped to ONE target scheme (the top-ranked one,
 * unless a caller names another via `schemeId`) — starting an application
 * is a per-scheme action, matching Adita's SchemeApplicationSpec being
 * keyed by exactly one scheme id.
 */
export interface ApplicationStartDraft {
  schemeId: string
  schemeName: string
  officialApplicationUrl?: string
  officialInfoUrl: string
  applicationSteps: string[]
  /** Raw document labels from the scheme record — Adita's own catalog (src/apply/catalog.ts) already owns turning these into full ApplicationDocumentSpec entries; this is the same source list her code already reads from schemes.ts, repeated here as a convenience so a caller doesn't have to re-fetch it. */
  documentLabels: string[]
  /** Every applicant fact currently known, with provenance intact — never flattened to bare values, so a consumer can decide how much to trust a given field (e.g. an 'ai_extracted' guess vs a 'user_provided' statement). */
  fields: Partial<Record<ApplicantProfileFieldKey, ApplicationStartField>>
  eligibilityStatus: ReportSchemeEntry['eligibilityStatus']
  eligibilityConfidence: ReportSchemeEntry['eligibilityConfidence']
  recommendation: ReportSchemeEntry['recommendation']
  /** report.maturity — how complete the underlying evidence was when this draft was produced. Distinct from any future persisted application lifecycle status; see reportModel.ts's ApplicationReadinessStatus doc comment. */
  reportMaturity: PersonalizedReport['maturity']
  /** Traceability back to the exact report snapshot this draft was derived from. */
  sourceReportId: string
  sourceReportVersion: number
  generatedAt: string
}

function fieldsFromApplicantProfile(
  applicantProfile: ApplicantProfile,
): Partial<Record<ApplicantProfileFieldKey, ApplicationStartField>> {
  const fields: Partial<Record<ApplicantProfileFieldKey, ApplicationStartField>> = {}
  for (const key of APPLICANT_PROFILE_FIELD_KEYS) {
    const value = applicantProfile.data[key]
    if (value === undefined) continue
    fields[key] = { value, provenance: applicantProfile.fieldProvenance[key] }
  }
  return fields
}

/**
 * Projects a PersonalizedReport + ApplicantProfile into the minimal input an
 * application-start action needs, for one scheme. Returns null when there is
 * no candidate scheme to start against yet — never fabricates one.
 *
 * Defaults to the top-ranked scheme (report.relevantSchemes[0], already
 * deterministically ranked — see ranking.ts) when `schemeId` is omitted.
 */
export function projectReportForApplicationStart(
  report: PersonalizedReport,
  applicantProfile: ApplicantProfile,
  schemeId?: string,
): ApplicationStartDraft | null {
  const target = schemeId
    ? report.relevantSchemes.find((s) => s.schemeId === schemeId)
    : report.relevantSchemes[0]
  if (!target) return null

  return {
    schemeId: target.schemeId,
    schemeName: target.schemeName,
    officialApplicationUrl: target.officialApplicationUrl,
    officialInfoUrl: target.officialInfoUrl,
    applicationSteps: target.applicationSteps,
    documentLabels: target.documents,
    fields: fieldsFromApplicantProfile(applicantProfile),
    eligibilityStatus: target.eligibilityStatus,
    eligibilityConfidence: target.eligibilityConfidence,
    recommendation: target.recommendation,
    reportMaturity: report.maturity,
    sourceReportId: report.reportId,
    sourceReportVersion: report.version,
    generatedAt: report.generatedAt,
  }
}

/** One document a target application will need, before anything is known about whether the citizen already has it. */
export interface ApplicationDocumentDraft {
  schemeId: string
  /** Stable, slug-form key derived from the document label — never a free-text label used as a key. */
  docKey: string
  label: string
  /** Always 'missing' here: this module only ever sees report-level knowledge, which never confirms a document is actually in hand (see DocumentReadinessItem.knownToExist, always false at this stage) — a consumer updates this once the citizen actually declares/uploads something. */
  declaration: 'missing'
}

function slugifyDocumentLabel(label: string): string {
  return (
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'document'
  )
}

/**
 * Projects the required documents for one scheme into draft entries a
 * consumer can turn into UpsertApplicationDocumentInput rows
 * (src/contracts/documents.ts, Sharan's branch) once an applicationId
 * exists. Prefers report.documentReadiness (already deduplicated across the
 * top eligible schemes) when it has entries for this scheme; falls back to
 * the scheme's own raw document list otherwise (e.g. the scheme isn't
 * eligible/possible yet, so documentReadiness never considered it).
 */
export function projectDocumentsForApplication(
  report: PersonalizedReport,
  schemeId: string,
): ApplicationDocumentDraft[] {
  const fromReadiness = report.documentReadiness.filter((d) => d.schemeId === schemeId)
  const labels =
    fromReadiness.length > 0
      ? fromReadiness.map((d) => d.documentName)
      : (report.relevantSchemes.find((s) => s.schemeId === schemeId)?.documents ?? [])

  const seen = new Set<string>()
  const drafts: ApplicationDocumentDraft[] = []
  for (const label of labels) {
    const docKey = slugifyDocumentLabel(label)
    if (seen.has(docKey)) continue
    seen.add(docKey)
    drafts.push({ schemeId, docKey, label, declaration: 'missing' })
  }
  return drafts
}

export interface ApprovalFinanceOverlayUnavailable {
  available: false
  reason: string
}

/**
 * Placeholder result type for the finance overlay Jordan's approval intake
 * needs (lokScore + villageId + projectCost — see
 * src/lib/approval/aditaAdapter.ts ApprovalFinanceOverlay on his branch).
 * Only the `available: false` case is implemented today — see
 * deriveApprovalFinanceOverlay() for why. Extend with an `available: true`
 * variant only once a real, non-fabricated derivation exists for an
 * AI/voice-originated applicant (i.e. one who never went through the /scan
 * cockpit).
 */
export type ApprovalFinanceOverlayResult = ApprovalFinanceOverlayUnavailable

/**
 * Deliberately never fabricates a LokScore-equivalent for an AI-originated
 * application. LokScore (src/lib/lokScore.ts#computeLokScore) requires an
 * EntrepreneurProfile, a ResolvedLocation, a live WeatherSignal, a
 * MandiSignal, and a SchemePlan — none of which this assistant pipeline
 * produces from a conversation alone (villageId in particular has no
 * honest source here; see docs/applicant-profile.md's "known gaps" list).
 * Returning a clearly-labelled "not available" result — rather than
 * inventing a score or silently omitting the field — is the same honesty
 * discipline every other evidence/report boundary in this codebase follows.
 */
export function deriveApprovalFinanceOverlay(_report: PersonalizedReport): ApprovalFinanceOverlayResult {
  return {
    available: false,
    reason:
      'AI/voice-originated applications have no LokScore-equivalent yet. LokScore requires an EntrepreneurProfile + ResolvedLocation + live WeatherSignal + MandiSignal + a SchemePlan (src/lib/lokScore.ts#computeLokScore), none of which this conversation pipeline derives. Route this application through the /scan cockpit flow for approval today, or design a real (non-fabricated) derivation before flipping this to available: true.',
  }
}
