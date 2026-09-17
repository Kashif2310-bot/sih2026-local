/**
 * Normalization, freshness scoring, and dedup for raw official-source rows.
 * Deliberately conservative: an OGD/ministry dataset's field names vary, so
 * we only extract what a row plainly states and never infer missing facts.
 */

import type { VerificationStatus } from '../../../contracts/common'
import type { SchemeSource } from '../../../contracts/scheme'
import type { NormalizedSchemeCandidate, RawOfficialRecord, RetrievalVerificationState } from './types'

const FRESHNESS_HALF_LIFE_DAYS = 180

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function firstString(raw: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const v = raw[key]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return null
}

function firstNumber(raw: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const v = raw[key]
    if (typeof v === 'number' && Number.isFinite(v)) return v
    if (typeof v === 'string' && v.trim() && !Number.isNaN(Number(v))) return Number(v)
  }
  return null
}

/**
 * Recency-decayed freshness score in [0, 1]. Prefers updatedAt, then
 * publishedAt, then retrievedAt. Unknown dates score 0 — never guess.
 */
export function computeFreshnessScore(
  publishedAt: string | null,
  updatedAt: string | null,
  retrievedAt: string,
): number {
  const anchor = updatedAt ?? publishedAt ?? retrievedAt
  const ts = Date.parse(anchor)
  if (Number.isNaN(ts)) return 0
  const ageDays = Math.max(0, (Date.now() - ts) / 86_400_000)
  return Math.exp(-ageDays / FRESHNESS_HALF_LIFE_DAYS)
}

/**
 * Best-effort mapping of one raw adapter row into a candidate. Returns null
 * when the row lacks even a scheme name — there is nothing honest to report.
 */
export function normalizeRawRecord(record: RawOfficialRecord): NormalizedSchemeCandidate | null {
  const raw = record.raw
  const nameEn = firstString(raw, ['scheme_name', 'scheme', 'name', 'title', 'name_en'])
  if (!nameEn) return null

  const code = firstString(raw, ['scheme_code', 'code'])
  const ministryNameEn = firstString(raw, ['ministry', 'ministry_name', 'department_name', 'nodal_ministry'])
  const officialUrl = firstString(raw, ['url', 'website', 'official_url', 'link'])
  const stateCode = firstString(raw, ['state', 'state_code', 'state_ut'])
  const publishedAt = firstString(raw, ['published_at', 'launch_date', 'date'])
  const updatedAt = firstString(raw, ['updated_at', 'last_updated'])
  const eligibilitySummaryEn = firstString(raw, ['eligibility', 'eligibility_summary', 'who_can_apply'])
  const beneficiaryInfo = firstString(raw, ['beneficiary', 'target_beneficiaries', 'target_group'])
  const loanCapRupees = firstNumber(raw, ['loan_cap', 'max_loan_amount', 'loan_amount'])
  const interestRatePercent = firstNumber(raw, ['interest_rate', 'rate_of_interest'])

  const retrievedAt = record.fetchedAt
  // Generic OGD/ministry rows can't be blindly trusted as authoritative — mark
  // live_unverified by default. Only a source explicitly promoted (e.g. a
  // signed/official structured feed) should ever produce live_official.
  const verificationState: RetrievalVerificationState = 'live_unverified'

  return {
    dedupKey: code ? `code:${slugify(code)}` : `slug:${slugify(`${nameEn}|${ministryNameEn ?? ''}`)}`,
    code,
    nameEn,
    nameKn: null,
    jurisdiction: stateCode ? 'state' : 'central',
    ministryNameEn,
    departmentNameEn: firstString(raw, ['department', 'department_name']),
    officialUrl,
    geography: { stateCode, nationwide: !stateCode },
    beneficiaryInfo,
    eligibilitySummaryEn,
    financialSupport:
      loanCapRupees != null || interestRatePercent != null
        ? {
            loanCapRupees: loanCapRupees ?? null,
            interestRatePercent: interestRatePercent ?? 0,
          }
        : null,
    benefits: [],
    documents: [],
    publishedAt: publishedAt ? new Date(publishedAt).toISOString() : null,
    updatedAt: updatedAt ? new Date(updatedAt).toISOString() : null,
    retrievedAt,
    freshnessScore: computeFreshnessScore(publishedAt, updatedAt, retrievedAt),
    verificationState,
    sourceAdapterId: record.sourceAdapterId,
    sourceType: record.sourceType,
    // Generic adapters always normalize to 'live_unverified' above; a fixed
    // mid confidence reflects "reached an official endpoint, shape unverified".
    confidence: 0.5,
  }
}

const STATE_RANK: Record<RetrievalVerificationState, number> = {
  verified_local: 3,
  live_official: 2,
  live_unverified: 1,
  unavailable: 0,
}

/** Keeps the strongest candidate per dedup key; ties broken by freshness. */
export function dedupCandidates(candidates: NormalizedSchemeCandidate[]): NormalizedSchemeCandidate[] {
  const byKey = new Map<string, NormalizedSchemeCandidate>()
  for (const c of candidates) {
    const existing = byKey.get(c.dedupKey)
    if (!existing) {
      byKey.set(c.dedupKey, c)
      continue
    }
    const better =
      STATE_RANK[c.verificationState] > STATE_RANK[existing.verificationState] ||
      (STATE_RANK[c.verificationState] === STATE_RANK[existing.verificationState] &&
        c.freshnessScore > existing.freshnessScore)
    if (better) byKey.set(c.dedupKey, c)
  }
  return [...byKey.values()]
}

const VERIFICATION_MAP: Record<RetrievalVerificationState, VerificationStatus> = {
  verified_local: 'verified',
  live_official: 'verified',
  live_unverified: 'unverified',
  unavailable: 'unverified',
}

/** Bridge into the shared SchemeSource shape — the only point this module touches contracts/scheme. */
export function toSchemeSource(candidate: NormalizedSchemeCandidate, id: string): SchemeSource | null {
  if (candidate.verificationState === 'unavailable') return null
  return {
    id,
    sourceType: candidate.sourceType,
    titleEn: candidate.nameEn,
    url: candidate.officialUrl,
    publisher: candidate.ministryNameEn ?? 'Unknown publisher',
    publishedAt: candidate.publishedAt,
    retrievedAt: candidate.retrievedAt,
    confidence: candidate.confidence,
    status: VERIFICATION_MAP[candidate.verificationState],
    notesEn: `Retrieved via ${candidate.sourceAdapterId} (${candidate.sourceType}); verification state: ${candidate.verificationState}.`,
  }
}
