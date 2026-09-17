import { describe, expect, it } from 'vitest'
import type { EntrepreneurProfile } from '../lib/lokScore'
import type { ResolvedLocation } from '../lib/resolveLocation'
import { EMPTY_PROFILE, type UserProfile } from '../assistant/types'
import {
  APPLICANT_PROFILE_FIELD_KEYS,
  applicantProfileFromEntrepreneurProfile,
  applicantProfileFromUserProfile,
  applicantProfileToEntrepreneurProfileDraft,
  applicantProfileToUserProfile,
  createEmptyApplicantProfile,
  withApplicantField,
  withApplicantFields,
  withRawNote,
} from './applicantProfile'

describe('createEmptyApplicantProfile', () => {
  it('starts fully empty with no fabricated values', () => {
    const p = createEmptyApplicantProfile()
    expect(p.applicantId).toBeUndefined()
    expect(p.data).toEqual({ rawNotes: [] })
    expect(p.fieldProvenance).toEqual({})
    expect(typeof p.updatedAt).toBe('string')
  })

  it('accepts an applicantId and a fixed timestamp', () => {
    const p = createEmptyApplicantProfile('app-1', '2026-01-01T00:00:00.000Z')
    expect(p.applicantId).toBe('app-1')
    expect(p.updatedAt).toBe('2026-01-01T00:00:00.000Z')
  })
})

describe('withApplicantField', () => {
  it('sets the value and matching provenance together', () => {
    const p0 = createEmptyApplicantProfile()
    const p1 = withApplicantField(p0, 'age', 34, { source: 'user_provided', capturedAt: '2026-02-01T00:00:00.000Z' })
    expect(p1.data.age).toBe(34)
    expect(p1.fieldProvenance.age).toEqual({ source: 'user_provided', capturedAt: '2026-02-01T00:00:00.000Z' })
    expect(p1.updatedAt).toBe('2026-02-01T00:00:00.000Z')
  })

  it('is a no-op when the value is undefined — never records "unknown" as captured', () => {
    const p0 = createEmptyApplicantProfile()
    const p1 = withApplicantField(p0, 'age', undefined, { source: 'user_provided' })
    expect(p1).toBe(p0)
  })

  it('does not mutate the original profile', () => {
    const p0 = createEmptyApplicantProfile()
    withApplicantField(p0, 'age', 40, { source: 'user_provided' })
    expect(p0.data.age).toBeUndefined()
    expect(p0.fieldProvenance.age).toBeUndefined()
  })

  it('defaults capturedAt to now when the caller does not supply one', () => {
    const before = Date.now()
    const p1 = withApplicantField(createEmptyApplicantProfile(), 'annualIncome', 300_000, { source: 'system_derived' })
    const capturedAt = p1.fieldProvenance.annualIncome?.capturedAt
    expect(capturedAt).toBeDefined()
    expect(Date.parse(capturedAt!)).toBeGreaterThanOrEqual(before)
  })
})

describe('withApplicantFields', () => {
  it('sets multiple fields at once under the same provenance', () => {
    const p1 = withApplicantFields(
      createEmptyApplicantProfile(),
      { age: 29, state: 'Karnataka', businessSector: 'dairy' },
      { source: 'ai_extracted', confidence: 'medium', capturedAt: '2026-03-01T00:00:00.000Z' },
    )
    expect(p1.data).toMatchObject({ age: 29, state: 'Karnataka', businessSector: 'dairy' })
    expect(p1.fieldProvenance.age).toEqual({ source: 'ai_extracted', confidence: 'medium', capturedAt: '2026-03-01T00:00:00.000Z' })
    expect(p1.fieldProvenance.state?.source).toBe('ai_extracted')
    expect(p1.fieldProvenance.businessSector?.source).toBe('ai_extracted')
  })

  it('ignores undefined entries and leaves the profile untouched when nothing changed', () => {
    const p0 = createEmptyApplicantProfile()
    const p1 = withApplicantFields(p0, { age: undefined, state: undefined }, { source: 'user_provided' })
    expect(p1).toBe(p0)
  })

  it('never touches rawNotes through this path', () => {
    const p1 = withApplicantFields(createEmptyApplicantProfile(), { age: 50 }, { source: 'user_provided' })
    expect(p1.data.rawNotes).toEqual([])
  })
})

