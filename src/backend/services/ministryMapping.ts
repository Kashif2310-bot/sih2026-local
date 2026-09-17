/**
 * Ministry/department mapping helpers for scheme_id (schemes.ts) ↔ Prerna ministries.
 * Reference data only — schemes.ts remains scheme SoT.
 */

import { MINISTRIES, type MinistryId } from '../../platform/ministries'
import { SCHEMES } from '../../assistant/data/schemes'
import type { LokPulseSupabaseClient } from '../supabase/client'
import { toBackendError } from '../errors'

/** Deterministic default map for NSFDC / common schemes (prototype). */
export const DEFAULT_SCHEME_MINISTRY: Record<string, MinistryId> = {
  'nsfdc-micro-finance': 'social_justice',
  'nsfdc-term-loan': 'social_justice',
  'nbcfdc-term-loan': 'social_justice',
  pmegp: 'msme',
  'pm-mudra-yojana': 'finance',
  'stand-up-india': 'finance',
  'pm-vishwakarma': 'msme',
  'kudumbashree-microenterprise': 'women_child',
}

export function resolveMinistryForScheme(schemeId: string): MinistryId | null {
  return DEFAULT_SCHEME_MINISTRY[schemeId] ?? null
}

export function listSchemeMinistrySeedRows(): Array<{
  scheme_id: string
  ministry_id: MinistryId
}> {
  return SCHEMES.map((s) => {
    const ministry_id = resolveMinistryForScheme(s.id)
    return ministry_id ? { scheme_id: s.id, ministry_id } : null
  }).filter((r): r is { scheme_id: string; ministry_id: MinistryId } => r != null)
}

export async function fetchSchemeMinistryMap(
  client: LokPulseSupabaseClient,
): Promise<Array<{ scheme_id: string; ministry_id: string; department_id: string | null }>> {
  try {
    const { data, error } = await client.from('scheme_ministry_map').select('*')
    if (error) throw toBackendError(error)
    return (data ?? []) as Array<{
      scheme_id: string
      ministry_id: string
      department_id: string | null
    }>
  } catch {
    return listSchemeMinistrySeedRows().map((r) => ({
      scheme_id: r.scheme_id,
      ministry_id: r.ministry_id,
      department_id: null,
    }))
  }
}

export function ministryCatalog() {
  return MINISTRIES
}
