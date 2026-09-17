/**
 * ApplicantProfile — the shared, cross-workstream interoperability contract
 * for "what do we know about this citizen so far".
 *
 * This is NOT a replacement for either of the two existing profile types:
 *   - src/assistant/types.ts UserProfile        (AI scheme-assistant's own profile)
 *   - src/lib/lokScore.ts EntrepreneurProfile    (NSFDC cockpit's own profile)
 * Both keep their current shape and behaviour untouched. ApplicantProfile is
 * a third, neutral projection that either side can read from or write into
 * via the adapter functions below, so a future application-engine,
 * persistence layer, or voice pipeline has ONE contract to target instead of
 * two competing, subsystem-specific ones.
 *
 * Full design rationale, ownership boundaries, and consumption guidance:
 * see docs/applicant-profile.md.
 *
 * Design rules this file follows:
 *   1. Every field is optional except `rawNotes` — a profile starts empty
 *      and is enriched progressively over many turns/forms/sessions.
 *   2. No field is ever invented. Adapters only set a value when the source
 *      type actually has one; "unknown" stays absent, never a guessed default.
 *   3. Government scheme facts, eligibility/approval decisions, and LokScore
 *      values never live here — this is applicant facts only. See
 *      docs/applicant-profile.md "What does not belong" for the reasoning.
 *   4. Every populated field can carry provenance (who/what supplied it and
 *      how confident we are) so a consumer can decide how much to trust a
 *      given value — e.g. a voice-extracted guess vs. a government-verified fact.
 */

import type { BusinessCategory } from '../data/villages'
import type { EntrepreneurProfile } from '../lib/lokScore'
import type { ResolvedLocation } from '../lib/resolveLocation'
import type { UserProfile } from '../assistant/types'

export type ApplicantGender = 'male' | 'female' | 'other'
export type ApplicantSocialCategory = 'sc' | 'st' | 'obc' | 'general'
export type ApplicantAreaType = 'rural' | 'urban'
export type ApplicantBusinessStage = 'idea' | 'new' | 'existing_expansion'
export type ApplicantBusinessStatus = 'idea' | 'existing'

/**
 * The flat bag of applicant facts. Deliberately flat (not nested per
 * domain) to mirror UserProfile's existing shape and keep adapters simple —
 * a nested structure would force flatten/unflatten logic on every adapter
 * call for no real benefit here.
 *
 * Deliberately excluded (see docs/applicant-profile.md for the full list):
 *   - scheme names, eligibility scores, approval/decision state
 *   - LokScore or any of its component scores
 *   - execution-only config (which village dataset to query, search radius,
 *     demo-mode flags) — those describe how a subsystem should look
 *     something up, not a fact about the applicant.
 */
export interface ApplicantProfileData {
  // Identity
  name?: string
  age?: number
  gender?: ApplicantGender
  phone?: string

  // Location — intentionally lighter than lib/resolveLocation.ts's
  // ResolvedLocation, which also carries derived signals (competitor
  // density, mandi refs, provenance labels) that are cockpit output, not
  // applicant facts.
  state?: string
  district?: string
  villageOrTown?: string
  areaType?: ApplicantAreaType
  lat?: number
  lng?: number
  /** What the citizen actually said, before any geocoding — preserved even if geocoding later fails or is never attempted. */
  rawLocationText?: string

  // Social / category
  socialCategory?: ApplicantSocialCategory

  // Business intent
  /** Free-text description as the citizen said it, e.g. "a poultry business". */
  businessDescription?: string
  /**
   * Normalized sector/activity tag. Deliberately an open string, not a
   * closed enum — the AI assistant's vocabulary (src/assistant/lexicon.ts)
   * is larger than the NSFDC cockpit's 6-category BusinessCategory, and
   * this contract must not force one side's taxonomy onto the other.
   * A consumer that needs a closed enum maps this value itself (see
   * applicantProfileToEntrepreneurProfileDraft below for an example).
   */
  businessSector?: string
  businessStage?: ApplicantBusinessStage
  businessStatus?: ApplicantBusinessStatus
  /** Years operating, when an existing business. Informational only — never used to infer businessStage. */
  businessExperienceYears?: number

