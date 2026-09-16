import { getDocumentChecklist } from '../lib/documentChecklist'
import type { SchemeId } from '../lib/finance'
import type { DocumentRecord } from './types'

export function buildInitialDocuments(schemeId: SchemeId): DocumentRecord[] {
  return getDocumentChecklist(schemeId).map((item, i) => ({
    id: `doc-${i}`,
    labelEn: item.en,
    labelKn: item.kn,
    status: 'missing',
  }))
}
