import type {
  ApplicantProfilePatch,
  ApplicantProfileV2,
  FieldConfidence,
  FieldSource,
  MissingField,
  ProfileField,
  ProfileFieldKey,
} from '../../contracts/profile'
import {
  CURATED_LOCATION_REQUIRED,
  ENGINE_REQUIRED_FIELDS,
  LIVE_LOCATION_REQUIRED,
} from '../../contracts/profile'
import type { AppLocale } from '../../contracts/domain'

function nowIso(): string {
  return new Date().toISOString()
}

export function emptyField<T>(value: T | null = null): ProfileField<T> {
  return {
    value,
    confidence: 'unknown',
    source: 'system',
    updatedAt: null,
  }
}

export function fieldFrom<T>(
  value: T,
  source: FieldSource = 'user',
  confidence: FieldConfidence = 'high',
): ProfileField<T> {
  return {
    value,
    confidence,
    source,
    updatedAt: nowIso(),
  }
}

/** Create a blank V2 profile for a new conversation session. */
export function createEmptyApplicantProfileV2(
  locale: AppLocale = 'en',
): ApplicantProfileV2 {
  const ts = nowIso()
  return {
    locale,
    name: emptyField<string>(),
    age: emptyField<number>(),
    gender: emptyField(),
    community: emptyField(),
    phone: emptyField<string>(),
    annualIncome: emptyField<number>(),
    experienceYears: emptyField<number>(),
    category: emptyField(),
    availableMargin: emptyField<number>(),
    locationMode: emptyField(),
    villageId: emptyField<string>(),
    liveQuery: emptyField<string>(),
    liveLat: emptyField<number>(),
    liveLng: emptyField<number>(),
    radiusKm: fieldFrom(7, 'system', 'medium'),
    storySummary: emptyField<string>(),
    businessIntent: emptyField<string>(),
    demoMode: false,
    createdAt: ts,
    updatedAt: ts,
  }
}

const FIELD_KEYS: ProfileFieldKey[] = [
  'name',
  'age',
  'gender',
  'community',
  'phone',
  'annualIncome',
  'experienceYears',
  'category',
  'availableMargin',
  'locationMode',
  'villageId',
  'liveQuery',
  'liveLat',
  'liveLng',
  'radiusKm',
  'storySummary',
  'businessIntent',
]

function isProfileFieldKey(k: string): k is ProfileFieldKey {
  return (FIELD_KEYS as string[]).includes(k)
}

/** Merge a voice/UI patch into an existing V2 profile (immutable). */
export function applyProfilePatch(
  profile: ApplicantProfileV2,
  patch: ApplicantProfilePatch,
): ApplicantProfileV2 {
  const next: ApplicantProfileV2 = {
    ...profile,
    updatedAt: nowIso(),
  }

  if (patch.locale !== undefined) next.locale = patch.locale
  if (patch.demoMode !== undefined) next.demoMode = patch.demoMode
  if (patch.conversationId !== undefined) next.conversationId = patch.conversationId

  for (const key of Object.keys(patch)) {
    if (!isProfileFieldKey(key)) continue
    const incoming = patch[key]
    if (!incoming) continue
    const current = profile[key] as ProfileField<unknown>
    const merged: ProfileField<unknown> = {
      value: incoming.value !== undefined ? incoming.value : current.value,
      confidence: incoming.confidence ?? current.confidence,
      source: incoming.source ?? current.source,
      updatedAt: nowIso(),
    }
    ;(next as unknown as Record<string, unknown>)[key] = merged
  }

  return next
}

const PRIORITY: Record<string, number> = {
  name: 100,
  category: 95,
  availableMargin: 90,
  locationMode: 85,
  villageId: 84,
  liveQuery: 84,
  community: 80,
  annualIncome: 75,
  gender: 70,
  age: 65,
  experienceYears: 60,
  radiusKm: 40,
}

const LABELS: Record<
  ProfileFieldKey,
  { en: string; kn: string }
