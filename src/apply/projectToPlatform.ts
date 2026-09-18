/**
 * Explicit projection: Adita TrackedApplication (LP-APP-*) → Prerna
 * platform.Application for admin views, then Jordan via approvalBridge.
 *
 * Does not mint a second application id. Does not persist a second domain
 * store — it writes the existing platform localStorage list so /admin can
 * read the same identity the apply wizard already issued.
 */
import { expectedQuorumFromTotal } from '../lib/approval/quorum'
import { LOKSCORE_WEIGHTS } from '../lib/config'
import type { SchemeId } from '../lib/finance'
import type { LokScoreBreakdown } from '../lib/lokScore'
import type { BusinessCategory } from '../data/villages'
import { routeApplication } from '../platform/ministries'
import { createApplication, getApplication } from '../platform/store'
import { ensureApprovalCase } from '../platform/approvalBridge'
import type { Application, ApplicantInfo, DocumentRecord } from '../platform/types'
import { isApplicationId } from './application'
import type { TrackedApplication } from './types'

const SKIP_OUTCOMES = new Set(['consent_required', 'blocked_by_validation'])

const CATEGORIES: BusinessCategory[] = [
  'dairy',
  'retail',
  'food',
  'textiles',
  'poultry',
  'agri_processing',
]

function fieldString(fields: Record<string, string | number | boolean>, key: string): string {
  const v = fields[key]
  if (typeof v === 'string' && v.trim()) return v.trim()
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  return ''
}

function fieldNumber(fields: Record<string, string | number | boolean>, key: string): number {
  const v = fields[key]
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v)
  return 0
}

function toCategory(raw: string): BusinessCategory {
  const s = raw.toLowerCase().replace(/\s+/g, '_')
  if ((CATEGORIES as string[]).includes(s)) return s as BusinessCategory
  if (s.includes('dairy')) return 'dairy'
  if (s.includes('poultry')) return 'poultry'
  if (s.includes('textile')) return 'textiles'
  if (s.includes('agri')) return 'agri_processing'
  if (s.includes('food')) return 'food'
  return 'retail'
}

function toGender(raw: string): ApplicantInfo['gender'] {
  const s = raw.toLowerCase()
  if (s === 'male' || s === 'female' || s === 'other') return s
  return 'other'
}

function toCommunity(raw: string): ApplicantInfo['community'] {
  const s = raw.toLowerCase()
  if (s === 'sc' || s === 'st' || s === 'obc' || s === 'general') return s
  return 'general'
}

function toSchemeId(schemeId: string, loanAmount: number): SchemeId {
  if (schemeId.includes('micro') || schemeId.includes('mudra')) return 'micro_finance'
  if (schemeId.includes('term') || schemeId.includes('pmegp') || schemeId.includes('nsfdc')) {
    return 'term_loan'
  }
  return loanAmount > 500_000 ? 'term_loan' : 'micro_finance'
}

function toDocumentStatus(declaration: TrackedApplication['packet']['documents'][number]['declaration']): DocumentRecord['status'] {
  // Declared-without-file is not an upload. Never collapse it to `uploaded`.
  if (declaration === 'declared_available') return 'declared_available'
  return 'missing'
}

function toDocuments(app: TrackedApplication): DocumentRecord[] {
  return app.packet.documents.map((d, i) => ({
    id: d.key || `doc-${i}`,
    labelEn: d.label,
    labelKn: d.label,
    status: toDocumentStatus(d.declaration),
  }))
}

function lokScoreForProjection(): LokScoreBreakdown {
  // Apply packets do not carry a LokScore. Fail closed (mentor + 4-of-5) rather
  // than inventing a passing score. Quorum fields stay aligned to Jordan's table.
  const total = 0
  const quorum = expectedQuorumFromTotal(total)
  return {
    demand: 0,
    competitionGap: 0,
    weatherFit: 0,
    financialFit: 0,
    eligibility: 0,
    total,
    grade: 'D',
    quorumRequired: quorum.quorumRequired,
    quorumPool: quorum.quorumPool,
    mentorRequired: quorum.mentorRequired,
    rationale: [
      'Projected from Adita TrackedApplication — LokScore was not on the apply packet; quorum is fail-closed.',
    ],
    rationaleKn: [],
    weights: LOKSCORE_WEIGHTS,
  }
}

