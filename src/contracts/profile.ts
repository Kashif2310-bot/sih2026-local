/**
 * ApplicantProfileV2 — conversational / partial intake profile (Kashif + Backend).
 * Adapts to EntrepreneurProfile via src/backend/adapters/profileAdapter.ts
 * so existing LokScore / finance / demo engines stay unchanged.
 */

import type { IsoDateTime, Uuid } from './common'
import type { AppLocale, BusinessCategory, Community, Gender, LocationMode } from './domain'

export type FieldConfidence = 'high' | 'medium' | 'low' | 'unknown'

export type FieldSource = 'voice' | 'user' | 'system' | 'demo'

export interface ProfileField<T> {
  value: T | null
  confidence: FieldConfidence
  source: FieldSource
  updatedAt: IsoDateTime | null
}

export type ProfileFieldKey =
  | 'name'
  | 'age'
  | 'gender'
  | 'community'
  | 'phone'
  | 'annualIncome'
  | 'experienceYears'
  | 'category'
  | 'availableMargin'
  | 'locationMode'
  | 'villageId'
  | 'liveQuery'
  | 'liveLat'
  | 'liveLng'
  | 'radiusKm'
  | 'storySummary'
  | 'businessIntent'

/** Fields required to adapt into EntrepreneurProfile for engines. */
export const ENGINE_REQUIRED_FIELDS: readonly ProfileFieldKey[] = [
  'name',
  'age',
  'gender',
  'community',
  'annualIncome',
  'experienceYears',
  'category',
  'availableMargin',
  'locationMode',
  'radiusKm',
] as const

/** Extra location fields required when locationMode is curated / live. */
export const CURATED_LOCATION_REQUIRED: readonly ProfileFieldKey[] = ['villageId'] as const
export const LIVE_LOCATION_REQUIRED: readonly ProfileFieldKey[] = ['liveQuery'] as const

export interface MissingField {
  key: ProfileFieldKey
  reason: string
  reasonKn: string
  /** Higher = ask sooner (Kashif follow-up ranking). */
  priority: number
}

export interface ApplicantProfileV2 {
  id?: Uuid
  conversationId?: Uuid
  userId?: Uuid
  locale: AppLocale
  name: ProfileField<string>
  age: ProfileField<number>
  gender: ProfileField<Gender>
  community: ProfileField<Community>
  phone: ProfileField<string>
  annualIncome: ProfileField<number>
  experienceYears: ProfileField<number>
  category: ProfileField<BusinessCategory>
  availableMargin: ProfileField<number>
  locationMode: ProfileField<LocationMode>
  villageId: ProfileField<string>
  liveQuery: ProfileField<string>
  liveLat: ProfileField<number>
  liveLng: ProfileField<number>
  radiusKm: ProfileField<number>
  storySummary: ProfileField<string>
  businessIntent: ProfileField<string>
  /** Presenter safety switch — maps through adapter unchanged. */
  demoMode?: boolean
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
}

/** Patch from voice extraction or UI — only provided keys are merged. */
export type ApplicantProfilePatch = {
  [K in ProfileFieldKey]?: Partial<ProfileField<ApplicantProfileV2[K] extends ProfileField<infer V> ? V : never>> & {
    value?: ApplicantProfileV2[K] extends ProfileField<infer V> ? V | null : never
  }
} & {
  locale?: AppLocale
  demoMode?: boolean
  conversationId?: Uuid
}
