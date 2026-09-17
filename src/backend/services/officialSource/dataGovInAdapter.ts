/**
 * data.gov.in (Open Government Data Platform India) resource adapter.
 *
 * Config-gated and server-only — never reads VITE_* (Phase 11: no retrieval
 * secrets in the browser bundle). Without DATA_GOV_IN_API_KEY +
 * DATA_GOV_IN_SCHEME_RESOURCE_ID configured, isConfigured() is false and the
 * orchestrator skips this adapter cleanly (never a thrown error, never a
 * silent "no schemes" claim).
 *
 * We deliberately do NOT hardcode a specific resource id: whoever wires a
 * verified data.gov.in scheme-listing resource id supplies it via env or the
 * constructor. This adapter only knows the documented OGD resource API
 * shape (https://api.data.gov.in/resource/<id>?api-key=...&format=json&
 * filters[field]=value) — it is not tied to one dataset's exact columns.
 */

import { fetchJsonWithRetry } from './httpClient'
import type { AdapterFetchResult, OfficialSourceAdapter, RawOfficialRecord, RetrievalQuery } from './types'

const DEFAULT_BASE_URL = 'https://api.data.gov.in/resource'

function readEnv(name: string): string | null {
  if (typeof process === 'undefined' || !process.env) return null
  const v = process.env[name]
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

export interface DataGovInAdapterConfig {
  apiKey?: string | null
  resourceId?: string | null
  baseUrl?: string
}

function buildFilters(query: RetrievalQuery): Record<string, string> {
  const filters: Record<string, string> = {}
  if (query.stateCode) filters.state = query.stateCode
  if (query.ministryCode) filters.ministry = query.ministryCode
  if (query.departmentCode) filters.department = query.departmentCode
  if (query.businessCategory) filters.sector = query.businessCategory
  if (query.financeType) filters.support_type = query.financeType
  if (query.pass === 'central') filters.jurisdiction = 'central'
  return filters
}

export function createDataGovInAdapter(config: DataGovInAdapterConfig = {}): OfficialSourceAdapter {
  const apiKey = config.apiKey ?? readEnv('DATA_GOV_IN_API_KEY')
  const resourceId = config.resourceId ?? readEnv('DATA_GOV_IN_SCHEME_RESOURCE_ID')
  const baseUrl = config.baseUrl ?? readEnv('DATA_GOV_IN_BASE_URL') ?? DEFAULT_BASE_URL

  function isConfigured(): boolean {
    return Boolean(apiKey && resourceId)
  }

  async function fetch(query: RetrievalQuery): Promise<AdapterFetchResult> {
    if (!isConfigured()) {
      return { records: [], ok: false, errorMessage: 'NOT_CONFIGURED: missing DATA_GOV_IN_API_KEY/RESOURCE_ID', latencyMs: 0 }
    }

    const params = new URLSearchParams({
      'api-key': apiKey as string,
      format: 'json',
      limit: String(query.limit ?? 50),
    })
    for (const [field, value] of Object.entries(buildFilters(query))) {
      params.set(`filters[${field}]`, value)
    }
    if (query.keywords?.length) params.set('q', query.keywords.join(' '))

    const url = `${baseUrl}/${resourceId}?${params.toString()}`
    const res = await fetchJsonWithRetry(url)
    if (!res.ok) {
      return { records: [], ok: false, errorMessage: res.errorMessage, latencyMs: res.latencyMs }
    }

    const fetchedAt = new Date().toISOString()
    const body = res.data as { records?: unknown[] } | null
    const rows = Array.isArray(body?.records) ? body.records : []
    const records: RawOfficialRecord[] = rows
      .filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === 'object')
      .map((raw) => ({
        sourceAdapterId: 'data_gov_in',
        sourceType: 'official_dataset' as const,
        raw,
        fetchedAt,
      }))

    return { records, ok: true, latencyMs: res.latencyMs }
  }

  return {
    id: 'data_gov_in',
    sourceType: 'official_dataset',
    jurisdiction: 'mixed',
    isConfigured,
    fetch,
  }
}
