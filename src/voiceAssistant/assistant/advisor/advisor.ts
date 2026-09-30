import { applyCorrection } from '../../application/corrections'
import { buildCriteriaReport, type CriteriaReport } from '../../application/criteria'
import { mergeDocumentStatement, type DocumentDeclarations, type DocumentKind } from '../../application/documents'
import { extractCitizenFacts, type ApplicantDetails } from '../../application/extraction'
import { feasibilityReadiness, type FeasibilityReadiness, type FeasibilityState } from '../../application/feasibility'
import { buildApplicationForm, type ApplicationForm, type MissingItem } from '../../application/requirements'
import type { DocumentDeclaration } from '../../../apply/types'
import { assessReadiness, type ReadinessAssessment } from '../../../assistant/conversation/readiness'
import { identifyMissingFields, type MissingFieldInfo } from '../../../assistant/missingFields'
import { mergeProfile } from '../../../assistant/profileExtraction'
import { rankSchemes } from '../../../assistant/ranking'
import { EMPTY_PROFILE, type EligibilityStatus, type RankedScheme, type UserProfile } from '../../../assistant/types'

/**
 * The one authoritative advisor state. Live speech transcripts, typed text,
 * Gemini's tool calls and review-screen corrections all change it here, and
 * the profile, ranking, application form, reports and readiness the UI and
 * Gemini see are all derived from it by deriveAdvisorView.
 */
export interface AdvisorState {
  profile: UserProfile
  details: ApplicantDetails
  documents: DocumentDeclarations
  /**
   * Keyword query text for retrieval. Only an explicit findSchemes focus sets
   * it: ranking on every sentence let unrelated words ("right now" matches
   * "known") reshuffle the list with no new facts.
   */
  query: string
  /** A scheme the citizen chose to apply for. Null means the application follows the live top match. */
  applicationSchemeId: string | null
  /** A scheme opened for reading. Null shows the scheme being applied for. */
  detailSchemeId: string | null
  revision: number
}

export const INITIAL_ADVISOR_STATE: AdvisorState = {
  profile: EMPTY_PROFILE,
  details: {},
  documents: {},
  query: '',
  applicationSchemeId: null,
  detailSchemeId: null,
  revision: 0,
}

export type AdvisorField = keyof UserProfile | keyof ApplicantDetails | `document:${DocumentKind}`

export interface IngestResult {
  state: AdvisorState
  updatedFields: AdvisorField[]
}

function factFields(text: string): { facts: ReturnType<typeof extractCitizenFacts>; fields: AdvisorField[] } {
  const facts = extractCitizenFacts(text)
  const { all, ...named } = facts.documents
  const fields: AdvisorField[] = [
    ...(Object.keys(facts.profile) as AdvisorField[]),
    ...(Object.keys(facts.details) as AdvisorField[]).filter((field) => field !== 'stateInferredFromDistrict'),
    ...(Object.keys(named) as DocumentKind[]).map((kind) => `document:${kind}` as const),
  ]
  if (all) fields.push('document:aadhaar')
  return { facts, fields }
}

/** Every field an utterance carries evidence for, whether or not it is already known. */
export function recognisedFields(text: string): AdvisorField[] {
  return factFields(text).fields
}

export function ingestUtterance(state: AdvisorState, text: string): IngestResult {
  const utterance = text.trim()
  if (!utterance) return { state, updatedFields: [] }

  const { facts } = factFields(utterance)
  const { profile: mergedProfile, updatedFields } = mergeProfile(state.profile, facts.profile)
  let profile = mergedProfile
  const details: ApplicantDetails = { ...state.details }
  const changed: AdvisorField[] = [...updatedFields]

  for (const [key, value] of Object.entries(facts.details) as Array<[keyof ApplicantDetails, ApplicantDetails[keyof ApplicantDetails]]>) {
    if (key === 'stateInferredFromDistrict' || value === undefined || details[key] === value) continue
    Object.assign(details, { [key]: value })
    changed.push(key)
  }

  if (facts.profile.state) {
    delete details.stateInferredFromDistrict
  } else if (facts.details.stateInferredFromDistrict && !profile.state) {
    profile = { ...profile, state: facts.details.stateInferredFromDistrict }
    details.stateInferredFromDistrict = facts.details.stateInferredFromDistrict
    changed.push('state')
  }

  const documents = mergeDocumentStatement(state.documents, facts.documents)
  for (const kind of Object.keys(documents) as DocumentKind[]) {
    if (documents[kind] !== state.documents[kind]) changed.push(`document:${kind}`)
  }

  if (changed.length === 0 && details.stateInferredFromDistrict === state.details.stateInferredFromDistrict) {
    return { state, updatedFields: [] }
  }
  return {
    state: { ...state, profile, details, documents, revision: state.revision + 1 },
    updatedFields: changed,
  }
}

