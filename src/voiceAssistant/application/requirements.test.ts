import { describe, expect, it } from 'vitest'
import { getSchemeApplicationSpec } from '../../apply/catalog'
import type { UserProfile } from '../../assistant/types'
import { DOCUMENT_KIND_LABEL, documentApplies, documentKind, type DocumentDeclarations, type DocumentKind } from './documents'
import type { ApplicantDetails } from './extraction'
import { buildApplicationForm } from './requirements'

const FULL: UserProfile = {
  rawNotes: [],
  state: 'Karnataka',
  district: 'Mandya',
  areaType: 'rural',
  age: 32,
  gender: 'female',
  socialCategory: 'sc',
  annualIncome: 180_000,
  businessSector: 'dairy',
  proposedBusiness: 'dairy unit with two cows',
  businessStage: 'new',
  businessStatus: 'idea',
  financingRequired: 500_000,
  ownContribution: 50_000,
  education: '10th',
}
const DETAILS: ApplicantDetails = { applicantName: 'Lakshmi Devi', mobile: '9845012345', experienceYears: 3 }
const ALL_DOCS = Object.fromEntries(Object.keys(DOCUMENT_KIND_LABEL).map((kind) => [kind, 'declared_available'])) as DocumentDeclarations

const form = (schemeId: string, profile: UserProfile = FULL, details: ApplicantDetails = DETAILS, documents: DocumentDeclarations = ALL_DOCS) =>
  buildApplicationForm({ schemeId, basis: 'top_match', profile, details, documents })

