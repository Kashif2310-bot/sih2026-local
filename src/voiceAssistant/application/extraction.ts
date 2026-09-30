import { extractProfileFromMessage } from '../../assistant/profileExtraction'
import type { UserProfile } from '../../assistant/types'
import { VILLAGES } from '../../data/villages'
import { extractDocumentStatement, type DocumentStatement } from './documents'

/**
 * Applicant facts the scheme forms and the feasibility report need but the
 * main prototype's UserProfile does not carry: its apply catalog treats name,
 * mobile and NHG membership as user-supplied overrides, and experience is a
 * LokScore input only.
 */
export interface ApplicantDetails {
  applicantName?: string
  mobile?: string
  experienceYears?: number
  nhgMembership?: string
  /** A curated village from the main prototype's seed data, when the citizen names one. */
  curatedVillageId?: string
  /** The state was taken from the district list, not said outright; the form asks the citizen to confirm it. */
  stateInferredFromDistrict?: string
}

export interface CitizenFacts {
  profile: Partial<UserProfile>
  details: ApplicantDetails
  documents: DocumentStatement
}

const NAME_STOPWORDS = new Set([
  'and', 'i', 'im', 'am', 'from', 'aged', 'age', 'my', 'is', 'the', 'a', 'an', 'years', 'year', 'who', 'but', 'so',
  'living', 'live', 'staying', 'here', 'there', 'please', 'sir', 'madam', 'ji', 'also', 'currently', 'now',
])

const NAME_PATTERN = /\b(?:my\s+name\s+is|my\s+name's|name\s*:\s*|i\s+am\s+called|i'm\s+called|call\s+me|myself)\s+([a-z][a-z.'-]*(?:\s+[a-z][a-z.'-]*){0,3})/i

function titleCase(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
}

export function findApplicantName(text: string): string | undefined {
  const match = text.match(NAME_PATTERN)
  if (!match) return undefined
  const words: string[] = []
  for (const raw of match[1].split(/\s+/)) {
    const word = raw.replace(/[.'-]+$/, '')
    if (!word || NAME_STOPWORDS.has(word.toLowerCase()) || /\d/.test(word)) break
    words.push(titleCase(word))
  }
  return words.length > 0 ? words.join(' ') : undefined
}

/** Indian mobile numbers: 10 digits starting 6-9, optionally written with +91, spaces or hyphens. */
export function findMobile(text: string): string | undefined {
  const match = text.match(/(?:\+?91[\s-]?)?((?:[6-9])(?:[\s-]?\d){9})(?!\d)/)
  if (!match) return undefined
  const digits = match[1].replace(/\D/g, '')
  return digits.length === 10 ? digits : undefined
}

const SMALL_NUMBERS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
}
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 }

/** Speech arrives as words ("twelve lakh", "two years"); matching below works on digits. */
export function normalizeNumbers(text: string): string {
  return text
    .replace(
      new RegExp(`\\b(${Object.keys(TENS).join('|')})[\\s-]+(${Object.keys(SMALL_NUMBERS).slice(1, 10).join('|')})\\b`, 'gi'),
      (_, tens: string, ones: string) => String(TENS[tens.toLowerCase()] + SMALL_NUMBERS[ones.toLowerCase()]),
    )
    .replace(new RegExp(`\\b(${[...Object.keys(SMALL_NUMBERS), ...Object.keys(TENS)].join('|')})\\b`, 'gi'), (word) =>
      String(SMALL_NUMBERS[word.toLowerCase()] ?? TENS[word.toLowerCase()]),
    )
    .replace(/\ba\s+(lakh|lac|crore)\b/gi, '1 $1')
}

function toRupees(amount: string, unit: string | undefined): number | undefined {
  const value = Number(amount.replace(/,/g, ''))
  if (!Number.isFinite(value) || value <= 0) return undefined
  const u = unit?.toLowerCase() ?? ''
  if (u.startsWith('lakh') || u.startsWith('lac')) return Math.round(value * 100_000)
  if (u.startsWith('crore')) return Math.round(value * 10_000_000)
  if (u === 'thousand' || u === 'k') return Math.round(value * 1_000)
  return Math.round(value)
}

