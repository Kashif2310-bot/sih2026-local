/**
 * Live government-source retrieval, via a Supabase Edge Function
 * (supabase/functions/live-scheme-retrieval) so any external API key stays
 * server-side — the browser never calls a government API directly and
 * never holds a key for one.
 *
 * This is intentionally a single retriever, not a provider chain: there is
 * one live source implemented (data.gov.in, via the Edge Function), and
 * "not configured" / "configured but failed" are the two honest outcomes —
 * see RetrievalSourceStatus in types.ts for how the orchestrator turns
 * this into the UI's source-status line.
 */

import { SCHEMES } from './data/schemes'
import { getSupabaseClient, isSupabaseConfigured } from './supabase/client'
import { isTrustedGovUrl } from './trustedSources'
import type { LiveEvidenceItem, VerificationStatus } from './types'

export const LIVE_RETRIEVAL_TIMEOUT_MS = 4_000

export interface LiveRetrievalQuery {
  /** Local scheme ids we'd like live evidence for — normally the current turn's top-ranked schemes. */
  schemeIds: string[]
  state?: string
}

export interface LiveRetriever {
  isAvailable(): Promise<boolean>
  /** Resolves with whatever validated evidence was found (possibly empty). Throws on any failure — the caller treats that as "unavailable", never as "no evidence found". */
  retrieve(query: LiveRetrievalQuery): Promise<LiveEvidenceItem[]>
}

const KNOWN_SCHEME_IDS = new Set(SCHEMES.map((s) => s.id))
const MAX_SUMMARY_LENGTH = 280
const SOURCE_TYPES: ReadonlySet<LiveEvidenceItem['sourceType']> = new Set([
  'official_open_data',
  'official_ministry',
  'official_other',
])
const VERIFICATION_STATUSES: ReadonlySet<VerificationStatus> = new Set([
  'verified_local',
  'live_official',
  'live_contextual',
  'live_unverified',
  'unavailable',
])

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0
}

/**
 * Untrusted-content validation for whatever the Edge Function returns.
 * Every field is checked independently and a malformed/unsafe item is
 * dropped rather than the whole batch failing — one bad record (or a
 * compromised/buggy Edge Function) should never take down live retrieval
 * for everything else. Nothing here is ever allowed to invent or repair a
 * field; an item that fails validation is simply excluded.
 */
export function validateLiveEvidenceItems(raw: unknown): LiveEvidenceItem[] {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { items?: unknown }).items)) {
    return []
  }
  const items = (raw as { items: unknown[] }).items
  const validated: LiveEvidenceItem[] = []

  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>

    if (!isNonEmptyString(r.schemeId) || !KNOWN_SCHEME_IDS.has(r.schemeId)) continue
    if (!isNonEmptyString(r.sourceName)) continue
    if (!isNonEmptyString(r.sourceUrl) || !isTrustedGovUrl(r.sourceUrl)) continue
    if (!isNonEmptyString(r.sourceType) || !SOURCE_TYPES.has(r.sourceType as LiveEvidenceItem['sourceType'])) continue
    if (!isNonEmptyString(r.verificationStatus) || !VERIFICATION_STATUSES.has(r.verificationStatus as VerificationStatus))
      continue
    if (!isNonEmptyString(r.retrievedAt) || Number.isNaN(Date.parse(r.retrievedAt))) continue
    if (!isNonEmptyString(r.summary)) continue
    if (r.publishedAt !== undefined && (!isNonEmptyString(r.publishedAt) || Number.isNaN(Date.parse(r.publishedAt))))
      continue

    validated.push({
      schemeId: r.schemeId,
      sourceName: r.sourceName.slice(0, 200),
      sourceUrl: r.sourceUrl,
      sourceType: r.sourceType as LiveEvidenceItem['sourceType'],
      verificationStatus: r.verificationStatus as VerificationStatus,
      retrievedAt: r.retrievedAt,
      publishedAt: typeof r.publishedAt === 'string' ? r.publishedAt : undefined,
      summary: r.summary.slice(0, MAX_SUMMARY_LENGTH),
    })
  }

  return validated
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Live retrieval timed out after ${ms}ms`)), ms)
    promise.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e) => {
        clearTimeout(t)
        reject(e)
      },
    )
  })
}

export class SupabaseLiveRetriever implements LiveRetriever {
  isAvailable(): Promise<boolean> {
    return Promise.resolve(isSupabaseConfigured())
  }

  async retrieve(query: LiveRetrievalQuery): Promise<LiveEvidenceItem[]> {
    const client = getSupabaseClient()
    if (!client) throw new Error('Supabase is not configured')

    const { data, error } = await withTimeout(
      client.functions.invoke('live-scheme-retrieval', { body: query }),
      LIVE_RETRIEVAL_TIMEOUT_MS,
    )
    if (error) throw error
    return validateLiveEvidenceItems(data)
  }
}

export const defaultLiveRetriever: LiveRetriever = new SupabaseLiveRetriever()

/** Test/default helper: behaves exactly like Supabase never having been configured — always reports unavailable, never actually called for evidence. */
export const neverConfiguredLiveRetriever: LiveRetriever = {
  isAvailable: () => Promise.resolve(false),
  retrieve: () => Promise.reject(new Error('neverConfiguredLiveRetriever.retrieve should never be called')),
}
