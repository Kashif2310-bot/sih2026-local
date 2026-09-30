import { describe, expect, it } from 'vitest'
import {
  extractCitizenFacts,
  findDistrict,
  findExperienceYears,
  findLoanMentions,
  findNhgMembership,
  normalizeNumbers,
} from './extraction'

describe('loan being sought vs an existing loan', () => {
  it('"I want a 12 lakh loan" is the financing needed, not an existing loan', () => {
    const { profile } = extractCitizenFacts('I want a 12 lakh loan')
    expect(profile.financingRequired).toBe(1_200_000)
    expect(profile.existingLoans).toBeUndefined()
  })

  it('spoken numbers work the same: "I need a loan of twelve lakh"', () => {
    const { profile } = extractCitizenFacts('I need a loan of twelve lakh')
    expect(profile.financingRequired).toBe(1_200_000)
    expect(profile.existingLoans).toBeUndefined()
  })

  it('"I already have a loan of 2 lakh" is an existing loan and does not set the financing need', () => {
    const { profile } = extractCitizenFacts('I already have a loan of 2 lakh')
    expect(profile.financingRequired).toBeUndefined()
    expect(profile.existingLoans).toBeDefined()
    expect(profile.businessStage).toBeUndefined()
  })

  it('both in one sentence: the sought amount wins the financing field', () => {
    const mentions = findLoanMentions('I already have a 2 lakh loan and now I want a 5 lakh loan')
    expect(mentions).toEqual([
      { value: 200_000, existing: true },
      { value: 500_000, existing: false },
    ])
    expect(extractCitizenFacts('I already have a 2 lakh loan and now I want a 5 lakh loan').profile.financingRequired).toBe(500_000)
  })

  it('a bare number with no unit or currency is not read as a loan', () => {
    expect(findLoanMentions('loan for 3 cows')).toEqual([])
  })

  it('normalizes number words, including "a lakh"', () => {
    expect(normalizeNumbers('twenty five years and a lakh')).toBe('25 years and 1 lakh')
  })
})

describe('district, experience, NHG and education', () => {
  it('finds Karnataka districts, including older spellings', () => {
    expect(findDistrict('I live in Mysore')).toEqual({ district: 'Mysuru', state: 'Karnataka' })
    expect(findDistrict('we are from Ernakulam')).toEqual({ district: 'Ernakulam', state: 'Kerala' })
  })

  it('a name is not a place: "my name is Hassan" does not set a district', () => {
    expect(findDistrict('my name is Hassan')).toBeUndefined()
    const facts = extractCitizenFacts('my name is Hassan')
    expect(facts.details.applicantName).toBe('Hassan')
    expect(facts.profile.district).toBeUndefined()
  })

  it('infers the state from the district only when no state was said, and marks it as inferred', () => {
    const inferred = extractCitizenFacts('I live in Mandya district')
    expect(inferred.profile.district).toBe('Mandya')
    expect(inferred.details.stateInferredFromDistrict).toBe('Karnataka')
    const stated = extractCitizenFacts('I live in Mandya, Karnataka')
    expect(stated.details.stateInferredFromDistrict).toBeUndefined()
  })

  it('reads years of experience, and "no experience" as zero', () => {
    expect(findExperienceYears('I have 3 years of experience')).toBe(3)
    expect(findExperienceYears('experience of about two years')).toBe(2)
    expect(findExperienceYears('I have been doing tailoring for 5 years')).toBe(5)
    expect(findExperienceYears('I have no experience')).toBe(0)
    expect(findExperienceYears('I am 30 years old')).toBeUndefined()
  })

  it('reads NHG membership', () => {
    expect(findNhgMembership('my NHG name is Sree Durga')).toBe('Sree Durga')
    expect(findNhgMembership('I am a member of Lakshmi NHG')).toBe('Lakshmi')
  })

  it('SSLC means 10th', () => {
    expect(extractCitizenFacts('I passed SSLC').profile.education).toBeDefined()
  })

  it('name and mobile come through as applicant details', () => {
    const { details } = extractCitizenFacts('My name is Lakshmi Devi, my number is 98450 12345')
    expect(details.applicantName).toBe('Lakshmi Devi')
    expect(details.mobile).toBe('9845012345')
  })
})

describe('documents in speech', () => {
  it('a single statement declares every document it names', () => {
    const { documents } = extractCitizenFacts('I have my Aadhaar card and bank passbook')
    expect(documents).toMatchObject({ aadhaar: 'declared_available', bank: 'declared_available' })
  })

  it('"all documents except X" marks everything available and X missing', () => {
    const { documents } = extractCitizenFacts('I have all the documents except the income certificate')
    expect(documents.all).toBe('declared_available')
    expect(documents.income).toBe('missing')
  })

  it('negation marks a document missing', () => {
    expect(extractCitizenFacts("I don't have a caste certificate").documents.caste).toBe('missing')
  })
})