const AMOUNT = String.raw`(₹|rs\.?|inr)?\s*(\d[\d,]*(?:\.\d+)?)\s*(lakhs?|lacs?|crores?|thousand|k)?`
const EXISTING_MARKER = /\b(?:already|existing|running|outstanding|current(?:ly)?|previous|old|took|taken|repaying|pending)\b/gi
const NEED_MARKER = /\b(?:want|need|require|looking|apply|applying|get|seeking|request)\b/gi

interface LoanMention {
  value: number
  existing: boolean
}

function lastIndexOf(pattern: RegExp, text: string): number {
  let last = -1
  for (const match of text.matchAll(pattern)) last = match.index ?? last
  return last
}

/**
 * "I want a 12 lakh loan" and "a loan of 12 lakh" name the loan being sought;
 * "I already have a loan of 2 lakh" names an existing one. Whichever marker is
 * nearer before the amount decides.
 */
export function findLoanMentions(text: string): LoanMention[] {
  const lower = normalizeNumbers(text).toLowerCase()
  const patterns = [
    new RegExp(`${AMOUNT}\\s*(?:rupees?\\s+|rs\\.?\\s+)?(?:worth\\s+of\\s+)?(?:bank\\s+)?loan\\b`, 'gi'),
    new RegExp(`\\bloan\\s+(?:amount\\s+)?(?:of|for|about|around|is|:)\\s*(?:about\\s+|around\\s+|nearly\\s+|approximately\\s+)?${AMOUNT}`, 'gi'),
  ]
  const mentions: Array<LoanMention & { index: number }> = []
  for (const pattern of patterns) {
    for (const match of lower.matchAll(pattern)) {
      const [whole, currency, amount, unit] = match
      if (!currency && !unit) continue
      const value = toRupees(amount, unit)
      if (value === undefined) continue
      const index = match.index ?? 0
      const before = lower.slice(Math.max(0, index - 45), index + whole.indexOf(amount))
      const existing = lastIndexOf(EXISTING_MARKER, before) > lastIndexOf(NEED_MARKER, before)
      if (!mentions.some((m) => m.index === index)) mentions.push({ value, existing, index })
    }
  }
  return mentions.sort((a, b) => a.index - b.index).map(({ value, existing }) => ({ value, existing }))
}

