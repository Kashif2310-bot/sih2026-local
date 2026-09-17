/**
 * Application document metadata contracts (Option A / LP-APP-*).
 *
 * Wraps the already-existing public.application_documents table exactly as
 * reconciled upstream (doc_key/label/declaration/storage_path/content_hash/
 * metadata) — no new columns are introduced here. Raw files stay in Supabase
 * Storage; this is metadata/declaration only, distinct from the legacy
 * contracts/application.ts ApplicationDocumentMeta (UUID model, compat-only).
 */

import type { DocumentDeclaration } from '../apply/types'

export type { DocumentDeclaration }

export interface ApplicationDocumentRecord {
  id: string
  applicationId: string
  docKey: string
  label: string
  declaration: DocumentDeclaration
  storagePath: string | null
  contentHash: string | null
  metadata: Record<string, unknown>
  createdAt: string
}

export interface UpsertApplicationDocumentInput {
  applicationId: string
  docKey: string
  label?: string
  declaration: DocumentDeclaration
  storagePath?: string | null
  contentHash?: string | null
  metadata?: Record<string, unknown>
}
