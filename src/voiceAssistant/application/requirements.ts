import { getSchemeApplicationSpec } from '../../apply/catalog'
import { fieldsToRecord } from '../../apply/mapping'
import type {
  DocumentDeclaration,
  FilingChannel,
  MappedDocument,
  MappedField,
  PreparedApplication,
  ValidationIssue,
  WorkflowStep,
} from '../../apply/types'
import { canSubmit, validateDocuments } from '../../apply/validation'
import { prepareApplication } from '../../apply/workflow'
import { normalizeSectorLabel } from '../../assistant/lexicon'
import type { UserProfile } from '../../assistant/types'
import { documentApplies, documentKind, type DocumentDeclarations, type DocumentKind } from './documents'
import type { ApplicantDetails } from './extraction'

export type FieldGroup = 'applicant' | 'location' | 'business' | 'finance'
export type FieldStatus = 'complete' | 'missing' | 'optional' | 'needs_confirmation'

export const GROUP_LABEL: Record<FieldGroup, string> = {
  applicant: 'Applicant',
  location: 'Location',
  business: 'Business',
  finance: 'Finance',
}

const FIELD_GROUP: Record<string, FieldGroup> = {
  applicant_name: 'applicant',
  mobile: 'applicant',
  age: 'applicant',
  gender: 'applicant',
  social_category: 'applicant',
  annual_income: 'applicant',
  education: 'applicant',
  nhg_membership: 'applicant',
  state: 'location',
  district: 'location',
  area_type: 'location',
  business_sector: 'business',
  proposed_business: 'business',
  business_stage: 'business',
  loan_amount_requested: 'finance',
  own_contribution: 'finance',
}

/** What Ishaara asks for each scheme form field, in plain words. */
export const FIELD_QUESTION: Record<string, string> = {
  applicant_name: 'What is your full name, as written on your Aadhaar?',
  mobile: 'What is your 10-digit mobile number?',
  age: 'How old are you?',
  gender: 'May I record your gender?',
  social_category: 'Which social category do you belong to: SC, ST, OBC or General?',
  annual_income: "What is your family's yearly income, roughly?",
  education: 'What is your highest education, for example 8th, 10th or 12th pass?',
  nhg_membership: 'What is the name or membership number of your Kudumbashree neighbourhood group?',
  state: 'Which state do you live in?',
  district: 'Which district do you live in?',
  area_type: 'Do you live in a village or a town or city?',
  business_sector: 'What kind of business is it, for example dairy, tailoring or a shop?',
  proposed_business: 'Can you describe the business in a few words?',
  business_stage: 'Is this a new business, or are you expanding one you already run?',
  loan_amount_requested: 'How much loan do you need?',
  own_contribution: 'How much of your own money can you put in?',
}

export interface FormField {
  key: string
  label: string
  group: FieldGroup
  required: boolean
  value: string | number | boolean | undefined
  display: string | null
  source: MappedField['source']
  status: FieldStatus
  /** Why a value needs the citizen's confirmation, or a blocking problem with it. */
  note?: string
  helpText?: string
  question: string
}

export type DocumentStatus = 'complete' | 'missing' | 'not_applicable'

export interface FormDocument {
  key: string
  label: string
  kind: DocumentKind | null
  required: boolean
  declaration: DocumentDeclaration
  status: DocumentStatus
}

export interface MissingItem {
  kind: 'field' | 'document' | 'feasibility'
  key: string
  label: string
  question: string
}

export interface ApplicationReadiness {
  fieldsDone: number
  fieldsTotal: number
  documentsDone: number
  documentsTotal: number
  /** (required fields filled + required documents declared) / (all required fields + documents), rounded. */
  percent: number
  blocking: ValidationIssue[]
  canSubmit: boolean
}

