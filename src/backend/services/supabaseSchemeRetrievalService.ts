/**
 * Supabase-backed SchemeRetrievalService.
 * Public registry reads; falls back to fixture only via resilient wrapper.
 */

import type { Uuid } from '../../contracts/common'
import type {
  SchemeFilter,
  SchemeSource,
  SchemeSummary,
  SchemeSummaryEnvelope,
  SchemeVersionEnvelope,
  SchemeVersionRecord,
} from '../../contracts/scheme'
import type { SchemeRetrievalService } from './types'
import { BackendError, toBackendError } from '../errors'
import { assertUuid } from '../validation'
import type { LokPulseSupabaseClient } from '../supabase/client'
import {
  mapDepartment,
  mapMinistry,
  mapScheme,
  mapSchemeSource,
  mapSchemeVersion,
  type DepartmentRow,
  type MinistryRow,
  type SchemeRow,
  type SchemeSourceRow,
  type SchemeVersionRow,
} from '../supabase/mappers'

const HONESTY_EN =
  'Supabase registry v0: NSFDC Micro Finance and Term Loan seeded from official-constant fixture. Document lists may be indicative. No live scraping.'
const HONESTY_KN =
  'Supabase ರಿಜಿಸ್ಟ್ರಿ v0: NSFDC ಮೈಕ್ರೋ/ಟರ್ಮ್ ಲೋನ್. ದಾಖಲೆ ಪಟ್ಟಿ ಸೂಚಕವಾಗಿರಬಹುದು.'

function envelopeForSummaries(data: SchemeSummary[], sourceIds: string[]): SchemeSummaryEnvelope {
  return {
    data,
    provenance: 'curated_seed',
    verificationStatus: 'verified',
    stale: false,
    sourceIds,
    retrievedAt: new Date().toISOString(),
    honestyNoteEn: HONESTY_EN,
    honestyNoteKn: HONESTY_KN,
  }
}

function envelopeForVersion(v: SchemeVersionRecord): SchemeVersionEnvelope {
  return {
    data: v,
    provenance: 'curated_seed',
    verificationStatus: v.verificationStatus,
    stale: v.verificationStatus === 'stale',
    sourceIds: v.sources.map((s) => s.id),
    retrievedAt: v.retrievedAt,
    honestyNoteEn: HONESTY_EN,
    honestyNoteKn: HONESTY_KN,
  }
}

