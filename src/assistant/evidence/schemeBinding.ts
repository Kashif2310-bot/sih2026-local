/**
 * Deterministic scheme-specific evidence binding (Prompt 8, Step 4 —
 * mandatory fix).
 *
 * THE BUG THIS FIXES: the original live-retrieval path attached a generic
 * data.gov.in record's summary to every scheme id it happened to be
 * REQUESTED for that turn (see supabase/functions/live-scheme-retrieval —
 * it loops `for (const schemeId of schemeIds)` and stamps the same summary
 * onto each one). That means a single generic "1,204 units sanctioned in
 * Karnataka" statistic could be presented as evidence for PMEGP AND NSFDC
 * AND Stand-Up India simultaneously, purely because all three happened to
 * be top-ranked that turn — request order/membership, not the record's own
 * content, decided the binding. That is exactly what this module forbids.
 *
 * THE RULE: a normalized record may be bound to one specific local scheme
 * only when the RECORD ITSELF carries deterministic evidence of that tie:
 *   - an explicit scheme identifier the record declares, matching the
 *     local scheme's id, or
 *   - a canonical official application URL the record cites, matching the
 *     local scheme's officialApplicationUrl.
 * Request membership, request order, generic government statistics, and
 * weak keyword similarity are NEVER sufficient — see evaluateSchemeBinding.
 *
 * Anything that fails this test is not discarded outright: it is
 * reclassified as live_contextual evidence (see ContextualEvidenceItem in
 * ../types.ts) — official, useful, but explicitly NOT proof of any one
 * scheme's eligibility or benefits.
 */

import type { GovernmentScheme, LiveEvidenceItem, SchemeBindingMethod } from '../types'
import type { NormalizedGovernmentRecord, SchemeBindingDecision, SchemeLookup } from './types'

function normalizeUrl(url: string | undefined): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    return `${parsed.hostname.toLowerCase()}${parsed.pathname.replace(/\/+$/, '').toLowerCase()}`
  } catch {
    return url.trim().toLowerCase().replace(/\/+$/, '')
  }
}

/**
 * Decides whether a piece of evidence carrying `explicitSchemeId`/
 * `officialApplicationUrl` (if any) may be bound to `scheme`. Pure function
 * over plain fields so it works identically for a NormalizedGovernmentRecord
 * (pre-binding) and a LiveEvidenceItem (already scoped to a requested
 * scheme id, being re-checked).
 */
export function evaluateSchemeBinding(
  evidence: { explicitSchemeId?: string; officialApplicationUrl?: string },
  scheme: GovernmentScheme | undefined,
): SchemeBindingDecision {
  if (!scheme) {
    return {
      method: 'unbound',
      bound: false,
      reason: 'no local scheme record exists for the requested scheme id',
    }
  }

  const explicit = evidence.explicitSchemeId?.trim().toLowerCase()
  if (explicit && explicit === scheme.id.toLowerCase()) {
    return {
      method: 'explicit_scheme_id',
      bound: true,
      reason: `source record explicitly declares scheme id "${scheme.id}"`,
    }
  }

  const recordUrl = normalizeUrl(evidence.officialApplicationUrl)
  const schemeUrl = normalizeUrl(scheme.officialApplicationUrl)
  if (recordUrl && schemeUrl && recordUrl === schemeUrl) {
    return {
      method: 'canonical_url_match',
      bound: true,
      reason: 'source record cites the same official application URL as this scheme',
    }
  }

  return {
    method: 'unbound',
    bound: false,
    reason:
      'source record has no explicit scheme identifier or matching canonical application URL — it cannot be deterministically tied to this specific scheme, only to the general government-source context',
  }
}

export interface BindNormalizedRecordsInput {
  records: NormalizedGovernmentRecord[]
  /** The scheme ids this turn's discovery was seeking evidence for — used only to know WHICH schemes to test a record's explicit binding fields against, never to force a binding. */
  requestedSchemeIds: string[]
  lookupScheme: SchemeLookup
}

export interface BindNormalizedRecordsResult {
  bound: LiveEvidenceItem[]
  contextual: Array<import('../types').ContextualEvidenceItem>
}