  // Financial context
  annualIncome?: number
  investmentRequired?: number
  /** "Margin money" / own contribution — the same concept as EntrepreneurProfile.availableMargin under NSFDC terminology. */
  ownContribution?: number
  financingRequired?: number
  existingLoans?: string

  // Assets / resources
  education?: string
  landOrAssets?: string

  // Conversationally discovered, not yet mapped to a structured field.
  rawNotes: string[]
}

/** Every field that can carry per-field provenance — everything except the free-form notes list. */
export type ApplicantProfileFieldKey = keyof Omit<ApplicantProfileData, 'rawNotes'>

/**
 * Where a field's current value came from. Matches the four buckets the AI
 * workstream is required to keep visibly separate, plus one honest
 * "we don't actually know" bucket for values bridged in from a legacy
 * profile that never tracked provenance itself.
 */
export type ApplicantProfileFieldSource =
  | 'user_provided'
  | 'system_derived'
  | 'ai_extracted'
  | 'government_verified'
  | 'imported_unknown'

export type ApplicantProfileFieldConfidence = 'low' | 'medium' | 'high' | 'confirmed'

export interface FieldProvenance {
  source: ApplicantProfileFieldSource
  confidence?: ApplicantProfileFieldConfidence
  /** ISO timestamp this field's current value was last set. */
  capturedAt?: string
  /** Free-text snippet the value was extracted from, when source is 'ai_extracted' — kept for auditability, never re-parsed by any consumer. */
  evidenceText?: string
}

/**
 * The full shared contract: applicant facts plus per-field provenance,
 * wrapped in a small envelope. Kept as a wrapper (`data` + `fieldProvenance`
 * as siblings) rather than flattening provenance onto the data object
 * itself, so a citizen's own field names can never collide with envelope
 * metadata.
 */
export interface ApplicantProfile {
  /** Assigned once a backend persists this profile (future Vamshi/backend concern). Absent for a profile that only exists client-side so far. */
  applicantId?: string
  data: ApplicantProfileData
  /** Only populated for fields that have actually been captured — an absent entry means "no provenance recorded", not "unknown value" (that's simply an absent field on `data`). */
  fieldProvenance: Partial<Record<ApplicantProfileFieldKey, FieldProvenance>>
  /** Last time any field on this profile changed. */
  updatedAt: string
}

/**
 * Canonical, exhaustive list of provenance-tracked field keys. Written as a
 * `Record<ApplicantProfileFieldKey, true>` (rather than a plain array
 * literal) so TypeScript itself fails the build if a field is ever added to
 * or removed from ApplicantProfileData without updating this list.
 */
const APPLICANT_FIELD_KEY_MAP: Record<ApplicantProfileFieldKey, true> = {
  name: true,
  age: true,
  gender: true,
  phone: true,
  state: true,
  district: true,
  villageOrTown: true,
  areaType: true,
  lat: true,
  lng: true,
  rawLocationText: true,
  socialCategory: true,
  businessDescription: true,
  businessSector: true,
  businessStage: true,
  businessStatus: true,
  businessExperienceYears: true,
  annualIncome: true,
  investmentRequired: true,
  ownContribution: true,
  financingRequired: true,
  existingLoans: true,
  education: true,
  landOrAssets: true,
}

export const APPLICANT_PROFILE_FIELD_KEYS = Object.keys(APPLICANT_FIELD_KEY_MAP) as ApplicantProfileFieldKey[]

export function createEmptyApplicantProfile(applicantId?: string, now: string = new Date().toISOString()): ApplicantProfile {
  return { applicantId, data: { rawNotes: [] }, fieldProvenance: {}, updatedAt: now }
}