describe('scheme-specific application form', () => {
  it('uses the main catalog fields for each scheme, including scheme-only fields', () => {
    for (const schemeId of ['pm-mudra-yojana', 'pmegp', 'kudumbashree-microenterprise', 'nsfdc-term-loan']) {
      const spec = getSchemeApplicationSpec(schemeId)
      const built = form(schemeId, { rawNotes: [] }, {}, {})
      expect(built.fields.map((f) => f.key)).toEqual(spec.fields.map((f) => f.key))
      expect(built.readiness.fieldsTotal).toBe(spec.fields.filter((f) => f.required).length)
      expect(built.documents.map((d) => d.label)).toEqual(spec.documents.map((d) => d.label))
    }
    expect(form('kudumbashree-microenterprise').fields.find((f) => f.key === 'nhg_membership')?.required).toBe(true)
    expect(form('pm-mudra-yojana').fields.some((f) => f.key === 'nhg_membership')).toBe(false)
    expect(form('pmegp').fields.find((f) => f.key === 'education')?.required).toBe(true)
    expect(form('pm-mudra-yojana').fields.find((f) => f.key === 'education')?.required).toBe(false)
  })

  it('every curated document label is classified into a document kind', () => {
    for (const schemeId of ['nsfdc-micro-finance', 'nsfdc-term-loan', 'pmegp', 'pm-mudra-yojana', 'stand-up-india', 'pm-vishwakarma', 'nbcfdc-term-loan', 'kudumbashree-microenterprise']) {
      for (const doc of getSchemeApplicationSpec(schemeId).documents) expect(documentKind(doc.label), doc.label).not.toBeNull()
    }
  })

  it('an empty profile is 0% with every required field missing, asked in form order', () => {
    const built = form('pm-mudra-yojana', { rawNotes: [] }, {}, {})
    expect(built.readiness.percent).toBe(0)
    expect(built.readiness.canSubmit).toBe(false)
    expect(built.missing[0]).toMatchObject({ kind: 'field', key: 'applicant_name' })
    const firstDocument = built.missing.findIndex((m) => m.kind === 'document')
    expect(built.missing.slice(0, firstDocument).every((m) => m.kind === 'field')).toBe(true)
  })

  it('readiness percent is (required fields done + documents declared) / all required, rounded', () => {
    const partial: UserProfile = { rawNotes: [], age: 32, gender: 'female', state: 'Karnataka' }
    const built = form('pm-mudra-yojana', partial, { applicantName: 'Lakshmi Devi' }, { aadhaar: 'declared_available' })
    const { fieldsDone, fieldsTotal, documentsDone, documentsTotal, percent } = built.readiness
    expect(fieldsDone).toBe(4)
    expect(documentsDone).toBe(1)
    expect(percent).toBe(Math.round(((fieldsDone + documentsDone) / (fieldsTotal + documentsTotal)) * 100))
  })

  it('a complete application is 100% and main prepareApplication produces the packet', () => {
    const built = form('pm-mudra-yojana')
    expect(built.readiness.percent).toBe(100)
    expect(built.readiness.canSubmit).toBe(true)
    expect(built.missing).toEqual([])
    expect(built.prepared.packet?.schemeId).toBe('pm-mudra-yojana')
    expect(built.prepared.completedSteps).toContain('generated_application')
  })

  it('a document whose own label condition does not hold is not applicable and does not block', () => {
    const general = { ...FULL, socialCategory: 'general' as const }
    const pmegp = form('pmegp', general, DETAILS, { ...ALL_DOCS, caste: 'missing' })
    expect(pmegp.documents.find((d) => d.kind === 'caste')?.status).toBe('not_applicable')
    expect(pmegp.readiness.canSubmit).toBe(true)

    const sc = form('pmegp', FULL, DETAILS, { ...ALL_DOCS, caste: 'missing' })
    expect(sc.documents.find((d) => d.kind === 'caste')?.status).toBe('missing')
    expect(sc.readiness.canSubmit).toBe(false)

    const mudraNew = form('pm-mudra-yojana', FULL, DETAILS, { ...ALL_DOCS, business_proof: 'missing' })
    expect(mudraNew.documents.find((d) => d.kind === 'business_proof')?.status).toBe('not_applicable')
    expect(documentApplies('Proof of business existence, if already operating', { rawNotes: [] })).toBe(true)
  })

  it('a loan worked out from project cost minus own money needs the citizen to confirm it', () => {
    const derived: UserProfile = { ...FULL, financingRequired: undefined, investmentRequired: 600_000, ownContribution: 100_000 }
    const loan = form('pm-mudra-yojana', derived).fields.find((f) => f.key === 'loan_amount_requested')
    expect(loan?.value).toBe(500_000)
    expect(loan?.status).toBe('needs_confirmation')
    expect(loan?.note).toMatch(/confirm/i)
  })

  it('a state taken from the district needs confirmation', () => {
    const state = form('pm-mudra-yojana', FULL, { ...DETAILS, stateInferredFromDistrict: 'Karnataka' }).fields.find((f) => f.key === 'state')
    expect(state?.status).toBe('needs_confirmation')
  })

  it('a value that fails the scheme validation is flagged, not counted, and asked again', () => {
    const max = getSchemeApplicationSpec('pm-mudra-yojana').fields.find((f) => f.key === 'loan_amount_requested')?.maxValue
    expect(max).toBeDefined()
    const built = form('pm-mudra-yojana', { ...FULL, financingRequired: max! + 100_000 })
    const loan = built.fields.find((f) => f.key === 'loan_amount_requested')
    expect(loan?.status).toBe('needs_confirmation')
    expect(built.readiness.canSubmit).toBe(false)
    expect(built.missing.map((m) => m.key)).toContain('loan_amount_requested')
    expect(built.readiness.percent).toBeLessThan(100)
  })

  it('the same facts carry over when the form switches scheme', () => {
    const mudra = form('pm-mudra-yojana', FULL, DETAILS, {})
    const kudumbashree = form('kudumbashree-microenterprise', FULL, DETAILS, {})
    const shared = mudra.fields.filter((f) => kudumbashree.fields.some((k) => k.key === f.key))
    for (const field of shared) expect(kudumbashree.fields.find((k) => k.key === field.key)?.value).toEqual(field.value)
    expect(kudumbashree.missing[0]).toMatchObject({ key: 'nhg_membership' })
  })

  it('document kinds map to readable labels', () => {
    for (const kind of Object.keys(DOCUMENT_KIND_LABEL) as DocumentKind[]) expect(DOCUMENT_KIND_LABEL[kind].length).toBeGreaterThan(3)
  })
})
