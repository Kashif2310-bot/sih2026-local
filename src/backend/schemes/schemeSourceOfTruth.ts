/**
 * Scheme access under Option A:
 * - Authoritative: src/assistant/data/schemes.ts
 * - Optional enrichment cache: public.schemes (Kashif shape)
 */

import { SCHEMES, KNOWLEDGE_BASE_META } from '../../assistant/data/schemes'
import type { GovernmentScheme } from '../../assistant/types'
import type { LokPulseSupabaseClient } from '../supabase/client'
import { toBackendError } from '../errors'

export interface SchemeCacheRow {
  id: string
  name: string
  description: string
  scope: string
  state: string | null
  verification_status: string
  source_url: string
  source_name: string
  source_type: string
  retrieved_at: string | null
  last_verified_at: string | null
  updated_at: string
}

export interface SchemeView {
  scheme: GovernmentScheme
  cache: SchemeCacheRow | null
  sourceOfTruth: 'schemes.ts'
  cacheStatus: 'hit' | 'miss' | 'unavailable'
}

export function listAuthoritativeSchemes(): GovernmentScheme[] {
  return [...SCHEMES]
}

export function getAuthoritativeScheme(schemeId: string): GovernmentScheme | null {
  return SCHEMES.find((s) => s.id === schemeId) ?? null
}

export function schemeKnowledgeMeta() {
  return KNOWLEDGE_BASE_META
}

/** Read optional cache row — never invents schemes missing from schemes.ts. */
export async function getSchemeCacheRow(
  client: LokPulseSupabaseClient,
  schemeId: string,
): Promise<SchemeCacheRow | null> {
  const local = getAuthoritativeScheme(schemeId)
  if (!local) return null
  try {
    const { data, error } = await client.from('schemes').select('*').eq('id', schemeId).maybeSingle()
    if (error) throw toBackendError(error)
    return (data as SchemeCacheRow | null) ?? null
  } catch {
    return null
  }
}

export async function getSchemeView(
  client: LokPulseSupabaseClient | null,
  schemeId: string,
): Promise<SchemeView | null> {
  const scheme = getAuthoritativeScheme(schemeId)
  if (!scheme) return null
  if (!client) {
    return { scheme, cache: null, sourceOfTruth: 'schemes.ts', cacheStatus: 'unavailable' }
  }
  const cache = await getSchemeCacheRow(client, schemeId)
  return {
    scheme,
    cache,
    sourceOfTruth: 'schemes.ts',
    cacheStatus: cache ? 'hit' : 'miss',
  }
}

export async function listSchemeViews(client: LokPulseSupabaseClient | null): Promise<SchemeView[]> {
  const out: SchemeView[] = []
  for (const s of SCHEMES) {
    const view = await getSchemeView(client, s.id)
    if (view) out.push(view)
  }
  return out
}
