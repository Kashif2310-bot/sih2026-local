import { describe, expect, it } from 'vitest'
import { EMPTY_PROFILE } from './types'
import { extractAndMerge, extractApplicantName, extractProfileFromMessage } from './profileExtraction'
import { identifyMissingFields, effectiveFinancingNeed } from './missingFields'

describe('extractProfileFromMessage — demo scenario 1 (poultry, Karnataka, SC)', () => {
  const text =
    'I am 24 years old, from rural Karnataka, SC, my annual income is about ₹2 lakh, and I want to start a poultry business requiring ₹3 lakh.'
  const extracted = extractProfileFromMessage(text)

  it('extracts age, area type, state, category, income, sector, stage and investment', () => {
    expect(extracted.age).toBe(24)
    expect(extracted.areaType).toBe('rural')
    expect(extracted.state).toBe('Karnataka')
    expect(extracted.socialCategory).toBe('sc')
    expect(extracted.annualIncome).toBe(200_000)
    expect(extracted.businessSector).toBe('poultry')
    expect(extracted.businessStage).toBe('new')
    expect(extracted.businessStatus).toBe('idea')
    expect(extracted.investmentRequired).toBe(300_000)
  })
})

describe('extractProfileFromMessage — demo scenario 2 (tailoring, Kerala, woman, expansion)', () => {
  const text =
    'I am a 47-year-old woman in Kerala with an existing tailoring business. I earn ₹6 lakh annually and need ₹8 lakh to expand.'
  const extracted = extractProfileFromMessage(text)

  it('extracts age, gender, state, sector, stage, income and financing need', () => {
    expect(extracted.age).toBe(47)
    expect(extracted.gender).toBe('female')
    expect(extracted.state).toBe('Kerala')
    expect(extracted.businessSector).toBe('tailoring')
    expect(extracted.businessStage).toBe('existing_expansion')
    expect(extracted.businessStatus).toBe('existing')
    expect(extracted.annualIncome).toBe(600_000)
    expect(extracted.financingRequired).toBe(800_000)
  })

  it('produces a materially different profile from scenario 1', () => {
    const other = extractProfileFromMessage(
      'I am 24 years old, from rural Karnataka, SC, my annual income is about ₹2 lakh, and I want to start a poultry business requiring ₹3 lakh.',
    )
    expect(extracted.state).not.toBe(other.state)
    expect(extracted.businessSector).not.toBe(other.businessSector)
    expect(extracted.businessStage).not.toBe(other.businessStage)
  })
})

describe('extractProfileFromMessage — edge cases', () => {
  it('returns an empty extraction for an empty string without throwing', () => {
    expect(() => extractProfileFromMessage('')).not.toThrow()
    expect(extractProfileFromMessage('')).toEqual({})
  })

  it('does not misread a bare age number as a rupee amount', () => {
    const extracted = extractProfileFromMessage('I am 30 years old.')
    expect(extracted.age).toBe(30)
    expect(extracted.annualIncome).toBeUndefined()
    expect(extracted.investmentRequired).toBeUndefined()
  })

  it('does not treat "St." or "1st" as a Scheduled Tribe mention', () => {
    const extracted = extractProfileFromMessage('I live on 1st Main St. in the city.')
    expect(extracted.socialCategory).toBeUndefined()
  })

  it('handles nonsense/garbled input gracefully', () => {
    expect(() => extractProfileFromMessage('asdkjasjd 123 ###@@ %%%')).not.toThrow()
  })

  it('recognizes "retail business" phrasing, not just "retail shop"', () => {
    const extracted = extractProfileFromMessage('I want to start a retail business requiring ₹12 lakh.')
    expect(extracted.businessSector).toBe('retail')
  })

  it('BUG REGRESSION: a "not <state>" correction picks the corrected state, not whichever name is longer', () => {
    // Karnataka (9 letters) is longer than Kerala (6) — a naive "prefer the
    // longer match" rule would silently keep the wrong, negated state.
    const extracted = extractProfileFromMessage('Actually I am in Kerala, not Karnataka.')
    expect(extracted.state).toBe('Kerala')
  })

  it('picks the corrected state when the negated one is shorter and mentioned first', () => {
    const extracted = extractProfileFromMessage('Not Bihar, I meant Karnataka.')
    expect(extracted.state).toBe('Karnataka')
  })
})

describe('mergeProfile / extractAndMerge', () => {
  it('merges new fields into an existing profile, overwriting on new evidence', () => {
    const first = extractAndMerge('I am from Karnataka and want to start a poultry business.', EMPTY_PROFILE)
    expect(first.profile.state).toBe('Karnataka')
    expect(first.profile.businessSector).toBe('poultry')

    const second = extractAndMerge('Actually I am based in Kerala now.', first.profile)
    expect(second.profile.state).toBe('Kerala')
    expect(second.profile.businessSector).toBe('poultry') // untouched field persists
    expect(second.updatedFields).toContain('state')
  })
})

