import { describe, expect, it } from 'vitest'
import type { LiveEvidenceItem } from '../types'
import type { LiveRetriever } from '../liveRetrieval'
import { DataGovInConnector, DATA_GOV_IN_DESCRIPTOR } from './dataGovInConnector'

function evidenceItem(overrides: Partial<LiveEvidenceItem> = {}): LiveEvidenceItem {
  return {
    schemeId: 'pmegp',
    sourceName: 'data.gov.in (Open Government Data Platform)',
    sourceUrl: 'https://api.data.gov.in/resource/abc123',
    sourceType: 'official_open_data',
    verificationStatus: 'live_official',
    retrievedAt: '2026-01-01T00:00:00.000Z',
    summary: '1,204 units sanctioned in Karnataka in FY2023-24.',
    ...overrides,
  }
}

function fakeRetriever(items: LiveEvidenceItem[], available = true): LiveRetriever {
  return {
    isAvailable: () => Promise.resolve(available),
    retrieve: () => Promise.resolve(items),
  }
}

describe('DataGovInConnector — GovernmentSourceConnector abstraction (Prompt 8 Step 2)', () => {
  it('exposes a provider-independent descriptor', () => {
    const connector = new DataGovInConnector(fakeRetriever([]))
    expect(connector.descriptor).toBe(DATA_GOV_IN_DESCRIPTOR)
    expect(connector.descriptor.officialDomain).toBe('api.data.gov.in')
    expect(connector.descriptor.scope).toBe('central')
  })

  it('delegates isAvailable() to the underlying retriever, never assuming availability', async () => {
    const connector = new DataGovInConnector(fakeRetriever([], false))
    expect(await connector.isAvailable()).toBe(false)
  })

  it('normalizes a legacy LiveEvidenceItem into a NormalizedGovernmentRecord, preserving provenance fields', async () => {
    const connector = new DataGovInConnector(fakeRetriever([evidenceItem({ publishedAt: '2025-12-01T00:00:00.000Z' })]))
    const records = await connector.fetchNormalized({ schemeIds: ['pmegp'], state: 'Karnataka', pass: 'broad_discovery' })
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      sourceId: 'data-gov-in',
      sourceUrl: 'https://api.data.gov.in/resource/abc123',
      retrievedAt: '2026-01-01T00:00:00.000Z',
      publishedAt: '2025-12-01T00:00:00.000Z',
      state: 'Karnataka',
      summary: '1,204 units sanctioned in Karnataka in FY2023-24.',
    })
  })

  it('does NOT fabricate explicitSchemeId/officialApplicationUrl from the requested scheme id — leaves them unset when the retriever does not supply them', async () => {
    const connector = new DataGovInConnector(fakeRetriever([evidenceItem({ schemeId: 'pmegp' })]))
    const records = await connector.fetchNormalized({ schemeIds: ['pmegp'], pass: 'broad_discovery' })
    expect(records[0].explicitSchemeId).toBeUndefined()
    expect(records[0].officialApplicationUrl).toBeUndefined()
  })

  it('passes through explicitSchemeId/officialApplicationUrl when the retriever DOES supply them (future-proofing for a richer source)', async () => {
    const connector = new DataGovInConnector(
      fakeRetriever([evidenceItem({ explicitSchemeId: 'pmegp', officialApplicationUrl: 'https://www.kviconline.gov.in/pmegp/' })]),
    )
    const records = await connector.fetchNormalized({ schemeIds: ['pmegp'], pass: 'broad_discovery' })
    expect(records[0].explicitSchemeId).toBe('pmegp')
    expect(records[0].officialApplicationUrl).toBe('https://www.kviconline.gov.in/pmegp/')
  })

  it('collapses the legacy per-requested-scheme-id duplication back into ONE normalized record', async () => {
    // Mirrors exactly what the real Edge Function does today: the same
    // generic record duplicated once per requested scheme id.
    const duplicated = [evidenceItem({ schemeId: 'pmegp' }), evidenceItem({ schemeId: 'pm-mudra-yojana' }), evidenceItem({ schemeId: 'nsfdc-term-loan' })]
    const connector = new DataGovInConnector(fakeRetriever(duplicated))
    const records = await connector.fetchNormalized({
      schemeIds: ['pmegp', 'pm-mudra-yojana', 'nsfdc-term-loan'],
      pass: 'broad_discovery',
    })
    expect(records).toHaveLength(1)
  })

  it('keeps distinct records distinct when they actually carry different binding proof', async () => {
    const items = [
      evidenceItem({ explicitSchemeId: 'pmegp' }),
      evidenceItem({ explicitSchemeId: 'pm-mudra-yojana' }),
    ]
    const connector = new DataGovInConnector(fakeRetriever(items))
    const records = await connector.fetchNormalized({ schemeIds: ['pmegp', 'pm-mudra-yojana'], pass: 'broad_discovery' })
    expect(records).toHaveLength(2)
  })

  it('propagates a retriever failure as a rejected promise — never silently returns an empty/successful result', async () => {
    const failing: LiveRetriever = {
      isAvailable: () => Promise.resolve(true),
      retrieve: () => Promise.reject(new Error('network down')),
    }
    const connector = new DataGovInConnector(failing)
    await expect(connector.fetchNormalized({ schemeIds: ['pmegp'], pass: 'broad_discovery' })).rejects.toThrow('network down')
  })
})
