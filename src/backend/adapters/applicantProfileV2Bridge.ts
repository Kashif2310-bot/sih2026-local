/**
 * Compatibility bridge: Backend ApplicantProfileV2 ↔ Kashif shared ApplicantProfile.
 * Shared contract (Option A): src/shared/applicantProfile.ts
 * ApplicantProfileV2 remains internal/compat only — do not force teammates onto V2.
 */

import {
  createEmptyApplicantProfile,
  withApplicantFields,
  type ApplicantProfile,
  type ApplicantProfileFieldConfidence,
  type ApplicantProfileFieldSource,
} from '../../shared/applicantProfile'
import type { ApplicantProfileV2, FieldConfidence, FieldSource } from '../../contracts/profile'
import { createEmptyApplicantProfileV2 } from '../adapters/profileHelpers'
import type { BusinessCategory } from '../../data/villages'

function mapSourceToShared(source: FieldSource): ApplicantProfileFieldSource {
  switch (source) {
    case 'voice':
      return 'ai_extracted'
    case 'user':
      return 'user_provided'
    case 'demo':
      return 'imported_unknown'
    default:
      return 'system_derived'
  }
}

function mapConfidenceToShared(c: FieldConfidence): ApplicantProfileFieldConfidence {
  switch (c) {
    case 'high':
      return 'high'
    case 'medium':
      return 'medium'
    case 'low':
      return 'low'
    default:
      return 'low'
  }
}

function mapSourceFromShared(source: ApplicantProfileFieldSource): FieldSource {
  switch (source) {
    case 'ai_extracted':
      return 'voice'
    case 'user_provided':
    case 'government_verified':
      return 'user'
    case 'system_derived':
      return 'system'
    default:
      return 'system'
  }
}

function mapConfidenceFromShared(c?: ApplicantProfileFieldConfidence): FieldConfidence {
  if (c === 'confirmed' || c === 'high') return 'high'
  if (c === 'medium') return 'medium'
  if (c === 'low') return 'low'
  return 'unknown'
}

const CATEGORY_MAP: Record<string, BusinessCategory> = {
  dairy: 'dairy',
  poultry: 'poultry',
  food: 'food',
  retail: 'retail',
  textiles: 'textiles',
  agri_processing: 'agri_processing',
  agriculture: 'agri_processing',
}

/** Project V2 (legacy backend) into the shared ApplicantProfile contract. */
export function sharedProfileFromV2(v2: ApplicantProfileV2): ApplicantProfile {
  let profile = createEmptyApplicantProfile(v2.id)
  const values: Parameters<typeof withApplicantFields>[1] = {}
  if (v2.name.value) values.name = v2.name.value
  if (v2.age.value != null) values.age = v2.age.value
  if (v2.gender.value) values.gender = v2.gender.value
  if (v2.phone.value) values.phone = v2.phone.value
  if (v2.community.value) values.socialCategory = v2.community.value
  if (v2.annualIncome.value != null) values.annualIncome = v2.annualIncome.value
  if (v2.experienceYears.value != null) values.businessExperienceYears = v2.experienceYears.value
  if (v2.availableMargin.value != null) values.ownContribution = v2.availableMargin.value
  if (v2.category.value) {
    values.businessSector = v2.category.value
    values.businessDescription = v2.category.value
  }
  if (v2.liveQuery.value) values.rawLocationText = v2.liveQuery.value
  if (v2.liveLat.value != null) values.lat = v2.liveLat.value
  if (v2.liveLng.value != null) values.lng = v2.liveLng.value
  if (v2.villageId.value) values.villageOrTown = v2.villageId.value

  const source = mapSourceToShared(v2.name.source ?? 'system')
  const confidence = mapConfidenceToShared(v2.name.confidence ?? 'unknown')
  return withApplicantFields(profile, values, { source, confidence })
}

/** Project shared ApplicantProfile into V2 for older backend helpers (compat only). */
export function v2FromSharedProfile(shared: ApplicantProfile): ApplicantProfileV2 {
  const v2 = createEmptyApplicantProfileV2('en')
  v2.id = shared.applicantId as ApplicantProfileV2['id']
  const d = shared.data
  const prov = shared.fieldProvenance

  const stamp = <T>(
    value: T | undefined,
    fieldKey: keyof typeof prov,
  ): { value: T; confidence: FieldConfidence; source: FieldSource; updatedAt: string } | null => {
    if (value === undefined || value === null) return null
    const p = prov[fieldKey as keyof typeof prov]
    return {
      value,
      confidence: mapConfidenceFromShared(p?.confidence),
      source: mapSourceFromShared(p?.source ?? 'imported_unknown'),
      updatedAt: p?.capturedAt ?? shared.updatedAt,
    }
  }

  const name = stamp(d.name, 'name')
  if (name) v2.name = name
  const age = stamp(d.age, 'age')
  if (age) v2.age = age
  const gender = stamp(d.gender, 'gender')
  if (gender) v2.gender = gender
  const phone = stamp(d.phone, 'phone')
  if (phone) v2.phone = phone
  const community = stamp(d.socialCategory, 'socialCategory')
  if (community) v2.community = community
  const annualIncome = stamp(d.annualIncome, 'annualIncome')
  if (annualIncome) v2.annualIncome = annualIncome
  const experienceYears = stamp(d.businessExperienceYears, 'businessExperienceYears')
  if (experienceYears) v2.experienceYears = experienceYears
  const availableMargin = stamp(d.ownContribution, 'ownContribution')
  if (availableMargin) v2.availableMargin = availableMargin
  const liveQuery = stamp(d.rawLocationText, 'rawLocationText')
  if (liveQuery) v2.liveQuery = liveQuery
  const liveLat = stamp(d.lat, 'lat')
  if (liveLat) v2.liveLat = liveLat
  const liveLng = stamp(d.lng, 'lng')
  if (liveLng) v2.liveLng = liveLng
  const villageId = stamp(d.villageOrTown, 'villageOrTown')
  if (villageId) v2.villageId = villageId

  if (d.businessSector) {
    const cat = CATEGORY_MAP[d.businessSector.toLowerCase()]
    if (cat) {
      const category = stamp(cat, 'businessSector')
      if (category) v2.category = category
    }
  }
  if (d.villageOrTown && !d.rawLocationText) {
    v2.locationMode = {
      value: 'curated',
      confidence: 'medium',
      source: 'system',
      updatedAt: shared.updatedAt,
    }
  } else if (d.rawLocationText || d.lat != null) {
    v2.locationMode = {
      value: 'live',
      confidence: 'medium',
      source: 'system',
      updatedAt: shared.updatedAt,
    }
  }
  v2.updatedAt = shared.updatedAt
  return v2
}
