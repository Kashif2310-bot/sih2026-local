import { extractApplicantName, extractProfileFromMessage } from '../assistant/profileExtraction'
import type { BusinessCategory } from '../data/villages'
import { NSFDC } from '../lib/config'
import type { EntrepreneurProfile } from '../lib/lokScore'

/**
 * The /apply profile form's working state. Every field starts blank (''/
 * null) unless the citizen's own words gave evidence for it — there is no
 * fallback to a demo profile, so a field the citizen never mentioned is
 * visibly empty for them to fill in rather than silently pre-filled.
 */
export interface ProfileFormDraft {
  name: string
  age: number | null
  gender: EntrepreneurProfile['gender'] | null
  community: EntrepreneurProfile['community'] | null
  category: BusinessCategory | null
  availableMargin: number | null
  annualIncome: number | null
  experienceYears: number | null
  /** A curated village id, OTHER_LOCATION for a typed place, or null when not chosen yet. */
  villageId: string | null
  /** The typed place, used only when villageId is OTHER_LOCATION. */
  otherLocation: string
}

export type ProfileFormField = keyof ProfileFormDraft

/**
 * The Village/Block choice for a place outside the curated villages, so a
 * real location is never a dead end. It runs the scan's live location mode
 * (geocoded place + live lookups) instead of curated village data.
 */
export const OTHER_LOCATION = 'other'

/**
 * profileExtraction's sector tags (assistant/lexicon.ts) mapped onto the
 * scan's business categories — only where the match is unambiguous.
 * food_processing is deliberately absent: it covers both catering ("Food /
 * Tiffin") and papad/pickle making (closer to "Agri Processing"), so
 * guessing either would be wrong half the time.
 */
const SECTOR_TO_CATEGORY: Partial<Record<string, BusinessCategory>> = {
  dairy: 'dairy',
  poultry: 'poultry',
  retail: 'retail',
  textiles: 'textiles',
  tailoring: 'textiles',
}

export function profileFormDraftFromTranscript(transcript: string): ProfileFormDraft {
  const extracted = extractProfileFromMessage(transcript)
  return {
    name: extractApplicantName(transcript) ?? '',
    age: extracted.age ?? null,
    gender: extracted.gender ?? null,
    community: extracted.socialCategory ?? null,
    category: (extracted.businessSector && SECTOR_TO_CATEGORY[extracted.businessSector]) || null,
    availableMargin: extracted.ownContribution ?? null,
    annualIncome: extracted.annualIncome ?? null,
    // profileExtraction has no years-of-experience field.
    experienceYears: null,
    // profileExtraction only extracts a state, never a village or district.
    villageId: null,
    otherLocation: '',
  }
}

export interface FieldError {
  key: string
  values?: Record<string, string>
}

export type ProfileFormValidation =
  | { ok: true; profile: EntrepreneurProfile }
  | { ok: false; errors: Partial<Record<ProfileFormField, FieldError>> }

const REQUIRED: FieldError = { key: 'apply.application.requiredField' }

/**
 * Same rules as the /scan form (pages/ScanPage.tsx), since both feed the
 * same scan. On success, returns only what the citizen can see and edit on
 * the form: no demoMode, and no radiusKm (the scan applies its standard
 * REACH_KM.default when none is given). A typed "Other" place becomes the
 * scan's live location mode, with no curated village id.
 */
export function validateProfileForm(draft: ProfileFormDraft): ProfileFormValidation {
  const errors: Partial<Record<ProfileFormField, FieldError>> = {}
  const { name, age, gender, community, category, availableMargin, annualIncome, experienceYears, villageId } = draft
  const otherLocation = draft.otherLocation.trim()
  const isOtherLocation = villageId === OTHER_LOCATION

  if (!name.trim()) errors.name = { key: 'validation.nameRequired' }
  if (age === null) errors.age = REQUIRED
  else if (!Number.isFinite(age) || age < 18 || age > 70) errors.age = { key: 'validation.ageRange' }
  if (!gender) errors.gender = REQUIRED
  if (!community) errors.community = REQUIRED
  if (!category) errors.category = REQUIRED
  if (availableMargin === null) errors.availableMargin = REQUIRED
  else if (!Number.isFinite(availableMargin) || availableMargin <= 0) {
    errors.availableMargin = { key: 'validation.marginPositive' }
  } else if (availableMargin > NSFDC.maxMarginRupees) {
    errors.availableMargin = {
      key: 'validation.marginMax',
      values: { max: NSFDC.maxMarginRupees.toLocaleString('en-IN') },
    }
  }
  if (annualIncome === null) errors.annualIncome = REQUIRED
  else if (!Number.isFinite(annualIncome) || annualIncome < 0) errors.annualIncome = { key: 'validation.incomeNegative' }
  if (experienceYears === null) errors.experienceYears = REQUIRED
  else if (!Number.isFinite(experienceYears) || experienceYears < 0) {
    errors.experienceYears = { key: 'validation.experienceNegative' }
  }
  if (!villageId) errors.villageId = REQUIRED
  else if (isOtherLocation && !otherLocation) errors.otherLocation = REQUIRED

  if (
    Object.keys(errors).length > 0 ||
    age === null ||
    !gender ||
    !community ||
    !category ||
    availableMargin === null ||
    annualIncome === null ||
    experienceYears === null ||
    !villageId
  ) {
    return { ok: false, errors }
  }

  return {
    ok: true,
    profile: {
      name: name.trim(),
      age,
      gender,
      community,
      category,
      availableMargin,
      annualIncome,
      experienceYears,
      ...(isOtherLocation
        ? { locationMode: 'live' as const, liveQuery: otherLocation, villageId: '' }
        : { locationMode: 'curated' as const, villageId }),
    },
  }
}
