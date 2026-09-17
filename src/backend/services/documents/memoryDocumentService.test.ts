import { describe, expect, it } from 'vitest'
import { getSchemeApplicationSpec } from '../../../apply/catalog'
import { BackendError } from '../../errors'
import { createMemoryDocumentService } from './memoryDocumentService'

const SCHEME_ID = 'nsfdc-micro-finance'
const APPLICATION_ID = 'LP-APP-0123456789ABCDEF'

describe('createMemoryDocumentService', () => {
  it('lists no documents for an application that has none yet', async () => {
    const svc = createMemoryDocumentService()
    expect(await svc.listForApplication(APPLICATION_ID)).toEqual([])
  })

  it('upserts a document keyed by (applicationId, docKey), replacing not duplicating on re-upsert', async () => {
    const svc = createMemoryDocumentService()
    const spec = getSchemeApplicationSpec(SCHEME_ID)
    const docKey = spec.documents[0]!.key

    await svc.upsertDocument({ applicationId: APPLICATION_ID, docKey, declaration: 'missing' })
    const updated = await svc.upsertDocument({
      applicationId: APPLICATION_ID,
      docKey,
      declaration: 'declared_available',
      storagePath: 'docs/x.pdf',
    })

    const list = await svc.listForApplication(APPLICATION_ID)
    expect(list).toHaveLength(1)
    expect(list[0]?.id).toBe(updated.id)
    expect(list[0]?.declaration).toBe('declared_available')
    expect(list[0]?.storagePath).toBe('docs/x.pdf')
  })

  it('reports every required doc as missing when none have been declared', async () => {
    const svc = createMemoryDocumentService()
    const spec = getSchemeApplicationSpec(SCHEME_ID)

    const missing = await svc.getMissingDocuments(APPLICATION_ID, SCHEME_ID)
    expect(missing.map((d) => d.key).sort()).toEqual(spec.documents.filter((d) => d.required).map((d) => d.key).sort())
  })

  it('drops a document from the missing list once its declaration is no longer "missing"', async () => {
    const svc = createMemoryDocumentService()
    const spec = getSchemeApplicationSpec(SCHEME_ID)
    const firstKey = spec.documents[0]!.key

    await svc.upsertDocument({ applicationId: APPLICATION_ID, docKey: firstKey, declaration: 'will_submit_on_portal' })
    const missing = await svc.getMissingDocuments(APPLICATION_ID, SCHEME_ID)
    expect(missing.some((d) => d.key === firstKey)).toBe(false)
  })

  it('rejects an unknown schemeId rather than inventing a requirement', async () => {
    const svc = createMemoryDocumentService()
    await expect(svc.getMissingDocuments(APPLICATION_ID, 'not-a-real-scheme')).rejects.toThrow(BackendError)
  })

  it('rejects a non LP-APP-* applicationId', async () => {
    const svc = createMemoryDocumentService()
    await expect(svc.listForApplication('not-an-lp-app-id')).rejects.toThrow(BackendError)
  })
})
