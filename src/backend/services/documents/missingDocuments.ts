/**
 * Pure gap check: which of a scheme's declared document requirements are
 * not yet addressed by the application's current documents. Deterministic —
 * never invents a requirement, never guesses at a document's authenticity.
 *
 * Requirements come from Adita's own getSchemeApplicationSpec() catalog
 * (src/apply/catalog.ts) — the same source application_documents.doc_key
 * values are seeded from — not the legacy contracts/scheme.ts
 * SchemeDocumentRequirement list, which belongs to the deprecated UUID
 * scheme registry and uses a different key vocabulary (docType, not key).
 */

import type { ApplicationDocumentSpec } from '../../../apply/types'
import type { ApplicationDocumentRecord } from '../../../contracts/documents'

export function computeMissingDocuments(
  required: ApplicationDocumentSpec[],
  existing: ApplicationDocumentRecord[],
): ApplicationDocumentSpec[] {
  const addressed = new Set(existing.filter((d) => d.declaration !== 'missing').map((d) => d.docKey))
  return required.filter((r) => r.required && !addressed.has(r.key))
}