describe('identifyMissingFields', () => {
  it('flags sector as top priority when nothing is known', () => {
    const missing = identifyMissingFields(EMPTY_PROFILE)
    expect(missing[0].field).toBe('businessSector')
  })

  it('does not flag a field once it is known', () => {
    const missing = identifyMissingFields({ ...EMPTY_PROFILE, businessSector: 'poultry' })
    expect(missing.some((m) => m.field === 'businessSector')).toBe(false)
  })

  it('only asks about existing loans when the business status is existing', () => {
    const idea = identifyMissingFields({ ...EMPTY_PROFILE, businessStatus: 'idea' })
    const existing = identifyMissingFields({ ...EMPTY_PROFILE, businessStatus: 'existing' })
    expect(idea.some((m) => m.field === 'existingLoans')).toBe(false)
    expect(existing.some((m) => m.field === 'existingLoans')).toBe(true)
  })
})

describe('effectiveFinancingNeed', () => {
  it('prefers an explicit financing requirement over investment size', () => {
    expect(effectiveFinancingNeed({ ...EMPTY_PROFILE, financingRequired: 800_000, investmentRequired: 1_000_000 })).toBe(
      800_000,
    )
  })

  it('falls back to investment minus own contribution', () => {
    expect(
      effectiveFinancingNeed({ ...EMPTY_PROFILE, investmentRequired: 300_000, ownContribution: 50_000 }),
    ).toBe(250_000)
  })

  it('is undefined when nothing is known', () => {
    expect(effectiveFinancingNeed(EMPTY_PROFILE)).toBeUndefined()
  })
})