export function projectTrackedApplication(app: TrackedApplication): Application {
  const fields = app.packet.fields
  const category = toCategory(fieldString(fields, 'business_sector') || fieldString(fields, 'category'))
  const gender = toGender(fieldString(fields, 'gender'))
  const community = toCommunity(fieldString(fields, 'social_category') || fieldString(fields, 'community'))
  const routing = routeApplication({ category, gender, community })
  const loanAmount = fieldNumber(fields, 'loan_amount_requested')
  const projectCost = loanAmount > 0 ? Math.round(loanAmount / 0.9) : 0
  const lokScore = lokScoreForProjection()
  const createdAt = Date.parse(app.createdAt) || Date.now()
  const name = fieldString(fields, 'applicant_name') || fieldString(fields, 'name') || 'Applicant'

  return {
    id: app.applicationId,
    createdAt,
    updatedAt: Date.parse(app.updatedAt) || createdAt,
    applicant: {
      name,
      age: fieldNumber(fields, 'age') || 0,
      gender,
      community,
      phone: fieldString(fields, 'mobile') || fieldString(fields, 'phone'),
      address: fieldString(fields, 'address'),
      villageOrTown: fieldString(fields, 'village') || fieldString(fields, 'district'),
      district: fieldString(fields, 'district'),
      state: fieldString(fields, 'state'),
      bankAccountNumber: fieldString(fields, 'bank_account_number'),
      bankIfsc: fieldString(fields, 'bank_ifsc'),
      category,
      businessDescription:
        fieldString(fields, 'proposed_business') ||
        fieldString(fields, 'business_description') ||
        fieldString(fields, 'business_sector') ||
        app.schemeName,
    },
    leadMinistryId: routing.leadMinistryId,
    supportingMinistryIds: routing.supportingMinistryIds,
    schemeId: toSchemeId(app.schemeId, loanAmount),
    schemeName: app.schemeName,
    projectCost,
    loanAmount,
    lokScore: lokScore.total,
    lokScoreBreakdown: lokScore,
    quorumRequired: lokScore.quorumRequired,
    quorumPool: lokScore.quorumPool,
    mentorRequired: lokScore.mentorRequired,
    documents: toDocuments(app),
    signatures: [],
    status: 'submitted',
    consentGiven: app.consent.accepted,
    consentAt: app.consent.acceptedAt ? Date.parse(app.consent.acceptedAt) : undefined,
    auditTrail: [
      {
        id: `evt-${createdAt}`,
        at: createdAt,
        actor: name,
        action: 'submitted',
        detail: `Projected from Adita TrackedApplication ${app.applicationId} (${app.outcome}). Same LP-APP-* identity. Routed to ${routing.leadMinistryId}.`,
      },
    ],
  }
}

export function publishTrackedApplicationToPlatform(app: TrackedApplication): Application | null {
  if (SKIP_OUTCOMES.has(app.outcome)) return null
  if (!isApplicationId(app.applicationId)) return null

  const projected = projectTrackedApplication(app)
  if (!getApplication(projected.id)) {
    createApplication(projected)
  }
  try {
    const source =
      app.snapshot && app.package
        ? {
            sourceSnapshotHash: app.snapshot.snapshotHash,
            sourcePayload: app.snapshot.payload,
            filedWithGovernment: app.filedWithGovernment,
          }
        : undefined
    ensureApprovalCase(projected, source)
  } catch {
    // Approval layer is session-memory; a failure must not block citizen submit.
  }
  return getApplication(projected.id) ?? projected
}