> = {
  name: { en: 'Full name', kn: 'ಪೂರ್ಣ ಹೆಸರು' },
  age: { en: 'Age', kn: 'ವಯಸ್ಸು' },
  gender: { en: 'Gender', kn: 'ಲಿಂಗ' },
  community: { en: 'Community category', kn: 'ಸಮುದಾಯ ವರ್ಗ' },
  phone: { en: 'Phone', kn: 'ದೂರವಾಣಿ' },
  annualIncome: { en: 'Annual family income', kn: 'ವಾರ್ಷಿಕ ಕುಟುಂಬ ಆದಾಯ' },
  experienceYears: { en: 'Years of experience', kn: 'ಅನುಭವದ ವರ್ಷಗಳು' },
  category: { en: 'Business category', kn: 'ವ್ಯಾಪಾರ ವರ್ಗ' },
  availableMargin: { en: 'Available margin capital', kn: 'ಲಭ್ಯ ಮಾರ್ಜಿನ್ ಬಂಡವಾಳ' },
  locationMode: { en: 'Location mode', kn: 'ಸ್ಥಳ ಮೋಡ್' },
  villageId: { en: 'Village selection', kn: 'ಗ್ರಾಮ ಆಯ್ಕೆ' },
  liveQuery: { en: 'Place name for live lookup', kn: 'ಲೈವ್ ಹುಡುಕಾಟಕ್ಕೆ ಸ್ಥಳ' },
  liveLat: { en: 'Latitude', kn: 'ಅಕ್ಷಾಂಶ' },
  liveLng: { en: 'Longitude', kn: 'ರೇಖಾಂಶ' },
  radiusKm: { en: 'Market reach radius (km)', kn: 'ಮಾರುಕಟ್ಟೆ ತ್ರಿಜ್ಯ (ಕಿ.ಮೀ)' },
  storySummary: { en: 'Citizen story summary', kn: 'ನಾಗರಿಕ ಕಥೆ ಸಾರಾಂಶ' },
  businessIntent: { en: 'Business intent', kn: 'ವ್ಯಾಪಾರ ಉದ್ದೇಶ' },
}

function isMissing(field: ProfileField<unknown>): boolean {
  if (field.value === null || field.value === undefined) return true
  if (typeof field.value === 'string' && field.value.trim() === '') return true
  if (field.confidence === 'unknown') return true
  return false
}

/** Ranked missing fields for intelligent follow-ups (Kashif). */
export function getMissingFields(profile: ApplicantProfileV2): MissingField[] {
  const missing: MissingField[] = []

  for (const key of ENGINE_REQUIRED_FIELDS) {
    if (isMissing(profile[key] as ProfileField<unknown>)) {
      const label = LABELS[key]
      missing.push({
        key,
        reason: `${label.en} is required before running feasibility / finance engines.`,
        reasonKn: `${label.kn} ಅಗತ್ಯವಿದೆ.`,
        priority: PRIORITY[key] ?? 50,
      })
    }
  }

  const mode = profile.locationMode.value
  if (mode === 'curated') {
    for (const key of CURATED_LOCATION_REQUIRED) {
      if (isMissing(profile[key] as ProfileField<unknown>)) {
        missing.push({
          key,
          reason: 'Curated village id is required when location mode is curated.',
          reasonKn: 'ಕ್ಯುರೇಟೆಡ್ ಮೋಡ್‌ನಲ್ಲಿ ಗ್ರಾಮ ಐಡಿ ಅಗತ್ಯ.',
          priority: PRIORITY[key] ?? 50,
        })
      }
    }
  } else if (mode === 'live') {
    for (const key of LIVE_LOCATION_REQUIRED) {
      if (isMissing(profile[key] as ProfileField<unknown>)) {
        missing.push({
          key,
          reason: 'A place name (or coordinates) is required for live location lookup.',
          reasonKn: 'ಲೈವ್ ಸ್ಥಳಕ್ಕೆ ಸ್ಥಳದ ಹೆಸರು ಅಗತ್ಯ.',
          priority: PRIORITY[key] ?? 50,
        })
      }
    }
  }

  return missing.sort((a, b) => b.priority - a.priority)
}