/** findSchemes: a focus is ingested like any utterance (as in the main prototype) and steers retrieval keywords. */
export function focusSearch(state: AdvisorState, focus: string | undefined): IngestResult {
  const query = focus?.trim() ?? ''
  const ingested = query ? ingestUtterance(state, query) : { state, updatedFields: [] }
  if (ingested.state.query === query) return ingested
  return {
    state: { ...ingested.state, query, revision: ingested.state.revision + 1 },
    updatedFields: ingested.updatedFields,
  }
}

export function showSchemeDetails(state: AdvisorState, schemeId: string | null): AdvisorState {
  if (state.detailSchemeId === schemeId) return state
  return { ...state, detailSchemeId: schemeId, revision: state.revision + 1 }
}

/** Only the citizen's own choice pins the application; null returns it to the live top match. */
export function chooseApplicationScheme(state: AdvisorState, schemeId: string | null): AdvisorState {
  if (state.applicationSchemeId === schemeId && state.detailSchemeId === null) return state
  return { ...state, applicationSchemeId: schemeId, detailSchemeId: null, revision: state.revision + 1 }
}

export function correctField(state: AdvisorState, key: string, value: string): { state: AdvisorState; error?: string } {
  const result = applyCorrection(state.profile, state.details, key, value)
  if (!result.ok) return { state, error: result.error }
  return { state: { ...state, profile: result.profile, details: result.details, revision: state.revision + 1 } }
}

export function setDocumentDeclaration(state: AdvisorState, kind: DocumentKind, declaration: DocumentDeclaration): AdvisorState {
  if (state.documents[kind] === declaration) return state
  return { ...state, documents: { ...state.documents, [kind]: declaration }, revision: state.revision + 1 }
}

export interface SchemeMatch {
  id: string
  name: string
  shortName: string
  scope: 'central' | 'state'
  /**
   * The main ranking's rankScore (70% eligibility, 30% relevance) — the
   * number the list is sorted by within a status tier, and the matchScore the
   * main prototype's voice tools report.
   */
  matchPercent: number
  /** The main eligibility engine's own 0-100 score. */
  eligibilityScore: number
  status: EligibilityStatus
  confidence: 'low' | 'medium' | 'high'
  reasons: string[]
  mismatchReasons: string[]
  missingInfo: string[]
  /** Status tier then rankScore — the main prototype's sort order. */
  rank: number
}

export interface AdvisorView {
  revision: number
  profile: UserProfile
  details: ApplicantDetails
  documents: DocumentDeclarations
  ranked: RankedScheme[]
  matches: SchemeMatch[]
  /** The best match that is not ruled out, or null when nothing plausible remains. */
  top: SchemeMatch | null
  /** The scheme whose form is being filled. */
  applicationMatch: SchemeMatch | null
  /** The scheme shown in the details panel. */
  detailSchemeId: string | null
  missingFields: MissingFieldInfo[]
  readiness: ReadinessAssessment
  application: ApplicationForm | null
  /**
   * The form of every scheme that is not ruled out, keyed by scheme id, all filled from the same
   * answers: the details every scheme asks for fill every form at once, and each form adds only
   * its own scheme's extra fields and documents. The application's own form is the same object.
   */
  forms: Record<string, ApplicationForm>
  criteria: CriteriaReport | null
  feasibilityInputs: FeasibilityReadiness
  feasibility: FeasibilityState
  /** Scheme form fields, then documents, then the feasibility report's own inputs. */
  nextQuestion: MissingItem | null
}