function sourceTypeToLiveEvidenceSourceType(
  t: NormalizedGovernmentRecord['sourceType'],
): LiveEvidenceItem['sourceType'] {
  switch (t) {
    case 'ministry_portal':
      return 'official_ministry'
    case 'open_data_api':
      return 'official_open_data'
    default:
      return 'official_other'
  }
}

/**
 * Binds each normalized record to at most the requested scheme ids it can
 * be deterministically tied to (almost always zero or one — a record could
 * only bind to more than one if it explicitly names more than one scheme,
 * which no current connector does). Anything that cannot be bound to ANY
 * requested scheme becomes a single contextual evidence item instead of
 * being silently dropped or attached anyway.
 */
export function bindNormalizedRecords(input: BindNormalizedRecordsInput): BindNormalizedRecordsResult {
  const { records, requestedSchemeIds, lookupScheme } = input
  const bound: LiveEvidenceItem[] = []
  const contextual: Array<import('../types').ContextualEvidenceItem> = []

  for (const record of records) {
    let boundToAny = false

    for (const schemeId of requestedSchemeIds) {
      const scheme = lookupScheme(schemeId)
      const decision = evaluateSchemeBinding(record, scheme)
      if (!decision.bound) continue
      boundToAny = true
      bound.push({
        schemeId,
        sourceName: record.sourceName,
        sourceUrl: record.sourceUrl,
        sourceType: sourceTypeToLiveEvidenceSourceType(record.sourceType),
        verificationStatus: 'live_official',
        retrievedAt: record.retrievedAt,
        publishedAt: record.publishedAt,
        summary: record.summary,
        sourceRecordId: record.sourceRecordId,
        explicitSchemeId: record.explicitSchemeId,
        officialApplicationUrl: record.officialApplicationUrl,
        updatedAt: record.updatedAt,
        version: record.version,
        etag: record.etag,
        contentHash: record.contentHash,
        bindingMethod: decision.method,
        bindingReason: decision.reason,
      })
    }

    if (!boundToAny) {
      const decision = evaluateSchemeBinding(record, undefined)
      contextual.push({
        sourceName: record.sourceName,
        sourceUrl: record.sourceUrl,
        sourceType: sourceTypeToLiveEvidenceSourceType(record.sourceType),
        verificationStatus: 'live_contextual',
        retrievedAt: record.retrievedAt,
        publishedAt: record.publishedAt,
        summary: record.summary,
        requestedSchemeIds: [...requestedSchemeIds],
        reason:
          requestedSchemeIds.length > 0
            ? 'source record has no explicit scheme identifier or matching canonical application URL for any requested scheme'
            : decision.reason,
        state: record.state,
        sector: record.sector,
      })
    }
  }

  return { bound, contextual }
}

/** Re-classifies ALREADY-SHAPED LiveEvidenceItem[] (e.g. from a legacy connector that only ever emits the older, less-rich shape) using the same deterministic rule. Used as a safety net so no caller can bypass binding by constructing a LiveEvidenceItem directly. */
export function reclassifyLiveEvidence(
  items: LiveEvidenceItem[],
  lookupScheme: SchemeLookup,
): { bound: LiveEvidenceItem[]; contextual: Array<import('../types').ContextualEvidenceItem> } {
  const bound: LiveEvidenceItem[] = []
  const contextual: Array<import('../types').ContextualEvidenceItem> = []

  for (const item of items) {
    const scheme = lookupScheme(item.schemeId)
    const decision = evaluateSchemeBinding(item, scheme)
    if (decision.bound) {
      bound.push({ ...item, verificationStatus: 'live_official', bindingMethod: decision.method, bindingReason: decision.reason })
    } else {
      contextual.push({
        sourceName: item.sourceName,
        sourceUrl: item.sourceUrl,
        sourceType: item.sourceType,
        verificationStatus: 'live_contextual',
        retrievedAt: item.retrievedAt,
        publishedAt: item.publishedAt,
        summary: item.summary,
        requestedSchemeIds: [item.schemeId],
        reason: decision.reason,
      })
    }
  }

  return { bound, contextual }
}

export type { SchemeBindingMethod }