describe('withRawNote', () => {
  it('appends a trimmed note', () => {
    const p1 = withRawNote(createEmptyApplicantProfile(), '  has a small dairy shed  ')
    expect(p1.data.rawNotes).toEqual(['has a small dairy shed'])
  })

  it('ignores a blank note', () => {
    const p0 = createEmptyApplicantProfile()
    const p1 = withRawNote(p0, '   ')
    expect(p1).toBe(p0)
  })

  it('accumulates multiple notes in order', () => {
    let p = createEmptyApplicantProfile()
    p = withRawNote(p, 'first')
    p = withRawNote(p, 'second')
    expect(p.data.rawNotes).toEqual(['first', 'second'])
  })
})

describe('APPLICANT_PROFILE_FIELD_KEYS', () => {
  it('never includes rawNotes', () => {
    expect(APPLICANT_PROFILE_FIELD_KEYS).not.toContain('rawNotes')
  })

  it('has no duplicate keys', () => {
    expect(new Set(APPLICANT_PROFILE_FIELD_KEYS).size).toBe(APPLICANT_PROFILE_FIELD_KEYS.length)
  })
})

describe('applicantProfileFromUserProfile / applicantProfileToUserProfile', () => {
  const fullUserProfile: UserProfile = {
    state: 'Karnataka',
    district: 'Mandya',
    areaType: 'rural',
    age: 34,
    gender: 'female',
    socialCategory: 'sc',
    annualIncome: 180_000,
    occupation: 'farmer',
    businessStatus: 'idea',
    proposedBusiness: 'a poultry business',
    businessSector: 'poultry',
    investmentRequired: 400_000,
    ownContribution: 40_000,
    financingRequired: 360_000,
    existingLoans: 'none mentioned',
    businessStage: 'new',
    education: '10th',
    landOrAssets: '1 acre',
    rawNotes: ['wants to start soon'],
  }

  it('maps every mappable field and marks provenance as imported_unknown by default', () => {
    const applicant = applicantProfileFromUserProfile(fullUserProfile, { applicantId: 'a1', now: '2026-04-01T00:00:00.000Z' })
    expect(applicant.applicantId).toBe('a1')
    expect(applicant.data).toMatchObject({
      state: 'Karnataka',
      district: 'Mandya',
      areaType: 'rural',
      age: 34,
      gender: 'female',
      socialCategory: 'sc',
      annualIncome: 180_000,
      businessDescription: 'a poultry business',
      businessSector: 'poultry',
      businessStage: 'new',
      businessStatus: 'idea',
      investmentRequired: 400_000,
      ownContribution: 40_000,
      financingRequired: 360_000,
      existingLoans: 'none mentioned',
      education: '10th',
      landOrAssets: '1 acre',
      rawNotes: ['wants to start soon'],
    })
    expect(applicant.fieldProvenance.age).toEqual({ source: 'imported_unknown', capturedAt: '2026-04-01T00:00:00.000Z' })
    // occupation has no ApplicantProfile slot and must not be silently invented into one.
    expect((applicant.data as unknown as Record<string, unknown>).occupation).toBeUndefined()
  })

  it('does not alias rawNotes with the source array', () => {
    const applicant = applicantProfileFromUserProfile(fullUserProfile)
    expect(applicant.data.rawNotes).toEqual(fullUserProfile.rawNotes)
    expect(applicant.data.rawNotes).not.toBe(fullUserProfile.rawNotes)
  })

  it('respects an explicit source override', () => {
    const applicant = applicantProfileFromUserProfile(fullUserProfile, { source: 'user_provided' })
    expect(applicant.fieldProvenance.age?.source).toBe('user_provided')
    expect(applicant.fieldProvenance.businessSector?.source).toBe('user_provided')
  })

  it('produces an empty ApplicantProfileData from EMPTY_PROFILE', () => {
    const applicant = applicantProfileFromUserProfile(EMPTY_PROFILE)
    expect(applicant.data).toEqual({ rawNotes: [] })
    expect(applicant.fieldProvenance).toEqual({})
  })

  it('round-trips a full profile back to an equivalent UserProfile', () => {
    const roundTripped = applicantProfileToUserProfile(applicantProfileFromUserProfile(fullUserProfile))
    expect(roundTripped).toEqual({ ...fullUserProfile, occupation: undefined })
  })

  it('toUserProfile is total (never partial) even for a freshly-created empty profile', () => {
    const userProfile = applicantProfileToUserProfile(createEmptyApplicantProfile())
    expect(userProfile).toEqual({ rawNotes: [] })
  })
})