function toMatch(ranked: RankedScheme, index: number): SchemeMatch {
  const { scheme, eligibility } = ranked
  return {
    id: scheme.id,
    name: scheme.name,
    shortName: scheme.shortName ?? scheme.name,
    scope: scheme.scope,
    matchPercent: ranked.rankScore,
    eligibilityScore: eligibility.score,
    status: eligibility.status,
    confidence: eligibility.confidence,
    reasons: eligibility.reasons,
    mismatchReasons: eligibility.mismatchReasons,
    missingInfo: eligibility.missingInfo,
    rank: index + 1,
  }
}

export function knownProfileFields(profile: UserProfile): Array<keyof UserProfile> {
  return (Object.keys(profile) as Array<keyof UserProfile>).filter(
    (key) => key !== 'rawNotes' && profile[key] !== undefined && profile[key] !== '',
  )
}

function defaultFeasibility(inputs: FeasibilityReadiness): FeasibilityState {
  if (inputs.ready) return { status: 'computing' }
  if (inputs.unsupportedReason) return { status: 'unsupported', reason: inputs.unsupportedReason }
  return { status: 'waiting', missing: inputs.missing }
}

export function deriveAdvisorView(state: AdvisorState, feasibility?: FeasibilityState): AdvisorView {
  const { profile, details } = state
  // With nothing known, every scheme scores on baseline alone; listing those would be a guess, not a match.
  const ranked = knownProfileFields(profile).length > 0 ? rankSchemes(profile, state.query || undefined) : []
  const matches = ranked.map(toMatch)
  const top = matches[0] && matches[0].status !== 'likely_ineligible' ? matches[0] : null
  const missingFields = identifyMissingFields(profile)
  const readiness = assessReadiness({ userProfile: profile, ranked, missingFields })

  const chosenIndex = state.applicationSchemeId ? ranked.findIndex((r) => r.scheme.id === state.applicationSchemeId) : -1
  const applicationIndex = chosenIndex >= 0 ? chosenIndex : top ? 0 : -1
  const applicationRanked = applicationIndex >= 0 ? ranked[applicationIndex] : undefined
  const formFor = (schemeId: string, basis: ApplicationForm['basis']) =>
    buildApplicationForm({ schemeId, basis, profile, details, documents: state.documents })
  const application = applicationRanked ? formFor(applicationRanked.scheme.id, chosenIndex >= 0 ? 'chosen' : 'top_match') : null
  const forms: Record<string, ApplicationForm> = {}
  for (const match of matches) {
    if (match.id === application?.schemeId) forms[match.id] = application
    else if (match.status !== 'likely_ineligible') forms[match.id] = formFor(match.id, 'matching')
  }
  const criteria = applicationRanked ? buildCriteriaReport(profile, applicationRanked.scheme) : null

  const feasibilityInputs = feasibilityReadiness(profile, details)
  const detailId = state.detailSchemeId && ranked.some((r) => r.scheme.id === state.detailSchemeId) ? state.detailSchemeId : null

  let nextQuestion: MissingItem | null = null
  if (application) {
    // Every other LokScore input is also a required field on every scheme form, so it is asked there.
    const feasibilityExtras: MissingItem[] = feasibilityInputs.ready
      ? []
      : feasibilityInputs.missing
          .filter((item) => item.key === 'district' || item.key === 'experience_years')
          .map((item) => ({ kind: 'feasibility' as const, key: item.key, label: item.label, question: item.question }))
    const fields = application.missing.filter((item) => item.kind === 'field')
    const documents = application.missing.filter((item) => item.kind === 'document')
    nextQuestion = fields[0] ?? feasibilityExtras[0] ?? documents[0] ?? null
  } else if (missingFields[0]) {
    nextQuestion = { kind: 'field', key: missingFields[0].field, label: missingFields[0].field, question: missingFields[0].question }
  }

  return {
    revision: state.revision,
    profile,
    details,
    documents: state.documents,
    ranked,
    matches,
    top,
    applicationMatch: applicationIndex >= 0 ? matches[applicationIndex] : null,
    detailSchemeId: detailId,
    missingFields,
    readiness,
    application,
    forms,
    criteria,
    feasibilityInputs,
    feasibility: feasibility ?? defaultFeasibility(feasibilityInputs),
    nextQuestion,
  }
}