export interface ApplicationForm {
  schemeId: string
  schemeName: string
  /** Whether the form follows the live top match or a scheme the citizen chose to apply for. */
  /** Matching: filled from the same answers alongside the application, not being applied for. */
  basis: 'top_match' | 'chosen' | 'matching'
  channel: FilingChannel
  channelRationale: string
  officialInfoUrl: string
  officialApplicationUrl: string
  fields: FormField[]
  documents: FormDocument[]
  readiness: ApplicationReadiness
  /** Scheme fields first, then documents: what Ishaara still has to ask, in order. */
  missing: MissingItem[]
  /** Main's prepared application, with documents whose own label condition does not apply marked not required. */
  prepared: PreparedApplication
}

const CATEGORY: Record<string, string> = { sc: 'SC', st: 'ST', obc: 'OBC', general: 'General' }
const STAGE: Record<string, string> = { idea: 'Idea stage', new: 'New business', existing_expansion: 'Expanding existing' }

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

export function formatRupees(value: number): string {
  const trim = (n: number) => String(Math.round(n * 100) / 100)
  if (value >= 10_000_000) return `₹${trim(value / 10_000_000)} crore`
  if (value >= 100_000) return `₹${trim(value / 100_000)} lakh`
  return `₹${value.toLocaleString('en-IN')}`
}

export function displayFieldValue(key: string, value: MappedField['value']): string | null {
  if (value === undefined || value === '') return null
  if (typeof value === 'number') return key === 'age' ? `${value}` : formatRupees(value)
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  switch (key) {
    case 'social_category':
      return CATEGORY[value] ?? value
    case 'business_stage':
      return STAGE[value] ?? value
    case 'business_sector':
    case 'area_type':
    case 'gender':
      return capitalize(normalizeSectorLabel(value))
    default:
      return value
  }
}

export function detailOverrides(details: ApplicantDetails): Record<string, string | undefined> {
  return { applicant_name: details.applicantName, mobile: details.mobile, nhg_membership: details.nhgMembership }
}

export function declarationsByKey(
  documents: Array<{ key: string; label: string }>,
  declarations: DocumentDeclarations,
): Record<string, DocumentDeclaration> {
  const out: Record<string, DocumentDeclaration> = {}
  for (const doc of documents) {
    const kind = documentKind(doc.label)
    const declaration = kind ? declarations[kind] : undefined
    if (declaration) out[doc.key] = declaration
  }
  return out
}

/**
 * Runs the main prototype's prepareApplication — the same function the
 * submission uses — and applies one documented adjustment: a document whose
 * curated label states a condition the applicant does not meet is not
 * required of them.
 */
export function prepareForApplicant(
  schemeId: string,
  profile: UserProfile,
  details: ApplicantDetails,
  declarations: DocumentDeclarations,
): PreparedApplication {
  const byKey = declarationsByKey(getSchemeApplicationSpec(schemeId).documents, declarations)
  const raw = prepareApplication({ schemeId, profile, fieldOverrides: detailOverrides(details), documentDeclarations: byKey })

  const documents: MappedDocument[] = raw.documents.map((doc) =>
    documentApplies(doc.label, profile) ? doc : { ...doc, required: false },
  )
  const issues = [...raw.issues.filter((issue) => issue.code !== 'missing_document'), ...validateDocuments(documents)]
  const ready = canSubmit(issues)
  const channel = raw.scheme.channel.recommended
  const packet = ready
    ? {
        schemeId: raw.scheme.schemeId,
        schemeName: raw.scheme.displayName,
        channel,
        fields: fieldsToRecord(raw.mappedFields),
        documents: documents
          .filter((doc) => doc.required || doc.declaration !== 'missing')
          .map((doc) => ({ key: doc.key, label: doc.label, declaration: doc.declaration })),
        officialApplicationUrl: raw.scheme.officialApplicationUrl,
        generatedAt: new Date().toISOString(),
      }
    : null
  const completedSteps: WorkflowStep[] = raw.completedSteps.filter((step) => step !== 'generated_application')
  if (packet) completedSteps.push('generated_application')
  return { ...raw, documents, issues, canPreparePacket: ready, packet, completedSteps }
}