const EXPERIENCE_PATTERNS: RegExp[] = [
  /\b(\d+(?:\.\d+)?)\s*\+?\s*(?:years?|yrs?)\s+(?:of\s+)?(?:work(?:ing)?\s+)?experience\b/i,
  /\bexperience\s+(?:of\s+|is\s+|:\s*)?(?:about\s+|around\s+|nearly\s+)?(\d+(?:\.\d+)?)\s*(?:years?|yrs?)\b/i,
  /\b(?:doing|running|working\s+(?:in|at|as|on)|worked\s+(?:in|at|as|on))\b[^.]{0,30}?\bfor\s+(?:the\s+(?:last|past)\s+)?(\d+(?:\.\d+)?)\s+years?\b/i,
]
const NO_EXPERIENCE = /\b(?:no|zero|without(?:\s+any)?|don'?t\s+have\s+(?:any\s+)?|do\s+not\s+have\s+(?:any\s+)?)\s*(?:prior\s+|previous\s+|work\s+|business\s+)?experience\b|\bfresher\b/i

export function findExperienceYears(text: string): number | undefined {
  const normalized = normalizeNumbers(text)
  if (NO_EXPERIENCE.test(normalized)) return 0
  for (const pattern of EXPERIENCE_PATTERNS) {
    const match = normalized.match(pattern)
    if (match) {
      const years = Number(match[1])
      if (Number.isFinite(years) && years >= 0 && years < 70) return years
    }
  }
  return undefined
}

const WORD_STOP = new Set(['and', 'i', 'im', 'my', 'is', 'the', 'a', 'an', 'but', 'so', 'we', 'our', 'it', 'please', 'also', 'where', 'which'])

function trimPhrase(raw: string): string | undefined {
  const words: string[] = []
  for (const word of raw.trim().split(/\s+/)) {
    const clean = word.replace(/[^a-z0-9.'-]/gi, '')
    if (!clean || WORD_STOP.has(clean.toLowerCase())) break
    words.push(/\d/.test(clean) ? clean.toUpperCase() : titleCase(clean))
  }
  return words.length > 0 ? words.join(' ') : undefined
}

export function findNhgMembership(text: string): string | undefined {
  const named = text.match(/\b(?:nhg|neighbou?rhood\s+group)(?:\s+name)?\s+(?:is|:|called|named)\s+([a-z0-9][a-z0-9 .'-]{1,60})/i)
  if (named) return trimPhrase(named[1])
  const member = text.match(/\bmember\s+of\s+(?:the\s+)?([a-z0-9][a-z0-9 .'-]{1,50}?)\s+(?:nhg|neighbou?rhood\s+group)\b/i)
  if (member) return trimPhrase(member[1])
  const id = text.match(/\b(?:nhg|membership)\s+(?:id|number|no\.?)\s*(?:is|:)?\s*([a-z0-9-]{3,30})\b/i)
  return id ? id[1].toUpperCase() : undefined
}

/** Karnataka and Kerala districts (official names, with the common older spellings people still use). */
const DISTRICTS: Array<{ name: string; state: string; aliases: string[] }> = [
  ['Bagalkote', ['bagalkot']], ['Ballari', ['bellary']], ['Belagavi', ['belgaum']], ['Bengaluru Rural', []],
  ['Bengaluru Urban', ['bengaluru', 'bangalore']], ['Bidar', []], ['Chamarajanagar', ['chamarajanagara']],
  ['Chikkaballapur', ['chikballapur']], ['Chikkamagaluru', ['chikmagalur']], ['Chitradurga', []],
  ['Dakshina Kannada', ['mangalore', 'mangaluru']], ['Davanagere', ['davangere']], ['Dharwad', []], ['Gadag', []],
  ['Hassan', []], ['Haveri', []], ['Kalaburagi', ['gulbarga']], ['Kodagu', ['coorg']], ['Kolar', []], ['Koppal', []],
  ['Mandya', []], ['Mysuru', ['mysore']], ['Raichur', []], ['Ramanagara', []], ['Shivamogga', ['shimoga']],
  ['Tumakuru', ['tumkur']], ['Udupi', []], ['Uttara Kannada', ['karwar']], ['Vijayapura', ['bijapur']],
  ['Vijayanagara', []], ['Yadgir', []],
].map(([name, aliases]) => ({ name: name as string, state: 'Karnataka', aliases: aliases as string[] }))
  .concat(
    [
      ['Thiruvananthapuram', ['trivandrum']], ['Kollam', ['quilon']], ['Pathanamthitta', []], ['Alappuzha', ['alleppey']],
      ['Kottayam', []], ['Idukki', []], ['Ernakulam', []], ['Thrissur', ['trichur']], ['Palakkad', ['palghat']],
      ['Malappuram', []], ['Kozhikode', ['calicut']], ['Wayanad', []], ['Kannur', ['cannanore']], ['Kasaragod', ['kasargod']],
    ].map(([name, aliases]) => ({ name: name as string, state: 'Kerala', aliases: aliases as string[] })),
  )

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function findDistrict(text: string): { district: string; state?: string } | undefined {
  // A name is not a place: "my name is Hassan" must not set the Hassan district.
  const withoutName = text.replace(NAME_PATTERN, ' ')
  let best: { district: string; state: string; index: number } | undefined
  for (const entry of DISTRICTS) {
    for (const spelling of [entry.name, ...entry.aliases]) {
      const match = new RegExp(`\\b${escapeRegExp(spelling)}\\b`, 'i').exec(withoutName)
      if (match && (!best || match.index > best.index)) best = { district: entry.name, state: entry.state, index: match.index }
    }
  }
  if (best) return { district: best.district, state: best.state }

  const before = withoutName.match(/\b(?:in|from|of|at|near)\s+([a-z]+(?:\s+[a-z]+)?)\s+district\b/i)
  const after = withoutName.match(/\bdistrict\s*(?:is|:|-|name\s+is)?\s+([a-z]+(?:\s+[a-z]+)?)/i)
  const raw = before?.[1] ?? after?.[1]
  const district = raw ? trimPhrase(raw) : undefined
  return district ? { district } : undefined
}

export function findCuratedVillage(text: string): { id: string; district: string } | undefined {
  for (const village of VILLAGES) {
    if (new RegExp(`\\b${escapeRegExp(village.name)}\\b`, 'i').test(text)) return { id: village.id, district: village.district }
  }
  return undefined
}

function findEducationSupplement(text: string): string | undefined {
  if (/\bsslc\b/i.test(text)) return '10th'
  if (/\b(?:puc|pre[- ]university|higher\s+secondary|plus\s+two)\b/i.test(text)) return '12th'
  const normalized = normalizeNumbers(text)
  const cls = normalized.match(/\b(?:class|standard|std)\s*(8|10|12)\b|\b(8|10|12)(?:th)?\s*(?:standard|std|class)\b/i)
  return cls ? `${cls[1] ?? cls[2]}th` : undefined
}

const EXPANSION_EVIDENCE =
  /\bexpand(?:ing)?\b|\bscale up\b|\bgrow(?:ing)? (?:my|the|our)\s+business\b|\bexisting\b[^.]*\bbusiness\b|already\s+(?:run|running|operating)|already\s+have\s+(?:a|an|my)?\s*(?:\w+\s+)?(?:business|shop|unit|enterprise|farm|dairy|store)\b/i

/**
 * One utterance → every fact it carries. Runs the main prototype's extractor
 * unchanged, then corrects the phrasings it gets wrong for application
 * filling (a loan being sought read as an existing loan, or not read at all).
 */
export function extractCitizenFacts(text: string): CitizenFacts {
  const profile = extractProfileFromMessage(text)
  const details: ApplicantDetails = {}

  const loans = findLoanMentions(text)
  const sought = loans.filter((loan) => !loan.existing)
  const existing = loans.filter((loan) => loan.existing)
  if (sought.length > 0) profile.financingRequired = sought[sought.length - 1].value
  else if (existing.some((loan) => loan.value === profile.financingRequired)) delete profile.financingRequired
  if (profile.existingLoans && profile.existingLoans !== 'none mentioned' && existing.length === 0 && !/\b(?:existing|already|running|outstanding)\b[^.]*\bloan/i.test(text)) {
    delete profile.existingLoans
  }
  if (profile.businessStage === 'existing_expansion' && !EXPANSION_EVIDENCE.test(text)) {
    delete profile.businessStage
    delete profile.businessStatus
  }

  if (!profile.education) {
    const education = findEducationSupplement(text)
    if (education) profile.education = education
  }

  const village = findCuratedVillage(text)
  const district = findDistrict(text)
  if (district) profile.district = district.district
  else if (village) profile.district = village.district
  if (village) details.curatedVillageId = village.id
  if (district?.state && !profile.state) details.stateInferredFromDistrict = district.state

  const applicantName = findApplicantName(text)
  if (applicantName) details.applicantName = applicantName
  const mobile = findMobile(text)
  if (mobile) details.mobile = mobile
  const experienceYears = findExperienceYears(text)
  if (experienceYears !== undefined) details.experienceYears = experienceYears
  const nhgMembership = findNhgMembership(text)
  if (nhgMembership) details.nhgMembership = nhgMembership

  return { profile, details, documents: extractDocumentStatement(text) }
}
