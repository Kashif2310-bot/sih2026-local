/**
 * Supabase integration tests — supabaseDocumentService (Option A).
 * Skip by default: SUPABASE_INTEGRATION=1 + service role required.
 * Same gate/setup pattern as src/backend/supabase/supabase.integration.test.ts.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { isSupabaseIntegrationEnabled } from '../../supabase/config'
import { createServiceRoleClient, type LokPulseSupabaseClient } from '../../supabase/client'
import { createSupabaseAditaApplicationPersistence } from '../aditaApplicationPersistence'
import { SCHEME_TS_IDS } from '../schemeCatalogService'
import { createSupabaseDocumentService } from './supabaseDocumentService'
import { newApplicationId } from '../../../apply/application'
import { getSchemeApplicationSpec } from '../../../apply/catalog'
import type { DocumentService } from '../types'
import type { TrackedApplication } from '../../../apply/types'

const enabled = isSupabaseIntegrationEnabled()

describe.skipIf(!enabled)('supabaseDocumentService (Supabase integration)', () => {
  let client: LokPulseSupabaseClient
  let service: DocumentService
  let applicationId: string

  beforeAll(async () => {
    client = createServiceRoleClient()
    service = createSupabaseDocumentService(client)

    // application_documents FKs to applications(application_id) — seed a real
    // LP-APP-* row via Adita's own persistence, same as the shared integration test.
    applicationId = newApplicationId()
    const now = new Date().toISOString()
    const app: TrackedApplication = {
      applicationId,
      trackingId: `TRK-${applicationId}`,
      schemeId: SCHEME_TS_IDS.microFinance,
      schemeName: 'NSFDC Micro Finance',
      channel: 'guided',
      outcome: 'guided_packet_ready',
      filedWithGovernment: false,
      simulation: false,
      honestLabel: 'Guided packet ready',
      detail: 'documents integration test',
      nextSteps: [],
      packet: {
        schemeId: SCHEME_TS_IDS.microFinance,
        schemeName: 'NSFDC Micro Finance',
        channel: 'guided',
        fields: {},
        documents: [],
        officialApplicationUrl: 'https://nsfdc.nic.in/',
        generatedAt: now,
      },
      consent: { accepted: true, acceptedAt: now, text: 'I consent', channel: 'guided', simulate: false },
      statusHistory: [{ at: now, step: 'document_requirements', note: 'it' }],
      createdAt: now,
      updatedAt: now,
    }
    await createSupabaseAditaApplicationPersistence(client).save(app)
  })

  afterAll(async () => {
    await client.from('application_documents').delete().eq('application_id', applicationId)
    await client.from('applications').delete().eq('application_id', applicationId)
  })

  it('lists no documents for a freshly seeded application', async () => {
    expect(await service.listForApplication(applicationId)).toEqual([])
  })

  it('upserts a document keyed by (applicationId, docKey), and re-upsert replaces rather than duplicates', async () => {
    const spec = getSchemeApplicationSpec(SCHEME_TS_IDS.microFinance)
    const docKey = spec.documents[0]!.key

    const first = await service.upsertDocument({
      applicationId,
      docKey,
      label: spec.documents[0]!.label,
      declaration: 'missing',
    })
    expect(first.applicationId).toBe(applicationId)
    expect(first.declaration).toBe('missing')

    const second = await service.upsertDocument({
      applicationId,
      docKey,
      declaration: 'declared_available',
      storagePath: 'docs/aadhaar.pdf',
    })
    expect(second.id).toBe(first.id)
    expect(second.declaration).toBe('declared_available')
    expect(second.storagePath).toBe('docs/aadhaar.pdf')

    const list = await service.listForApplication(applicationId)
    expect(list.filter((d) => d.docKey === docKey)).toHaveLength(1)
  })

  it('getMissingDocuments drops a doc once its declaration is no longer "missing"', async () => {
    const spec = getSchemeApplicationSpec(SCHEME_TS_IDS.microFinance)
    const requiredKeys = spec.documents.filter((d) => d.required).map((d) => d.key)

    const beforeMissing = await service.getMissingDocuments(applicationId, SCHEME_TS_IDS.microFinance)
    // First doc was already declared_available in the previous test.
    expect(beforeMissing.map((d) => d.key)).not.toContain(requiredKeys[0])

    const secondKey = requiredKeys[1]
    if (secondKey) {
      expect(beforeMissing.map((d) => d.key)).toContain(secondKey)
      await service.upsertDocument({ applicationId, docKey: secondKey, declaration: 'will_submit_on_portal' })
      const afterMissing = await service.getMissingDocuments(applicationId, SCHEME_TS_IDS.microFinance)
      expect(afterMissing.map((d) => d.key)).not.toContain(secondKey)
    }
  })
})
