import { describe, expect, it } from 'vitest'
import {
  OTHER_LOCATION,
  profileFormDraftFromTranscript,
  validateProfileForm,
  type ProfileFormDraft,
} from './profileFormDraft'

const BLANK: ProfileFormDraft = {
  name: '',
  age: null,
  gender: null,
  community: null,
  category: null,
  availableMargin: null,
  annualIncome: null,
  experienceYears: null,
  villageId: null,
  otherLocation: '',
}

describe('profileFormDraftFromTranscript', () => {
  it('fills what the citizen said and leaves the rest blank (the /apply bug report input)', () => {
    const draft = profileFormDraftFromTranscript(
      'my name is Jordan and I want to start a newspaper business in Gulbarga, Karnataka, I am 28 years old, general category, male',
    )
    expect(draft).toEqual({
      ...BLANK,
      name: 'Jordan',
      age: 28,
      gender: 'male',
      community: 'general',
    })
    // The old parser's defaults — "newspaper" and "Gulbarga" must not become Dairy / Dinka (Mandya).
    expect(draft.category).not.toBe('dairy')
    expect(draft.villageId).not.toBe('dinka-mandya')
  })

  it('leaves every field blank for empty input — no demo profile fallback', () => {
    expect(profileFormDraftFromTranscript('')).toEqual(BLANK)
    expect(profileFormDraftFromTranscript('   ')).toEqual(BLANK)
  })

  it('maps an unambiguous sector and the margin, but never infers a village from a district name', () => {
    const draft = profileFormDraftFromTranscript('I want to start a dairy business in Mandya with one lakh rupees margin')
    expect(draft.category).toBe('dairy')
    expect(draft.availableMargin).toBe(100_000)
    expect(draft.villageId).toBeNull()
  })

  it('maps tailoring onto Textiles / Tailoring', () => {
    expect(profileFormDraftFromTranscript('I want to start a tailoring business').category).toBe('textiles')
  })

  it('leaves the category blank when the sector has no unambiguous scan category (catering vs pickle making)', () => {
    expect(profileFormDraftFromTranscript('I want to start a catering business').category).toBeNull()
  })

  it('fills Available margin capital from "I have a capital of 4 lakhs"', () => {
    expect(profileFormDraftFromTranscript('I have a capital of 4 lakhs').availableMargin).toBe(400_000)
  })

  it('fills annual income only when the citizen states it', () => {
    expect(profileFormDraftFromTranscript('my annual income is ₹2 lakh').annualIncome).toBe(200_000)
  })

  it('leaves every field blank for Hindi or Kannada input rather than guessing — extraction is English-only', () => {
    expect(
      profileFormDraftFromTranscript(
        'मेरा नाम जॉर्डन है, मेरी उम्र 28 साल है, मैं पुरुष हूँ और मैं गुलबर्गा में अखबार का व्यवसाय शुरू करना चाहता हूँ',
      ),
    ).toEqual(BLANK)
    expect(
      profileFormDraftFromTranscript('ನಾನು ಮಂಡ್ಯದಲ್ಲಿ ಒಂದು ಲಕ್ಷ ರೂಪಾಯಿ ಮಾರ್ಜಿನ್‌ನೊಂದಿಗೆ ಹೈನುಗಾರಿಕೆ ಪ್ರಾರಂಭಿಸಲು ಬಯಸುತ್ತೇನೆ'),
    ).toEqual(BLANK)
  })
})

describe('validateProfileForm', () => {
  const complete: ProfileFormDraft = {
    name: '  Jordan  ',
    age: 28,
    gender: 'male',
    community: 'general',
    category: 'retail',
    availableMargin: 50_000,
    annualIncome: 0,
    experienceYears: 0,
    villageId: 'kunigal-tumakuru',
    otherLocation: '',
  }

  it('requires every blank field instead of submitting a default', () => {
    const result = validateProfileForm(BLANK)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(Object.keys(result.errors).sort()).toEqual(
      [
        'age',
        'annualIncome',
        'availableMargin',
        'category',
        'community',
        'experienceYears',
        'gender',
        'name',
        'villageId',
      ].sort(),
    )
  })

  it('submits only the visible fields — no demoMode and no hidden radius', () => {
    const result = validateProfileForm(complete)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.profile).toEqual({
      name: 'Jordan',
      age: 28,
      gender: 'male',
      community: 'general',
      category: 'retail',
      availableMargin: 50_000,
      annualIncome: 0,
      experienceYears: 0,
      villageId: 'kunigal-tumakuru',
      locationMode: 'curated',
    })
    expect(result.profile).not.toHaveProperty('demoMode')
    expect(result.profile).not.toHaveProperty('radiusKm')
  })

  it('"Other / not listed" requires the typed place, not a village', () => {
    const result = validateProfileForm({ ...complete, villageId: OTHER_LOCATION, otherLocation: '   ' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(Object.keys(result.errors)).toEqual(['otherLocation'])
  })

  it('"Other / not listed" submits the typed place as a live location with no curated village', () => {
    const result = validateProfileForm({
      ...complete,
      villageId: OTHER_LOCATION,
      otherLocation: '  Gulbarga, Karnataka ',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.profile.locationMode).toBe('live')
    expect(result.profile.liveQuery).toBe('Gulbarga, Karnataka')
    expect(result.profile.villageId).toBe('')
    expect(result.profile).not.toHaveProperty('demoMode')
    expect(result.profile).not.toHaveProperty('radiusKm')
  })

  it('ignores leftover typed text once a curated village is chosen again', () => {
    const result = validateProfileForm({ ...complete, otherLocation: 'Gulbarga' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.profile.locationMode).toBe('curated')
    expect(result.profile).not.toHaveProperty('liveQuery')
  })

  it('applies the same range rules as the /scan form', () => {
    const tooYoung = validateProfileForm({ ...complete, age: 17 })
    expect(!tooYoung.ok && tooYoung.errors.age?.key).toBe('validation.ageRange')

    const overCap = validateProfileForm({ ...complete, availableMargin: 600_000 })
    expect(!overCap.ok && overCap.errors.availableMargin?.key).toBe('validation.marginMax')

    const negativeIncome = validateProfileForm({ ...complete, annualIncome: -1 })
    expect(!negativeIncome.ok && negativeIncome.errors.annualIncome?.key).toBe('validation.incomeNegative')
  })
})
