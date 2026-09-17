/**
 * Deterministic deduplication of normalized government records (Prompt 8,
 * Step 8). Preference order, per the spec:
 *   1. stable source record id (sourceId + sourceRecordId)
 *   2. canonical official URL (sourceUrl, or officialApplicationUrl if present)
 *   3. a deterministic composite identity (sourceId + state + sector + summary)
 *
 * Never merges records across different states — a Karnataka record and a
 * Kerala record are never the same record even if everything else matches,
 * so state is always part of the composite key.
 */

import type { NormalizedGovernmentRecord } from './types'

function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.hostname.toLowerCase()}${parsed.pathname.replace(/\/+$/, '').toLowerCase()}`
  } catch {
    return url.trim().toLowerCase()
  }
}

function identityKey(record: NormalizedGovernmentRecord): string {
  if (record.sourceRecordId) {
    return `id:${record.sourceId}:${record.sourceRecordId}`
  }
  const canonicalUrl = record.officialApplicationUrl ?? record.sourceUrl
  if (canonicalUrl) {
    return `url:${record.sourceId}:${normalizeUrl(canonicalUrl)}:${(record.state ?? '').toLowerCase()}`
  }
  return `composite:${record.sourceId}:${(record.state ?? '').toLowerCase()}:${(record.sector ?? '').toLowerCase()}:${record.summary.trim().toLowerCase()}`
}

export interface DeduplicationResult {
  records: NormalizedGovernmentRecord[]
  duplicatesRemoved: number
}

/**
 * Keeps the first-seen record for each identity key, preferring — among
 * records with the same key — the one with the most recent `updatedAt`/
 * `retrievedAt` so a re-fetch that only refreshes retrievedAt doesn't
 * spuriously look "newer" than one with real source-side update info.
 */
export function deduplicateRecords(records: NormalizedGovernmentRecord[]): DeduplicationResult {
  const byKey = new Map<string, NormalizedGovernmentRecord>()

  for (const record of records) {
    const key = identityKey(record)
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, record)
      continue
    }
    const existingStamp = existing.updatedAt ?? existing.publishedAt ?? existing.retrievedAt
    const candidateStamp = record.updatedAt ?? record.publishedAt ?? record.retrievedAt
    if (Date.parse(candidateStamp) > Date.parse(existingStamp)) {
      byKey.set(key, record)
    }
  }

  const deduped = Array.from(byKey.values())
  return { records: deduped, duplicatesRemoved: records.length - deduped.length }
}