/**
 * Sets one field's value and provenance together, so the two can never
 * drift apart. Setting `value` to `undefined` is a no-op — this contract
 * never records "unknown" as if it were a captured fact; to represent not
 * knowing something, simply don't call this for that field.
 */
export function withApplicantField<K extends ApplicantProfileFieldKey>(
  profile: ApplicantProfile,
  field: K,
  value: ApplicantProfileData[K],
  provenance: FieldProvenance,
): ApplicantProfile {
  if (value === undefined) return profile
  const now = provenance.capturedAt ?? new Date().toISOString()
  return {
    ...profile,
    data: { ...profile.data, [field]: value },
    fieldProvenance: { ...profile.fieldProvenance, [field]: { ...provenance, capturedAt: now } },
    updatedAt: now,
  }
}

/**
 * Batch form of withApplicantField, for adapters/extraction pipelines that
 * learn several fields from one turn/form submission at the same provenance.
 * Fields absent or `undefined` in `values` are left untouched.
 */
export function withApplicantFields(
  profile: ApplicantProfile,
  values: Partial<Omit<ApplicantProfileData, 'rawNotes'>>,
  provenance: FieldProvenance,
): ApplicantProfile {
  const now = provenance.capturedAt ?? new Date().toISOString()
  let data = profile.data
  let fieldProvenance = profile.fieldProvenance
  let changed = false

  for (const key of APPLICANT_PROFILE_FIELD_KEYS) {
    const value = values[key]
    if (value === undefined) continue
    changed = true
    // `key` and `value` are read together from the same `values` entry, so
    // this computed assignment is sound even though a bare `for...of` over
    // a union-typed key array loses the per-iteration correlation that a
    // per-key generic call (withApplicantField) would otherwise verify.
    data = { ...data, [key]: value } as ApplicantProfileData
    fieldProvenance = { ...fieldProvenance, [key]: { ...provenance, capturedAt: now } }
  }

  if (!changed) return profile
  return { ...profile, data, fieldProvenance, updatedAt: now }
}

/** Appends one free-text fragment the citizen said that doesn't map to a structured field yet. Ignores blank/whitespace-only notes. */
export function withRawNote(profile: ApplicantProfile, note: string, capturedAt?: string): ApplicantProfile {
  const trimmed = note.trim()
  if (!trimmed) return profile
  const now = capturedAt ?? new Date().toISOString()
  return {
    ...profile,
    data: { ...profile.data, rawNotes: [...profile.data.rawNotes, trimmed] },
    updatedAt: now,
  }
}

// ---------------------------------------------------------------------------
// Adapters — UserProfile (AI assistant) <-> ApplicantProfile
// ---------------------------------------------------------------------------

const IMPORTED_UNKNOWN: ApplicantProfileFieldSource = 'imported_unknown'

function markImported(data: ApplicantProfileData, applicantId: string | undefined, now: string): ApplicantProfile {
  const fieldProvenance: Partial<Record<ApplicantProfileFieldKey, FieldProvenance>> = {}
  for (const key of APPLICANT_PROFILE_FIELD_KEYS) {
    if (data[key] !== undefined) fieldProvenance[key] = { source: IMPORTED_UNKNOWN, capturedAt: now }
  }
  return { applicantId, data, fieldProvenance, updatedAt: now }
}

export interface FromLegacyProfileOptions {
  applicantId?: string
  now?: string
  /**
   * Override the provenance source recorded for every field this adapter
   * populates. Defaults to 'imported_unknown' because UserProfile/
   * EntrepreneurProfile don't themselves track per-field provenance, so at
   * adapter time we honestly don't know whether a given value was directly
   * stated, deterministically extracted, or system-derived. A caller that
   * DOES know the finer-grained truth for this specific call (e.g. the
   * assistant orchestrator, which knows a field was just parsed from this
   * turn's message) may pass a more precise source.
   */
  source?: ApplicantProfileFieldSource
}

