/** Supabase-backed DocumentService (Option A) — public.application_documents. */

import { getSchemeApplicationSpec } from '../../../apply/catalog'
import type { UpsertApplicationDocumentInput } from '../../../contracts/documents'
import { BackendError, toBackendError } from '../../errors'
import { assertApplicationId } from '../optionA/identity'
import type { LokPulseSupabaseClient } from '../../supabase/client'
import { mapApplicationDocument, type ApplicationDocumentRow } from '../../supabase/mappers'
import type { DocumentService } from '../types'
import { computeMissingDocuments } from './missingDocuments'

export function createSupabaseDocumentService(client: LokPulseSupabaseClient): DocumentService {
  return {
    async listForApplication(applicationId) {
      assertApplicationId(applicationId)
      try {
        const { data, error } = await client
          .from('application_documents')
          .select('*')
          .eq('application_id', applicationId)
          .order('doc_key', { ascending: true })
        if (error) throw toBackendError(error)
        return ((data ?? []) as ApplicationDocumentRow[]).map(mapApplicationDocument)
      } catch (err) {
        throw toBackendError(err)
      }
    },

    async upsertDocument(input: UpsertApplicationDocumentInput) {
      assertApplicationId(input.applicationId)
      try {
        const { data, error } = await client
          .from('application_documents')
          .upsert(
            {
              application_id: input.applicationId,
              doc_key: input.docKey,
              label: input.label,
              declaration: input.declaration,
              storage_path: input.storagePath ?? null,
              content_hash: input.contentHash ?? null,
              metadata: input.metadata ?? {},
            },
            { onConflict: 'application_id,doc_key' },
          )
          .select('*')
          .single()
        if (error) throw toBackendError(error)
        return mapApplicationDocument(data as ApplicationDocumentRow)
      } catch (err) {
        throw toBackendError(err)
      }
    },

    async getMissingDocuments(applicationId, schemeId) {
      assertApplicationId(applicationId)
      let spec
      try {
        spec = getSchemeApplicationSpec(schemeId)
      } catch (err) {
        throw new BackendError('VALIDATION', err instanceof Error ? err.message : 'Unknown scheme')
      }
      try {
        const { data, error } = await client
          .from('application_documents')
          .select('*')
          .eq('application_id', applicationId)
        if (error) throw toBackendError(error)
        const existing = ((data ?? []) as ApplicationDocumentRow[]).map(mapApplicationDocument)
        return computeMissingDocuments(spec.documents, existing)
      } catch (err) {
        throw toBackendError(err)
      }
    },
  }
}