describe('extractProfileFromMessage — voice/STT-shaped phrasings (age, gender, category, amounts)', () => {
  // Every phrasing here was verified against the pre-fix code first, so
  // each `it` below documents a real, previously-reproduced gap, not a
  // hypothetical one.

  it('the /apply placeholder example — the one that motivated this fix — extracts sector and own contribution', () => {
    const extracted = extractProfileFromMessage(
      'I want to start a dairy business in Mandya with one lakh rupees margin',
    )
    expect(extracted.businessSector).toBe('dairy')
    expect(extracted.ownContribution).toBe(100_000)
  })

  it('the full reported sentence extracts age, gender, category, sector, and own contribution together', () => {
    const extracted = extractProfileFromMessage(
      'I want to start a dairy business in Mandya with one lakh rupees margin. I am 24 years old, female, SC category.',
    )
    expect(extracted.age).toBe(24)
    expect(extracted.gender).toBe('female')
    expect(extracted.socialCategory).toBe('sc')
    expect(extracted.businessSector).toBe('dairy')
    expect(extracted.ownContribution).toBe(100_000)
  })

  it('spelled-out age survives alongside gender and category (previously: age was dropped)', () => {
    const extracted = extractProfileFromMessage("I'm twenty four, a woman, from the SC community")
    expect(extracted.age).toBe(24)
    expect(extracted.gender).toBe('female')
    expect(extracted.socialCategory).toBe('sc')
  })

  it('digit age + gender + OBC together (already worked; guards against regressing it)', () => {
    const extracted = extractProfileFromMessage('24 year old man, OBC')
    expect(extracted.age).toBe(24)
    expect(extracted.gender).toBe('male')
    expect(extracted.socialCategory).toBe('obc')
  })

  it('"category general" — category before general — is recognized (previously: undefined)', () => {
    const extracted = extractProfileFromMessage('age 35, gender male, category general')
    expect(extracted.age).toBe(35)
    expect(extracted.gender).toBe('male')
    expect(extracted.socialCategory).toBe('general')
  })

  it('hyphenated digit age + gender (already worked; guards against regressing it)', () => {
    const extracted = extractProfileFromMessage('I am a 47-year-old woman')
    expect(extracted.age).toBe(47)
    expect(extracted.gender).toBe('female')
  })

  describe('age: spelled-out numbers (task requirement C)', () => {
    it('"twenty four years old"', () => {
      expect(extractProfileFromMessage('twenty four years old').age).toBe(24)
    })
    it('"twenty-four" (hyphenated)', () => {
      expect(extractProfileFromMessage('I am twenty-four years old').age).toBe(24)
    })
    it('"thirty five years old"', () => {
      expect(extractProfileFromMessage('thirty five years old').age).toBe(35)
    })
    it('"age forty"', () => {
      expect(extractProfileFromMessage('age forty').age).toBe(40)
    })
    it('a bare tens word without a ones word ("age twenty")', () => {
      expect(extractProfileFromMessage('age twenty').age).toBe(20)
    })
  })

  describe('social category: lowercase and spaced-out acronyms', () => {
    it('lowercase "sc category" is recognized only next to a disambiguating word', () => {
      expect(extractProfileFromMessage('I am sc category').socialCategory).toBe('sc')
    })
    it('letter-spaced "S C category" (STT artifact) is recognized', () => {
      expect(extractProfileFromMessage('I am S C category').socialCategory).toBe('sc')
    })
    it('letter-spaced lowercase "o b c community" is recognized', () => {
      expect(extractProfileFromMessage('from the o b c community').socialCategory).toBe('obc')
    })
  })

  describe('money: number words with units (task requirement A)', () => {
    it('"one lakh"', () => {
      expect(extractProfileFromMessage('margin money of one lakh').ownContribution).toBe(100_000)
    })
    it('"two lakh"', () => {
      expect(extractProfileFromMessage('margin money of two lakh').ownContribution).toBe(200_000)
    })
    it('"fifty thousand"', () => {
      expect(extractProfileFromMessage('margin money of fifty thousand').ownContribution).toBe(50_000)
    })
    it('"1.5 lakh" (digit form, already supported — guards against regressing it)', () => {
      expect(extractProfileFromMessage('margin money of 1.5 lakh').ownContribution).toBe(150_000)
    })
    it('"one and a half lakh" (spoken idiom)', () => {
      expect(extractProfileFromMessage('margin money of one and a half lakh').ownContribution).toBe(150_000)
    })
  })

  describe('money: keyword after the amount, not just before', () => {
    it('"margin" trailing the amount, no digit — the exact reported phrasing', () => {
      expect(extractProfileFromMessage('one lakh rupees margin').ownContribution).toBe(100_000)
    })
    it('"margin money" trailing the amount, digit form', () => {
      expect(extractProfileFromMessage('1 lakh rupees margin money').ownContribution).toBe(100_000)
    })
    it('keyword leading the amount still works (unchanged direction)', () => {
      expect(extractProfileFromMessage('margin money of 1 lakh').ownContribution).toBe(100_000)
    })
    it('a financing keyword leading the amount still works (unchanged direction)', () => {
      expect(extractProfileFromMessage('I need a loan of 1 lakh').financingRequired).toBe(100_000)
    })
  })

  describe('false-positive guards are preserved (task requirement D)', () => {
    it('"1st" is never read as Scheduled Tribe', () => {
      expect(extractProfileFromMessage('I finished 1st in my class').socialCategory).toBeUndefined()
    })
    it('"St." (street) is never read as Scheduled Tribe', () => {
      expect(extractProfileFromMessage('I live on 5th St. near the market').socialCategory).toBeUndefined()
    })
    it('a bare, unpaired lowercase acronym stays ambiguous and undefined', () => {
      expect(extractProfileFromMessage('I am sc').socialCategory).toBeUndefined()
    })
    it('an unrecognized phrasing leaves the field undefined rather than guessing', () => {
      expect(extractProfileFromMessage('not sure what category I am').socialCategory).toBeUndefined()
    })
  })

  describe('number-word normalization stays scoped to age/money (task requirement B)', () => {
    it('an ordinary "one" elsewhere does not create a spurious age or money value', () => {
      const extracted = extractProfileFromMessage('I have one child and want to expand my shop')
      expect(extracted.age).toBeUndefined()
      expect(extracted.ownContribution).toBeUndefined()
      expect(extracted.annualIncome).toBeUndefined()
      expect(extracted.financingRequired).toBeUndefined()
      expect(extracted.investmentRequired).toBeUndefined()
    })
    it('gender/state extraction is unaffected by a spelled-out number in the same message', () => {
      const extracted = extractProfileFromMessage('I am twenty four, a woman, from Karnataka')
      expect(extracted.gender).toBe('female')
      expect(extracted.state).toBe('Karnataka')
    })
    it('a business sector mention is unaffected when the message also has a spelled amount', () => {
      expect(extractProfileFromMessage('one lakh for my dairy business').businessSector).toBe('dairy')
    })
  })

  describe('bare "I\'m/I am <number>" age pattern never fires on non-age statements (overnight hardening)', () => {
    it('"I\'m 5 km from Mandya" — distance, not age', () => {
      expect(extractProfileFromMessage("I'm 5 km from Mandya").age).toBeUndefined()
    })
    it('"I am 2 years into dairy farming" — duration/experience, not age', () => {
      expect(extractProfileFromMessage('I am 2 years into dairy farming').age).toBeUndefined()
    })
    it('"I\'m 3 lakh short" — a shortfall amount, not age', () => {
      expect(extractProfileFromMessage("I'm 3 lakh short").age).toBeUndefined()
    })
    it('"I am 50000 rupees short" — an amount, not age', () => {
      expect(extractProfileFromMessage('I am 50000 rupees short').age).toBeUndefined()
    })
    it('"I have 24 cows" — no "I\'m"/"I am" self-identification at all', () => {
      expect(extractProfileFromMessage('I have 24 cows').age).toBeUndefined()
    })
    it('"I\'m 200" — outside the 18-100 plausibility range for this pattern', () => {
      expect(extractProfileFromMessage("I'm 200").age).toBeUndefined()
    })

    it('"I\'m 24" — a genuine bare age statement still works', () => {
      expect(extractProfileFromMessage("I'm 24").age).toBe(24)
    })
    it('"I am twenty four" — spelled-out, still works', () => {
      expect(extractProfileFromMessage('I am twenty four').age).toBe(24)
    })
    it('"I\'m 24 and female" — trailing unrelated text does not disqualify it', () => {
      const extracted = extractProfileFromMessage("I'm 24 and female")
      expect(extracted.age).toBe(24)
      expect(extracted.gender).toBe('female')
    })
    it('"I\'m 35, general category" — trailing category text does not disqualify it', () => {
      const extracted = extractProfileFromMessage("I'm 35, general category")
      expect(extracted.age).toBe(35)
      expect(extracted.socialCategory).toBe('general')
    })

    it('explicit "N years old" is unaffected by the new 18-100 range (keeps existing 0-120 behavior)', () => {
      // 110 is outside the new bare pattern's 18-100 range but inside
      // patterns 1/2's original 0-120 range — a value chosen specifically
      // to prove patterns 1/2 were left untouched, not a realistic age.
      expect(extractProfileFromMessage('I am 110 years old').age).toBe(110)
    })
  })
})