/**
 * Projects the AI assistant's own UserProfile (src/assistant/types.ts) into
 * the shared contract. Read-only with respect to UserProfile — does not
 * change assistant behaviour in any way.
 */
export function applicantProfileFromUserProfile(
  userProfile: UserProfile,
  opts: FromLegacyProfileOptions = {},
): ApplicantProfile {
  const now = opts.now ?? new Date().toISOString()
  const data: ApplicantProfileData = {
    age: userProfile.age,
    gender: userProfile.gender,
    state: userProfile.state,
    district: userProfile.district,
    areaType: userProfile.areaType,
    socialCategory: userProfile.socialCategory,
    businessDescription: userProfile.proposedBusiness,
    businessSector: userProfile.businessSector,
    businessStage: userProfile.businessStage,
    businessStatus: userProfile.businessStatus,
    annualIncome: userProfile.annualIncome,
    investmentRequired: userProfile.investmentRequired,
    ownContribution: userProfile.ownContribution,
    financingRequired: userProfile.financingRequired,
    existingLoans: userProfile.existingLoans,
    education: userProfile.education,
    landOrAssets: userProfile.landOrAssets,
    rawNotes: [...userProfile.rawNotes],
  }
  const profile = markImported(data, opts.applicantId, now)
  if (!opts.source || opts.source === IMPORTED_UNKNOWN) return profile
  const fieldProvenance: typeof profile.fieldProvenance = {}
  for (const key of Object.keys(profile.fieldProvenance) as ApplicantProfileFieldKey[]) {
    fieldProvenance[key] = { ...profile.fieldProvenance[key], source: opts.source }
  }
  return { ...profile, fieldProvenance }
}

/**
 * Projects the shared contract back into a UserProfile. Total (never
 * partial) because UserProfile's only required field, `rawNotes`, defaults
 * cleanly to `[]` — the same empty value src/assistant/types.ts's own
 * EMPTY_PROFILE constant uses, so this is not inventing a fact, just an
 * empty list. Fields UserProfile has no slot for (name, phone, lat/lng,
 * villageOrTown, businessExperienceYears) are dropped — this direction is
 * intentionally lossy; see docs/applicant-profile.md.
 */
export function applicantProfileToUserProfile(applicant: ApplicantProfile): UserProfile {
  const d = applicant.data
  return {
    state: d.state,
    district: d.district,
    areaType: d.areaType,
    age: d.age,
    gender: d.gender,
    socialCategory: d.socialCategory,
    annualIncome: d.annualIncome,
    businessStatus: d.businessStatus,
    proposedBusiness: d.businessDescription,
    businessSector: d.businessSector,
    investmentRequired: d.investmentRequired,
    ownContribution: d.ownContribution,
    financingRequired: d.financingRequired,
    existingLoans: d.existingLoans,
    businessStage: d.businessStage,
    education: d.education,
    landOrAssets: d.landOrAssets,
    rawNotes: [...d.rawNotes],
  }
}

// ---------------------------------------------------------------------------
// Adapters — EntrepreneurProfile (NSFDC cockpit) <-> ApplicantProfile
// ---------------------------------------------------------------------------

const BUSINESS_CATEGORY_VALUES: ReadonlySet<BusinessCategory> = new Set<BusinessCategory>([
  'dairy',
  'retail',
  'food',
  'textiles',
  'poultry',
  'agri_processing',
])

function isBusinessCategory(sector: string): sector is BusinessCategory {
  return BUSINESS_CATEGORY_VALUES.has(sector as BusinessCategory)
}

