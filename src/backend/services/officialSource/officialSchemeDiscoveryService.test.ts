import { describe, expect, it } from 'vitest'
import { createFixtureSchemeRegistry } from '../../registry/fixtureSchemeRegistry'
import { createOfficialSchemeDiscoveryService } from './officialSchemeDiscoveryService'
import { createRetrievalOrchestrator } from './orchestrator'
import type { OfficialSourceAdapter } from './types'

function emptyAdapter(): OfficialSourceAdapter {
  return {
    id: 'none',
    sourceType: 'official_api',
    jurisdiction: 'mixed',
    isConfigured: () => false,
    fetch: async () => ({ records: [], ok: false, latencyMs: 0 }),
  }
}

function liveAdapter(): OfficialSourceAdapter {
  return {
    id: 'live',
    sourceType: 'official_dataset',
    jurisdiction: 'mixed',
    isConfigured: () => true,
    fetch: async () => ({
      records: [
        {
          sourceAdapterId: 'live',
          sourceType: 'official_dataset',
          raw: { scheme_name: 'PM Live Scheme', ministry: 'Ministry of Rural Development' },
          fetchedAt: new Date().toISOString(),
        },
      ],
      ok: true,
      latencyMs: 3,
    }),
  }
}

describe('createOfficialSchemeDiscoveryService', () => {
  it('always includes the verified_local NSFDC floor even with no live sources configured', async () => {
    const orchestrator = createRetrievalOrchestrator([emptyAdapter()])
    const service = createOfficialSchemeDiscoveryService(orchestrator, createFixtureSchemeRegistry())
    const result = await service.discover({ pass: 'broad_discovery' })
    const local = result.candidates.filter((c) => c.verificationState === 'verified_local')
    expect(local.length).toBeGreaterThanOrEqual(2) // NSFDC micro + term
  })

  it('merges live-official results alongside the local floor', async () => {
    const orchestrator = createRetrievalOrchestrator([liveAdapter()])
    const service = createOfficialSchemeDiscoveryService(orchestrator, createFixtureSchemeRegistry())
    const result = await service.discover({ pass: 'broad_discovery' })
    const names = result.candidates.map((c) => c.nameEn)
    expect(names).toContain('PM Live Scheme')
    expect(names.some((n) => n.includes('NSFDC'))).toBe(true)
  })

  it('excludes the nationwide fixture floor on a state-specific pass', async () => {
    const orchestrator = createRetrievalOrchestrator([emptyAdapter()])
    const service = createOfficialSchemeDiscoveryService(orchestrator, createFixtureSchemeRegistry())
    const result = await service.discover({ pass: 'state', stateCode: 'KA' })
    expect(result.candidates.filter((c) => c.verificationState === 'verified_local')).toHaveLength(0)
  })

  it('exposes source health and attempt log passthroughs', async () => {
    const orchestrator = createRetrievalOrchestrator([liveAdapter()])
    const service = createOfficialSchemeDiscoveryService(orchestrator, createFixtureSchemeRegistry())
    await service.discover({ pass: 'broad_discovery' })
    expect(service.getSourceHealth()).toHaveLength(1)
    expect(service.getAttemptLog().length).toBeGreaterThan(0)
  })
})