function fieldStatus(
  field: MappedField,
  profile: UserProfile,
  details: ApplicantDetails,
  issue: ValidationIssue | undefined,
): { status: FieldStatus; note?: string } {
  const filled = field.value !== undefined && field.value !== ''
  if (!filled) return { status: field.required ? 'missing' : 'optional' }
  if (issue) return { status: 'needs_confirmation', note: issue.message }
  if (field.key === 'loan_amount_requested' && profile.financingRequired === undefined) {
    return {
      status: 'needs_confirmation',
      note: 'Worked out as your project cost minus your own contribution. Please confirm the loan amount.',
    }
  }
  if (field.key === 'state' && details.stateInferredFromDistrict === field.value) {
    return { status: 'needs_confirmation', note: `Taken from your district (${profile.district}). Please confirm your state.` }
  }
  return { status: 'complete' }
}

export function buildApplicationForm(input: {
  schemeId: string
  basis: ApplicationForm['basis']
  profile: UserProfile
  details: ApplicantDetails
  documents: DocumentDeclarations
}): ApplicationForm {
  const { profile, details } = input
  const prepared = prepareForApplicant(input.schemeId, profile, details, input.documents)
  const blockingByField = new Map<string, ValidationIssue>()
  for (const issue of prepared.issues) {
    if (issue.blocking && issue.field && issue.code !== 'missing_field' && issue.code !== 'missing_document') {
      blockingByField.set(issue.field, issue)
    }
  }

  const fields: FormField[] = prepared.mappedFields.map((field) => {
    const { status, note } = fieldStatus(field, profile, details, blockingByField.get(field.key))
    return {
      key: field.key,
      label: field.label,
      group: FIELD_GROUP[field.key] ?? 'business',
      required: field.required,
      value: field.value,
      display: displayFieldValue(field.key, field.value),
      source: field.source,
      status,
      note,
      helpText: field.helpText,
      question: FIELD_QUESTION[field.key] ?? `What should I enter for "${field.label}"?`,
    }
  })

  const documents: FormDocument[] = prepared.documents.map((doc) => {
    const applies = documentApplies(doc.label, profile)
    return {
      key: doc.key,
      label: doc.label,
      kind: documentKind(doc.label),
      required: doc.required,
      declaration: doc.declaration,
      status: !applies ? 'not_applicable' : doc.declaration === 'missing' ? 'missing' : 'complete',
    }
  })

  const requiredFields = fields.filter((field) => field.required)
  const requiredDocuments = documents.filter((doc) => doc.required)
  const fieldsDone = requiredFields.filter((field) => field.status === 'complete' || (field.status === 'needs_confirmation' && !blockingByField.has(field.key))).length
  const documentsDone = requiredDocuments.filter((doc) => doc.status === 'complete').length
  const total = requiredFields.length + requiredDocuments.length

  const missing: MissingItem[] = [
    ...requiredFields
      .filter((field) => field.status === 'missing' || blockingByField.has(field.key))
      .map((field) => ({ kind: 'field' as const, key: field.key, label: field.label, question: field.question })),
    ...requiredDocuments
      .filter((doc) => doc.status === 'missing')
      .map((doc) => ({
        kind: 'document' as const,
        key: doc.key,
        label: doc.label,
        question: `Do you have your ${doc.label.replace(/,.*$/, '').toLowerCase()} ready?`,
      })),
  ]

  return {
    schemeId: prepared.scheme.schemeId,
    schemeName: prepared.scheme.displayName,
    basis: input.basis,
    channel: prepared.scheme.channel.recommended,
    channelRationale: prepared.scheme.channel.rationale,
    officialInfoUrl: prepared.scheme.officialInfoUrl,
    officialApplicationUrl: prepared.scheme.officialApplicationUrl,
    fields,
    documents,
    readiness: {
      fieldsDone,
      fieldsTotal: requiredFields.length,
      documentsDone,
      documentsTotal: requiredDocuments.length,
      percent: total === 0 ? 0 : Math.round(((fieldsDone + documentsDone) / total) * 100),
      blocking: prepared.issues.filter((issue) => issue.blocking),
      canSubmit: prepared.canPreparePacket,
    },
    missing,
    prepared,
  }
}
