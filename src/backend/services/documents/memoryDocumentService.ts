/** In-memory DocumentService — Option A local/dev implementation. */

import { getSchemeApplicationSpec } from '../../../apply/catalog'
import type { ApplicationDocumentRecord, UpsertApplicationDocumentInput } from '../../../contracts/documents'
import { BackendError } from '../../errors'
import { assertApplicationId } from '../optionA/identity'
import type { DocumentService } from '../types'
import { computeMissingDocuments } from './missingDocuments'

function newId(): string {
  return crypto.randomUUID()
}

export function createMemoryDocumentService(): DocumentService {
  // keyed `${applicationId}:${docKey}` — mirrors the DB unique(application_id, doc_key)
  const store = new Map<string, ApplicationDocumentRecord>()

  return {
    async listForApplication(applicationId) {
      assertApplicationId(applicationId)
      return [...store.values()]
        .filter((d) => d.applicationId === applicationId)
        .sort((a, b) => a.docKey.localeCompare(b.docKey))
    },

    async upsertDocument(input: UpsertApplicationDocumentInput) {
      assertApplicationId(input.applicationId)
      const key = `${input.applicationId}:${input.docKey}`
      const existing = store.get(key)
      const record: ApplicationDocumentRecord = {
        id: existing?.id ?? newId(),
        applicationId: input.applicationId,
        docKey: input.docKey,
        label: input.label ?? existing?.label ?? '',
        declaration: input.declaration,
        storagePath: input.storagePath ?? existing?.storagePath ?? null,
        contentHash: input.contentHash ?? existing?.contentHash ?? null,
        metadata: input.metadata ?? existing?.metadata ?? {},
        createdAt: existing?.createdAt ?? new Date().toISOString(),
      }
      store.set(key, record)
      return record
    },

    async getMissingDocuments(applicationId, schemeId) {
      assertApplicationId(applicationId)
      let spec
      try {
        spec = getSchemeApplicationSpec(schemeId)
      } catch (err) {
        throw new BackendError('VALIDATION', err instanceof Error ? err.message : 'Unknown scheme')
      }
      const existing = [...store.values()].filter((d) => d.applicationId === applicationId)
      return computeMissingDocuments(spec.documents, existing)
    },
  }
}