describe('applicantProfileFromEntrepreneurProfile', () => {
  const cockpitProfile: EntrepreneurProfile = {
    name: 'Lakshmi',
    age: 29,
    gender: 'female',
    community: 'sc',
    annualIncome: 150_000,
    experienceYears: 0,
    villageId: 'dinka-mandya',
    category: 'dairy',
    availableMargin: 100_000,
    phone: '9900000000',
    locationMode: 'curated',
    radiusKm: 7,
  }

  it('maps the fields EntrepreneurProfile actually has, without location', () => {
    const applicant = applicantProfileFromEntrepreneurProfile(cockpitProfile, null, { now: '2026-05-01T00:00:00.000Z' })
    expect(applicant.data).toMatchObject({
      name: 'Lakshmi',
      age: 29,
      gender: 'female',
      phone: '9900000000',
      socialCategory: 'sc',
      businessSector: 'dairy',
      businessExperienceYears: 0,
      annualIncome: 150_000,
      ownContribution: 100_000,
    })
    // Never invented: EntrepreneurProfile/ResolvedLocation carry no explicit state field.
    expect(applicant.data.state).toBeUndefined()
    // Never invented: rurality is a product framing, not a stated field.
    expect(applicant.data.areaType).toBeUndefined()
    // Never invented: experienceYears alone isn't a reliable stage signal.
    expect(applicant.data.businessStage).toBeUndefined()
  })

  it('fills location fields from a supplied ResolvedLocation', () => {
    const location: ResolvedLocation = {
      id: 'dinka-mandya',
      name: 'Dinka',
      nameKn: 'ದಿಂಕಾ',
      district: 'Mandya',
      districtKn: 'ಮಂಡ್ಯ',
      block: 'Malavalli',
      lat: 12.5,
      lng: 76.9,
      population: 4200,
      households: 900,
      nearbyMandi: 'Mandya APMC',
      competitorDensity: { dairy: 0.4, retail: 0.5, food: 0.3, textiles: 0.2, poultry: 0.3, agri_processing: 0.2 },
      purchasingPowerIndex: 0.6,
      milkCoopPresence: true,
      notes: '',
      notesKn: '',
      provenance: 'curated_seed',
      provenanceLabelEn: 'Curated local data for Dinka',
      provenanceLabelKn: '',
      competitors: [],
      competitorQueryOk: true,
      radiusKm: 7,
      hasCuratedSignals: true,
    }
    const applicant = applicantProfileFromEntrepreneurProfile(cockpitProfile, location)
    expect(applicant.data.villageOrTown).toBe('Dinka')
    expect(applicant.data.district).toBe('Mandya')
    expect(applicant.data.lat).toBe(12.5)
    expect(applicant.data.lng).toBe(76.9)
  })

  it('falls back to profile.liveLat/liveLng when no ResolvedLocation is supplied', () => {
    const liveProfile: EntrepreneurProfile = {
      ...cockpitProfile,
      locationMode: 'live',
      liveLat: 15.3,
      liveLng: 75.1,
      liveQuery: 'Hubballi market road',
    }
    const applicant = applicantProfileFromEntrepreneurProfile(liveProfile)
    expect(applicant.data.lat).toBe(15.3)
    expect(applicant.data.lng).toBe(75.1)
    expect(applicant.data.rawLocationText).toBe('Hubballi market road')
  })
})

describe('applicantProfileToEntrepreneurProfileDraft', () => {
  it('maps a valid BusinessCategory sector across', () => {
    const applicant = applicantProfileFromUserProfile({
      ...EMPTY_PROFILE,
      age: 40,
      gender: 'male',
      socialCategory: 'obc',
      annualIncome: 200_000,
      businessSector: 'dairy',
      ownContribution: 50_000,
    })
    const draft = applicantProfileToEntrepreneurProfileDraft(applicant)
    expect(draft).toMatchObject({
      age: 40,
      gender: 'male',
      community: 'obc',
      annualIncome: 200_000,
      category: 'dairy',
      availableMargin: 50_000,
    })
  })

  it('never invents villageId, locationMode, or radiusKm', () => {
    const applicant = applicantProfileFromUserProfile({ ...EMPTY_PROFILE, businessSector: 'dairy' })
    const draft = applicantProfileToEntrepreneurProfileDraft(applicant)
    expect(draft.villageId).toBeUndefined()
    expect(draft.locationMode).toBeUndefined()
    expect(draft.radiusKm).toBeUndefined()
  })

  it('drops a businessSector that is not a valid BusinessCategory rather than guessing', () => {
    const applicant = applicantProfileFromUserProfile({ ...EMPTY_PROFILE, businessSector: 'tailoring' })
    const draft = applicantProfileToEntrepreneurProfileDraft(applicant)
    expect(draft.category).toBeUndefined()
  })

  it('returns an empty object for a freshly-created empty profile', () => {
    expect(applicantProfileToEntrepreneurProfileDraft(createEmptyApplicantProfile())).toEqual({})
  })
})