export function createSupabaseSchemeRetrievalService(
  client: LokPulseSupabaseClient,
): SchemeRetrievalService {
  async function loadSourcesForVersion(versionId: string): Promise<SchemeSource[]> {
    const { data: links, error: linkErr } = await client
      .from('scheme_version_sources')
      .select('source_id, is_primary')
      .eq('scheme_version_id', versionId)
    if (linkErr) throw toBackendError(linkErr)
    if (!links?.length) return []
    const ids = links.map((l) => l.source_id as string)
    const { data: sources, error } = await client.from('scheme_sources').select('*').in('id', ids)
    if (error) throw toBackendError(error)
    return ((sources ?? []) as SchemeSourceRow[]).map(mapSchemeSource)
  }

  async function loadLatestVersion(schemeId: string): Promise<SchemeVersionRecord | null> {
    const { data, error } = await client
      .from('scheme_versions')
      .select('*')
      .eq('scheme_id', schemeId)
      .order('effective_from', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) throw toBackendError(error)
    if (!data) return null
    const row = data as SchemeVersionRow
    const sources = await loadSourcesForVersion(row.id)
    return mapSchemeVersion(row, sources)
  }

  async function resolveSchemeRow(schemeIdOrCode: string): Promise<SchemeRow | null> {
    const byId = UUID_RE.test(schemeIdOrCode)
    const q = client.from('schemes').select('*')
    const { data, error } = byId
      ? await q.eq('id', schemeIdOrCode).maybeSingle()
      : await q.eq('code', schemeIdOrCode).maybeSingle()
    if (error) throw toBackendError(error)
    return (data as SchemeRow | null) ?? null
  }

  return {
    async listSchemes(filter?: SchemeFilter) {
      try {
        let q = client.from('schemes').select('*').eq('status', 'active')
        if (filter?.jurisdiction) q = q.eq('jurisdiction', filter.jurisdiction)
        if (filter?.ministryId) {
          assertUuid(filter.ministryId, 'ministryId')
          q = q.eq('owning_ministry_id', filter.ministryId)
        }
        if (filter?.departmentId) {
          assertUuid(filter.departmentId, 'departmentId')
          q = q.eq('owning_department_id', filter.departmentId)
        }
        const { data, error } = await q
        if (error) throw toBackendError(error)
        const rows = (data ?? []) as SchemeRow[]
        const summaries: SchemeSummary[] = []
        const sourceIds = new Set<string>()
        for (const row of rows) {
          const latest = await loadLatestVersion(row.id)
          if (filter?.verificationStatus && latest?.verificationStatus !== filter.verificationStatus) {
            continue
          }
          for (const s of latest?.sources ?? []) sourceIds.add(s.id)
          summaries.push({
            id: row.id as Uuid,
            code: row.code,
            nameEn: row.name_en,
            nameKn: row.name_kn,
            jurisdiction: row.jurisdiction,
            verificationStatus: latest?.verificationStatus ?? 'unverified',
            provenance: 'curated_seed',
            latestVersionId: latest?.id ?? null,
            latestVersion: latest?.version ?? null,
          })
        }
        return envelopeForSummaries(summaries, [...sourceIds])
      } catch (err) {
        throw toBackendError(err)
      }
    },

    async getScheme(schemeId: Uuid) {
      try {
        const row = await resolveSchemeRow(schemeId)
        if (!row) return null
        const latest = await loadLatestVersion(row.id)
        return mapScheme(row, latest)
      } catch (err) {
        throw toBackendError(err)
      }
    },

    async getSchemeVersion(schemeId: Uuid, version: string) {
      try {
        const row = await resolveSchemeRow(schemeId)
        if (!row) return null
        const { data, error } = await client
          .from('scheme_versions')
          .select('*')
          .eq('scheme_id', row.id)
          .eq('version', version)
          .maybeSingle()
        if (error) throw toBackendError(error)
        if (!data) return null
        const vrow = data as SchemeVersionRow
        const sources = await loadSourcesForVersion(vrow.id)
        return envelopeForVersion(mapSchemeVersion(vrow, sources))
      } catch (err) {
        throw toBackendError(err)
      }
    },

    async getLatestVerifiedVersion(schemeId: Uuid) {
      try {
        const full = await this.getScheme(schemeId)
        if (!full?.latestVersion) return null
        const st = full.latestVersion.verificationStatus
        if (st !== 'verified' && st !== 'prototype_indicative') return null
        return envelopeForVersion(full.latestVersion)
      } catch (err) {
        throw toBackendError(err)
      }
    },

    async listMinistries() {
      try {
        const { data, error } = await client.from('ministries').select('*').order('code')
        if (error) throw toBackendError(error)
        return ((data ?? []) as MinistryRow[]).map(mapMinistry)
      } catch (err) {
        throw toBackendError(err)
      }
    },

    async listDepartments(ministryId?: Uuid) {
      try {
        let q = client.from('departments').select('*').order('code')
        if (ministryId) {
          assertUuid(ministryId, 'ministryId')
          q = q.eq('ministry_id', ministryId)
        }
        const { data, error } = await q
        if (error) throw toBackendError(error)
        return ((data ?? []) as DepartmentRow[]).map(mapDepartment)
      } catch (err) {
        throw toBackendError(err)
      }
    },
  }
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** Resilient registry: Supabase first, fixture on any failure (prototype safety). */
export function createResilientSchemeRetrievalService(
  primary: SchemeRetrievalService,
  fallback: SchemeRetrievalService,
): SchemeRetrievalService {
  async function withFallback<T>(fn: (s: SchemeRetrievalService) => Promise<T>): Promise<T> {
    try {
      return await fn(primary)
    } catch (err) {
      if (err instanceof BackendError && err.code === 'NOT_CONFIGURED') {
        return fn(fallback)
      }
      try {
        return await fn(fallback)
      } catch {
        throw toBackendError(err)
      }
    }
  }

  return {
    listSchemes: (f) => withFallback((s) => s.listSchemes(f)),
    getScheme: (id) => withFallback((s) => s.getScheme(id)),
    getSchemeVersion: (id, v) => withFallback((s) => s.getSchemeVersion(id, v)),
    getLatestVerifiedVersion: (id) => withFallback((s) => s.getLatestVerifiedVersion(id)),
    listMinistries: () => withFallback((s) => s.listMinistries()),
    listDepartments: (id) => withFallback((s) => s.listDepartments(id)),
  }
}