/**
 * Projects the NSFDC cockpit's EntrepreneurProfile (src/lib/lokScore.ts)
 * into the shared contract. `location` is optional and, when supplied
 * (e.g. from AppState.location, which already sits alongside the profile in
 * src/state/app-state.ts), fills in the applicant's resolved place name and
 * coordinates — those don't live on EntrepreneurProfile itself.
 *
 * Deliberately NOT mapped (see docs/applicant-profile.md):
 *   - state: neither EntrepreneurProfile nor ResolvedLocation carries an
 *     explicit state field today (ResolvedLocation only has district/block),
 *     so this would have to be invented to fill in — left unmapped instead.
 *   - areaType: LokPulse's premise is rural, but that's a product framing,
 *     not a field either source type actually states — left unmapped.
 *   - businessStage/businessStatus: experienceYears alone isn't a reliable
 *     signal for "idea" vs "new" vs "existing_expansion" — left unmapped
 *     rather than guessed.
 */
export function applicantProfileFromEntrepreneurProfile(
  profile: EntrepreneurProfile,
  location?: ResolvedLocation | null,
  opts: FromLegacyProfileOptions = {},
): ApplicantProfile {
  const now = opts.now ?? new Date().toISOString()
  const data: ApplicantProfileData = {
    name: profile.name || undefined,
    age: profile.age,
    gender: profile.gender,
    phone: profile.phone,
    socialCategory: profile.community,
    businessSector: profile.category,
    businessExperienceYears: profile.experienceYears,
    annualIncome: profile.annualIncome,
    ownContribution: profile.availableMargin,
    district: location?.district,
    villageOrTown: location?.name,
    lat: location?.lat ?? profile.liveLat,
    lng: location?.lng ?? profile.liveLng,
    rawLocationText: profile.liveQuery || undefined,
    rawNotes: [],
  }
  const imported = markImported(data, opts.applicantId, now)
  if (!opts.source || opts.source === IMPORTED_UNKNOWN) return imported
  const fieldProvenance: typeof imported.fieldProvenance = {}
  for (const key of Object.keys(imported.fieldProvenance) as ApplicantProfileFieldKey[]) {
    fieldProvenance[key] = { ...imported.fieldProvenance[key], source: opts.source }
  }
  return { ...imported, fieldProvenance }
}

/**
 * Best-effort, NEVER-inventing partial projection back toward
 * EntrepreneurProfile. Returns a `Partial<EntrepreneurProfile>`, not a full
 * EntrepreneurProfile, because several of EntrepreneurProfile's required
 * fields (villageId, locationMode, radiusKm) describe how the cockpit
 * should look something up, not a fact about the applicant — ApplicantProfile
 * has nothing honest to put there, and filling them with a fabricated
 * default (e.g. defaulting villageId to the first seed village) would be
 * exactly the "invented data" this contract is designed to prevent.
 * Callers (e.g. a future "resume my /scan form from what I already told the
 * voice assistant" flow) are expected to merge this draft into their own
 * form defaults, not construct an EntrepreneurProfile from it directly.
 */
export function applicantProfileToEntrepreneurProfileDraft(applicant: ApplicantProfile): Partial<EntrepreneurProfile> {
  const d = applicant.data
  const draft: Partial<EntrepreneurProfile> = {}
  if (d.name !== undefined) draft.name = d.name
  if (d.age !== undefined) draft.age = d.age
  if (d.gender !== undefined) draft.gender = d.gender
  if (d.phone !== undefined) draft.phone = d.phone
  if (d.socialCategory !== undefined) draft.community = d.socialCategory
  if (d.annualIncome !== undefined) draft.annualIncome = d.annualIncome
  if (d.businessExperienceYears !== undefined) draft.experienceYears = d.businessExperienceYears
  if (d.ownContribution !== undefined) draft.availableMargin = d.ownContribution
  if (d.businessSector !== undefined && isBusinessCategory(d.businessSector)) draft.category = d.businessSector
  if (d.lat !== undefined) draft.liveLat = d.lat
  if (d.lng !== undefined) draft.liveLng = d.lng
  if (d.rawLocationText !== undefined) draft.liveQuery = d.rawLocationText
  return draft
}
