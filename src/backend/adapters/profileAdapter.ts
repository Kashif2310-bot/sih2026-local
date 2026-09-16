/**
 * Adapter: ApplicantProfileV2 → EntrepreneurProfile
 * Existing engines (lokScore, finance, AppContext) stay untouched.
 */

import type { EntrepreneurProfile } from '../../lib/lokScore'
import type { BusinessCategory } from '../../data/villages'
import type { ApplicantProfileV2, FieldConfidence, FieldSource, MissingField, ProfileField } from '../../contracts/profile'
import type { AppLocale } from '../../contracts/domain'
import { getMissingFields } from './profileHelpers'

export type ProfileAdapterSuccess = {
  ok: true
  profile: EntrepreneurProfile
  missing: MissingField[]
}

export type ProfileAdapterFailure = {
  ok: false
  missing: MissingField[]
  /** Best-effort partial for UI previews — not safe for engines. */
  partial: Partial<EntrepreneurProfile>
}

export type ProfileAdapterResult = ProfileAdapterSuccess | ProfileAdapterFailure

function filled<T>(
  value: T,
  source: FieldSource = 'demo',
  confidence: FieldConfidence = 'high',
): ProfileField<T> {
  return {
    value,
    confidence,
    source,
    updatedAt: new Date().toISOString(),
  }
}

function optionalFilled<T>(value: T | null | undefined): ProfileField<T> {
  if (value === null || value === undefined) {
    return {
      value: null,
      confidence: 'unknown',
      source: 'system',
      updatedAt: null,
    }
  }
  return filled(value)
}

/**
 * Convert a conversational V2 profile into the v1 engine profile.
 * Returns ok:false with ranked missing fields when required data is incomplete.
 */
export function toEntrepreneurProfile(v2: ApplicantProfileV2): ProfileAdapterResult {
  const missing = getMissingFields(v2)

  const partial: Partial<EntrepreneurProfile> = {}
  if (v2.name.value) partial.name = v2.name.value
  if (v2.age.value != null) partial.age = v2.age.value
  if (v2.gender.value) partial.gender = v2.gender.value
  if (v2.community.value) partial.community = v2.community.value
  if (v2.annualIncome.value != null) partial.annualIncome = v2.annualIncome.value
  if (v2.experienceYears.value != null) partial.experienceYears = v2.experienceYears.value
  if (v2.category.value) partial.category = v2.category.value as BusinessCategory
  if (v2.availableMargin.value != null) partial.availableMargin = v2.availableMargin.value
  if (v2.phone.value) partial.phone = v2.phone.value
  if (v2.locationMode.value) partial.locationMode = v2.locationMode.value
  if (v2.villageId.value) partial.villageId = v2.villageId.value
  if (v2.liveQuery.value) partial.liveQuery = v2.liveQuery.value
  if (v2.liveLat.value != null) partial.liveLat = v2.liveLat.value
  if (v2.liveLng.value != null) partial.liveLng = v2.liveLng.value
  if (v2.radiusKm.value != null) partial.radiusKm = v2.radiusKm.value
  if (v2.demoMode != null) partial.demoMode = v2.demoMode

  const blocking = missing.filter(
    (m) =>
      m.key !== 'phone' &&
      m.key !== 'storySummary' &&
      m.key !== 'businessIntent' &&
      m.key !== 'liveLat' &&
      m.key !== 'liveLng',
  )

  if (blocking.length > 0) {
    return { ok: false, missing: blocking, partial }
  }

  const locationMode = v2.locationMode.value!
  const profile: EntrepreneurProfile = {
    name: v2.name.value!,
    age: v2.age.value!,
    gender: v2.gender.value!,
    community: v2.community.value!,
    annualIncome: v2.annualIncome.value!,
    experienceYears: v2.experienceYears.value!,
    villageId: locationMode === 'curated' ? v2.villageId.value! : (v2.villageId.value ?? ''),
    category: v2.category.value! as BusinessCategory,
    availableMargin: v2.availableMargin.value!,
    phone: v2.phone.value ?? undefined,
    locationMode,
    liveQuery: v2.liveQuery.value ?? undefined,
    liveLat: v2.liveLat.value ?? undefined,
    liveLng: v2.liveLng.value ?? undefined,
    radiusKm: v2.radiusKm.value ?? 7,
    demoMode: v2.demoMode,
  }

  return { ok: true, profile, missing: [] }
}

/** Seed a V2 profile from a complete v1 engine profile (e.g. demo path). */
export function fromEntrepreneurProfile(
  p: EntrepreneurProfile,
  locale: AppLocale = 'en',
): ApplicantProfileV2 {
  const ts = new Date().toISOString()
  return {
    locale,
    name: filled(p.name),
    age: filled(p.age),
    gender: filled(p.gender),
    community: filled(p.community),
    phone: optionalFilled(p.phone),
    annualIncome: filled(p.annualIncome),
    experienceYears: filled(p.experienceYears),
    category: filled(p.category),
    availableMargin: filled(p.availableMargin),
    locationMode: filled(p.locationMode),
    villageId: filled(p.villageId),
    liveQuery: optionalFilled(p.liveQuery),
    liveLat: optionalFilled(p.liveLat),
    liveLng: optionalFilled(p.liveLng),
    radiusKm: filled(p.radiusKm),
    storySummary: optionalFilled<string>(null),
    businessIntent: optionalFilled<string>(null),
    demoMode: p.demoMode,
    createdAt: ts,
    updatedAt: ts,
  }
}