describe('extractApplicantName', () => {
  it('takes the name after "my name is" and stops at the next clause', () => {
    expect(
      extractApplicantName(
        'my name is Jordan and I want to start a newspaper business in Gulbarga, Karnataka, I am 28 years old, general category, male',
      ),
    ).toBe('Jordan')
    expect(extractApplicantName('My name is Priya Sharma, I am 30')).toBe('Priya Sharma')
    expect(extractApplicantName("my name's Ravi")).toBe('Ravi')
  })

  it('capitalizes a lowercased speech-to-text name', () => {
    expect(extractApplicantName('my name is lakshmi devi and i run a shop')).toBe('Lakshmi Devi')
  })

  it('caps a run-on capture at four words', () => {
    expect(extractApplicantName('my name is one two three four five six')).toBe('One Two Three Four')
  })

  it('never guesses a name from "I am …", which is usually an age, status or occupation', () => {
    expect(extractApplicantName('I am 28 years old')).toBeUndefined()
    expect(extractApplicantName('I am a farmer from Mandya')).toBeUndefined()
    expect(extractApplicantName('my name is')).toBeUndefined()
  })
})

describe('extractProfileFromMessage — "capital" as own contribution', () => {
  it('reads "I have a capital of 4 lakhs" as own contribution, not investment', () => {
    const extracted = extractProfileFromMessage('I have a capital of 4 lakhs')
    expect(extracted.ownContribution).toBe(400_000)
    expect(extracted.investmentRequired).toBeUndefined()
  })

  it('reads other possessive phrasings on either side of the amount', () => {
    expect(extractProfileFromMessage('I have 4 lakhs capital').ownContribution).toBe(400_000)
    expect(extractProfileFromMessage('my own capital is ₹2 lakh').ownContribution).toBe(200_000)
    expect(extractProfileFromMessage('we have got some capital of ₹50,000').ownContribution).toBe(50_000)
  })

  it('does not treat working capital as the citizen’s own money', () => {
    const needed = extractProfileFromMessage('I need working capital of 2 lakh')
    expect(needed.ownContribution).toBeUndefined()
    expect(needed.investmentRequired).toBe(200_000) // unchanged from before this rule
    expect(extractProfileFromMessage('I have 4 lakh working capital').ownContribution).toBeUndefined()
  })

  it('does not fire on an unrelated or needed "capital"', () => {
    const city = extractProfileFromMessage('Bengaluru is the capital of Karnataka and I want a loan of 3 lakh')
    expect(city.ownContribution).toBeUndefined()
    expect(city.financingRequired).toBe(300_000)

    const need = extractProfileFromMessage('I need 4 lakh capital')
    expect(need.ownContribution).toBeUndefined()
    expect(need.financingRequired).toBe(400_000)

    const setup = extractProfileFromMessage('I need a capital of 5 lakh to set up')
    expect(setup.ownContribution).toBeUndefined()
    expect(setup.investmentRequired).toBe(500_000)
  })
})
