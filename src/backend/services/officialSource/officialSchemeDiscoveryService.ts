/**
 * Public façade for Phase 3 discovery: merges the always-available
 * verified_local fixture floor (src/backend/registry/fixtureSchemeRegistry)
 * with live-official candidates from the retrieval orchestrator.
 *
 * This never replaces SchemeRetrievalService — it's an additive discovery
 * surface other workstreams (AI/frontend) can call for broader gov-scheme
 * search without turning Supabase into a second competing registry.
 */

import type { SchemeRegistry } from '../types'
import { dedupCandidates } from './normalize'
import type { RetrievalOrchestrator } from './orchestrator'
import type { DiscoveryResult, NormalizedSchemeCandidate, RetrievalQuery } from './types'

export interface OfficialDiscoveryEnvelope extends DiscoveryResult {
  retrievedAt: string
}

export interface OfficialSchemeDiscoveryService {
  discover(query: RetrievalQuery): Promise<OfficialDiscoveryEnvelope>
  getSourceHealth: RetrievalOrchestrator['getSourceHealth']
  getAttemptLog: RetrievalOrchestrator['getAttemptLog']
}

function localBaselineMatches(query: RetrievalQuery): boolean {
  // The NSFDC fixture is central, nationwide, all-sector — it's a candidate
  // for every pass except a state-specific one (it has no state-specific data).
  return query.pass !== 'state'
}

async function fixtureToCandidates(fixture: SchemeRegistry): Promise<NormalizedSchemeCandidate[]> {
  const list = await fixture.listSchemes()
  const out: NormalizedSchemeCandidate[] = []
  for (const summary of list.data) {
    const full = await fixture.getScheme(summary.id)
    const v = full?.latestVersion
    if (!full || !v) continue
    out.push({
      dedupKey: `code:${full.code.toLowerCase()}`,
      code: full.code,
      nameEn: full.nameEn,
      nameKn: full.nameKn,
      jurisdiction: full.jurisdiction,
      ministryNameEn: null,
      departmentNameEn: null,
      officialUrl: v.officialUrls[0] ?? null,
      geography: { stateCode: null, nationwide: true },
      beneficiaryInfo: v.eligibilitySummaryEn,
      eligibilitySummaryEn: v.eligibilitySummaryEn,
      financialSupport: v.loanTerms,
      benefits: v.benefits,
      documents: v.documents,
      publishedAt: v.publishedAt,
      updatedAt: null,
      retrievedAt: v.retrievedAt,
      freshnessScore: v.freshnessScore,
      verificationState: 'verified_local',
      sourceAdapterId: 'fixture_registry',
      sourceType: 'prototype_fixture',
      confidence: 1,
    })
  }
  return out
}

export function createOfficialSchemeDiscoveryService(
  orchestrator: RetrievalOrchestrator,
  fixture: SchemeRegistry,
): OfficialSchemeDiscoveryService {
  return {
    async discover(query: RetrievalQuery): Promise<OfficialDiscoveryEnvelope> {
      const live = await orchestrator.discover(query)
      const baseline = localBaselineMatches(query) ? await fixtureToCandidates(fixture) : []
      const merged = dedupCandidates([...baseline, ...live.candidates])

      return {
        ...live,
        candidates: merged,
        retrievedAt: new Date().toISOString(),
        honestyNoteEn:
          baseline.length > 0
            ? `${live.honestyNoteEn} Verified-local NSFDC schemes are always included as a floor.`
            : live.honestyNoteEn,
      }
    },
    getSourceHealth: orchestrator.getSourceHealth,
    getAttemptLog: orchestrator.getAttemptLog,
  }
}
