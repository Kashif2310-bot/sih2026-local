/**
 * Option A scheme catalog — IDs from schemes.ts (nsfdc-micro-finance, …).
 * public.schemes is optional cache only.
 */

import type { GovernmentScheme } from '../../assistant/types'
import {
  getAuthoritativeScheme,
  listAuthoritativeSchemes,
  listSchemeViews,
  schemeKnowledgeMeta,
  type SchemeView,
} from '../schemes/schemeSourceOfTruth'
import type { LokPulseSupabaseClient } from '../supabase/client'
import { resolveMinistryForScheme, ministryCatalog } from './ministryMapping'

/** Stable text ids — preferred over Phase 1/2 UUID fixtures. */
export const SCHEME_TS_IDS = {
  microFinance: 'nsfdc-micro-finance',
  termLoan: 'nsfdc-term-loan',
} as const

export interface SchemeCatalogService {
  list(): Promise<GovernmentScheme[]>
  get(schemeId: string): Promise<GovernmentScheme | null>
  listViews(): Promise<SchemeView[]>
  getView(schemeId: string): Promise<SchemeView | null>
  knowledgeMeta(): ReturnType<typeof schemeKnowledgeMeta>
  ministryFor(schemeId: string): string | null
  ministries(): ReturnType<typeof ministryCatalog>
}

export function createSchemeCatalogService(
  client: LokPulseSupabaseClient | null = null,
): SchemeCatalogService {
  return {
    async list() {
      return listAuthoritativeSchemes()
    },
    async get(schemeId) {
      return getAuthoritativeScheme(schemeId)
    },
    async listViews() {
      return listSchemeViews(client)
    },
    async getView(schemeId) {
      const { getSchemeView } = await import('../schemes/schemeSourceOfTruth')
      return getSchemeView(client, schemeId)
    },
    knowledgeMeta() {
      return schemeKnowledgeMeta()
    },
    ministryFor(schemeId) {
      return resolveMinistryForScheme(schemeId)
    },
    ministries() {
      return ministryCatalog()
    },
  }
}
