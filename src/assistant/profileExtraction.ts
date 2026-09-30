/**
 * Deterministic, rule-based natural-language profile extraction.
 *
 * This is NOT an LLM call — it is regex/keyword based so that profile
 * extraction works reliably and testably even with no AI provider
 * available (offline/local-only demo). An AIProvider MAY additionally
 * refine extraction (see ai/provider.ts), but the assistant must never
 * depend on a network/model call just to read a user's message.
 */

import { INDIAN_STATES, SECTOR_KEYWORDS } from './lexicon'
import type { UserProfile } from './types'

export interface ExtractionResult {
  profile: UserProfile
  updatedFields: Array<keyof UserProfile>
}

// ---------------------------------------------------------------------------
// Spelled-out number normalization — feeds ONLY findAge/findMoneyMentions.
//
// Speech-to-text output routinely spells numbers as words ("twenty four",
// "one lakh") that the digit-only findAge/findMoneyMentions patterns below
// never matched. This section converts recognized number words to digits in
// a WORKING COPY of the text, used only as the input to those two
// functions — never returned, never stored, and never passed to
// findGender/findState/findSocialCategory/findBusinessSector/etc., which
// all still see the citizen's original words untouched. This is why an
// ordinary word like "one" elsewhere in a sentence can't create a spurious
// match: findAge still requires "<number> years old" / "age <number>", and
// findMoneyMentions still requires a currency symbol or a lakh/crore/
// thousand unit — a bare converted digit with neither is still discarded by
// those functions exactly as a bare digit always was.
// ---------------------------------------------------------------------------

const ONES_AND_TEENS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
}

const TENS: Record<string, number> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
}

const NUMBER_WORD_ALTERNATION = Object.keys({ ...ONES_AND_TEENS, ...TENS }).join('|')

function numberWordValue(word: string): number | undefined {
  const key = word.toLowerCase()
  return ONES_AND_TEENS[key] ?? TENS[key]
}

/**
 * Converts recognized spelled-out numbers to digits, in this order:
 *   1. "<number> and a half <unit>" -> "<number+0.5> <unit>" — a single,
 *      explicit idiom (never general fraction math), and only recognized
 *      immediately before a currency unit word so it can't fire elsewhere
 *      (e.g. "an hour and a half" is untouched — no lakh/crore/thousand
 *      follows it).
 *   2. Compound "twenty four" / "twenty-four" -> "24".
 *   3. Any remaining bare number word ("forty", "seven") -> its digit.
 * Each pass only matches whole words (`\b...\b`), so it can never alter part
 * of an unrelated word, and digits produced by an earlier pass are immune to
 * later passes (they no longer look like the word alternation).
 */
function normalizeNumberWordsForMatching(text: string): string {
  let out = text

  out = out.replace(
    new RegExp(`\\b(${NUMBER_WORD_ALTERNATION}|\\d+(?:\\.\\d+)?)\\s+and\\s+a\\s+half\\s+(?=(?:lakh|lac|crore|thousand)\\b)`, 'gi'),
    (whole, numberPart: string) => {
      const base = /^\d/.test(numberPart) ? Number(numberPart) : numberWordValue(numberPart)
      return base === undefined ? whole : `${base + 0.5} `
    },
  )

  out = out.replace(
    /\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[\s-]+(one|two|three|four|five|six|seven|eight|nine)\b/gi,
    (whole, tensWord: string, onesWord: string) => {
      const tens = numberWordValue(tensWord)
      const ones = numberWordValue(onesWord)
      return tens === undefined || ones === undefined ? whole : String(tens + ones)
    },
  )

  out = out.replace(new RegExp(`\\b(${NUMBER_WORD_ALTERNATION})\\b`, 'gi'), (whole) => {
    const value = numberWordValue(whole)
    return value === undefined ? whole : String(value)
  })

  return out
}

/**
 * When a message names more than one state — most commonly a correction
 * like "Actually I'm in Kerala, not Karnataka" — picking by longest name
 * (the old rule) silently keeps whichever name has more letters, which is
 * wrong whenever the correction happens to use a shorter state name than
 * the one being corrected. Instead: drop any mention immediately preceded
 * by a negation ("not X"), then prefer whichever remaining mention is
 * stated last, matching mergeProfile's existing "later statements win"
 * rule for every other field.
 */
function findState(text: string): string | undefined {
  const lower = text.toLowerCase()
  const candidates: Array<{ name: string; index: number }> = []
  for (const state of INDIAN_STATES) {
    const idx = lower.indexOf(state.toLowerCase())
    if (idx === -1) continue
    const preceding = lower.slice(Math.max(0, idx - 12), idx)
    if (/\bnot\s+(in\s+)?$/.test(preceding)) continue
    candidates.push({ name: state, index: idx })
  }
  if (candidates.length === 0) return undefined
  candidates.sort((a, b) => b.index - a.index || b.name.length - a.name.length)
  return candidates[0].name
}

/**
 * Disqualifies a bare "I'm/I am <number>" match (see findAge's third
 * pattern) when the next couple of words explain that the number is
 * something other than an age — a distance, a duration, a headcount, or an
 * amount of money. Checked in a short window right after the number, not
 * the rest of the message, so a genuine age statement earlier in a longer
 * sentence about other numbers is unaffected. "years old" itself is not
 * listed here: pattern 1 above already matches and returns before pattern 3
 * is ever reached, so pattern 3 only runs when "years old" is absent.
 */
const AGE_FALSE_POSITIVE_FOLLOWUP =
  /^[\s,-]{0,3}(?:lakh|lac|crore|thousand|rupees?|rs\.?|km|kilomet(?:re|er)s?|months?|days?|hours?|cows?|buffalo(?:e)?s?|acres?|members?|employees?|percent|years?\s+(?:of\s+experience\b|into\b|in\b))/i

function findAge(text: string): number | undefined {
  const m = text.match(/(\d{1,3})\s*-?\s*years?\s*-?\s*old/i)
  if (m) {
    const n = Number(m[1])
    if (n > 0 && n < 120) return n
  }
  const m2 = text.match(/\bage(?:\s*(?:is|:))?\s*(\d{1,3})\b/i)
  if (m2) {
    const n = Number(m2[1])
    if (n > 0 && n < 120) return n
  }
  // Bare self-identification — "I'm 24, a woman, ..." / "I am 24" — with
  // neither "years old" nor "age" as an anchor. Found while testing "I'm
  // twenty four, a woman, from the SC community": normalizing the spelled
  // number alone isn't enough, since the sentence never says "years old" at
  // all. Deliberately narrow (only "I'm"/"I am" directly before the number),
  // a tighter 18-100 plausibility range than patterns 1/2 above (which keep
  // their existing 0-120 range unchanged), and rejected outright if what
  // follows explains the number away as something other than an age.
  const m3 = text.match(/\bi\s*(?:'m|am)\s+(\d{1,3})\b/i)
  if (m3 && m3.index !== undefined) {
    const n = Number(m3[1])
    const following = text.slice(m3.index + m3[0].length, m3.index + m3[0].length + 30)
    if (n >= 18 && n <= 100 && !AGE_FALSE_POSITIVE_FOLLOWUP.test(following)) return n
  }
  return undefined
}

function findGender(text: string): UserProfile['gender'] | undefined {
  if (/\bwoman\b|\bwomen\b|\bfemale\b/i.test(text)) return 'female'
  if (/\bman\b|\bmen\b|\bmale\b/i.test(text)) return 'male'
  return undefined
}

function findAreaType(text: string): UserProfile['areaType'] | undefined {
  if (/\brural\b|\bvillage\b/i.test(text)) return 'rural'
  if (/\burban\b|\bcity\b|\btown\b/i.test(text)) return 'urban'
  return undefined
}

function findSocialCategory(text: string): UserProfile['socialCategory'] | undefined {
  // The bare abbreviations are matched case-SENSITIVELY (exact "SC"/"ST"/"OBC") on
  // purpose: a case-insensitive match would also catch "St." (street) or "1st",
  // which are common in addresses and dates but never mean Scheduled Tribe.
  if (/scheduled\s+caste/i.test(text) || /(^|[\s,.;()])SC([\s,.;()]|$)/.test(text)) return 'sc'
  if (/scheduled\s+tribe/i.test(text) || /(^|[\s,.;()])ST([\s,.;()]|$)/.test(text)) return 'st'
  if (/other\s+backward\s+class/i.test(text) || /(^|[\s,.;()])OBC([\s,.;()]|$)/.test(text)) return 'obc'
  // Either word order — "general category" and "category general" are both
  // natural phrasings.
  if (/general\s+categor(y|ies)/i.test(text) || /categor(y|ies)\s+(?:is\s+)?general\b/i.test(text)) return 'general'

  // Speech-to-text rarely preserves acronym casing, and sometimes spells a
  // short acronym out letter-by-letter ("s c", "S C"). Collapsing a run of
  // single letters into one token, and then accepting lowercase sc/st/obc,
  // is done ONLY when immediately paired with a disambiguating word
  // (category/caste/community/class) — exactly the context "1st"/"St."
  // never appear in, so those guards stay intact. Without a neighboring
  // disambiguator the phrasing is genuinely ambiguous and is left
  // undefined, same as today.
  const collapsed = text.replace(
    /\b((?:[a-zA-Z]\s+){1,2}[a-zA-Z])\b(?=\s+(?:categor|caste|communit|class))/g,
    (run) => run.replace(/\s+/g, ''),
  )
  if (/\bsc\b\s+(?:categor|caste|communit|class)/i.test(collapsed)) return 'sc'
  if (/\bst\b\s+(?:categor|caste|communit|class)/i.test(collapsed)) return 'st'
  if (/\bobc\b\s+(?:categor|caste|communit|class)/i.test(collapsed)) return 'obc'

  return undefined
}

function findBusinessSector(text: string): string | undefined {
  const lower = text.toLowerCase()
  for (const [tag, keywords] of Object.entries(SECTOR_KEYWORDS)) {
    if (keywords.some((kw) => lower.includes(kw))) return tag
  }
  return undefined
}

function findProposedBusiness(text: string): string | undefined {
  const m = text.match(/\b(?:an?)\s+([a-z][a-z\s-]{2,40}?)\s+business\b/i)
  if (m) return `${m[1].trim()} business`
  return undefined
}

function findBusinessStageAndStatus(
  text: string,
): { businessStage?: UserProfile['businessStage']; businessStatus?: UserProfile['businessStatus'] } {
  if (/\bexpand(ing)?\b|\bscale up\b|\bgrow(ing)? (my|the|our)\s+business\b/i.test(text)) {
    return { businessStage: 'existing_expansion', businessStatus: 'existing' }
  }
  if (/\bexisting\b.*\bbusiness\b/i.test(text) || /already\s+(have|run|running|operating)/i.test(text)) {
    return { businessStage: 'existing_expansion', businessStatus: 'existing' }
  }
  if (/\bwant to start\b|\bplan(ning)? to start\b|\bstart(ing)? a\b|\bwish to start\b/i.test(text)) {
    return { businessStage: 'new', businessStatus: 'idea' }
  }
  return {}
}

function findEducation(text: string): string | undefined {
  const m = text.match(
    /\b(8th|10th|12th|ssc|graduate|post[- ]graduate|diploma|illiterate|no formal education|degree)\b/i,
  )
  return m ? m[1].toLowerCase() : undefined
}

function findLandOrAssets(text: string): string | undefined {
  const m = text.match(/\b(\d+(?:\.\d+)?)\s*(acre|acres|guntha|cents)\b/i)
  if (m) return `${m[1]} ${m[2]}`
  const m2 = text.match(/\bown(?:s)?\s+(?:a|an|some)?\s*(house|land|shop|property)\b/i)
  return m2 ? `owns ${m2[1]}` : undefined
}

function findExistingLoans(text: string): string | undefined {
  if (/\bno\s+(existing\s+)?loan/i.test(text)) return 'none mentioned'
  const m = text.match(/\b(existing loan[^.,;]*|already\s+have\s+a\s+loan[^.,;]*|loan\s+of\s+₹?[\d,]+[^.,;]*)/i)
  return m ? m[0].trim() : undefined
}

interface MoneyMention {
  value: number
  index: number
  endIndex: number
}

function findMoneyMentions(text: string): MoneyMention[] {
  const results: MoneyMention[] = []
  const re = /(₹|rs\.?|inr)?\s*([\d][\d,]*(?:\.\d+)?)\s*(lakh|lac|crore|thousand|k)?/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(text))) {
    const [whole, currencySymbol, numRaw, unit] = match
    if (!currencySymbol && !unit) continue // bare number with no currency/unit — too ambiguous (could be age, count, etc.)
    const num = Number(numRaw.replace(/,/g, ''))
    if (!Number.isFinite(num) || num <= 0) continue
    let value = num
    const u = unit?.toLowerCase()
    if (u === 'lakh' || u === 'lac') value = num * 100_000
    else if (u === 'crore') value = num * 10_000_000
    else if (u === 'thousand' || u === 'k') value = num * 1_000
    results.push({ value, index: match.index, endIndex: match.index + whole.length })
  }
  return results
}

// 'margin' alone (not just the fuller "margin money") is included because
// that is how citizens actually say it — "one lakh rupees margin" — and in
// this app's domain (government scheme financing) it unambiguously means
// the borrower's own contribution, not any other sense of the word.
const OWN_CONTRIBUTION_KEYWORDS = ['own contribution', 'own savings', 'margin money', 'margin', 'self contribution']
const INCOME_KEYWORDS = ['income', 'earn', 'earning', 'salary']
const FINANCING_KEYWORDS = ['need', 'loan of', 'financing', 'expand', 'want a loan', 'require a loan']
const INVESTMENT_KEYWORDS = ['requiring', 'investment', 'invest', 'project cost', 'setup cost', 'set up', 'cost of', 'capital of']

type MoneyCategory = 'ownContribution' | 'annualIncome' | 'financingRequired' | 'investmentRequired'

const MONEY_CATEGORY_KEYWORDS: Array<[MoneyCategory, string[]]> = [
  ['ownContribution', OWN_CONTRIBUTION_KEYWORDS],
  ['annualIncome', INCOME_KEYWORDS],
  ['financingRequired', FINANCING_KEYWORDS],
  ['investmentRequired', INVESTMENT_KEYWORDS],
]

function contextBefore(text: string, index: number, window = 55): string {
  return text.slice(Math.max(0, index - window), index).toLowerCase()
}

function contextAfter(text: string, endIndex: number, window = 30): string {
  return text.slice(endIndex, endIndex + window).toLowerCase()
}

/**
 * A category keyword can sit on either side of the amount — "margin money
 * of ₹1 lakh" (before) or "₹1 lakh margin" (after), both natural phrasings
 * — so both directions are searched and the keyword actually CLOSEST to the
 * amount wins, regardless of which side it's on. This still reproduces the
 * original backward-only behavior exactly when nothing appears after the
 * amount (e.g. "I earn ₹6 lakh annually and need ₹8 lakh" keeps preferring
 * the closer backward keyword for each amount, unchanged), since `after`
 * simply contributes no candidates in that case.
 */
function nearestMoneyCategory(before: string, after: string): MoneyCategory | undefined {
  let best: { category: MoneyCategory; distance: number } | undefined
  for (const [category, keywords] of MONEY_CATEGORY_KEYWORDS) {
    for (const kw of keywords) {
      const beforeIdx = before.lastIndexOf(kw)
      if (beforeIdx !== -1) {
        const distance = before.length - (beforeIdx + kw.length)
        if (!best || distance < best.distance) best = { category, distance }
      }
      const afterIdx = after.indexOf(kw)
      if (afterIdx !== -1) {
        if (!best || afterIdx < best.distance) best = { category, distance: afterIdx }
      }
    }
  }
  return best?.category
}

// "capital" is the citizen's OWN money only in a possessive phrasing that
// touches the amount: "I have a capital of ₹4 lakh", "my own capital is 2
// lakh", "4 lakhs capital". It is deliberately not a plain keyword: that
// would also fire on "working capital" (a separate, computed operating-cash
// figure — see lib/workingCapital.ts), "capital city" or "capital of
// Karnataka", and a non-possessive "capital of ₹X" already means what a
// business needs (INVESTMENT_KEYWORDS). Both patterns are anchored to the
// amount, so a match is always the keyword nearest to it — consistent with
// nearestMoneyCategory's closest-keyword-wins rule.
const OWN_CAPITAL_BEFORE =
  /\b(?:(?:i|we)\s+(?:have|had|got)\s+(?:got\s+)?(?:a\s+|some\s+)?(?:my\s+|our\s+)?(?:own\s+)?|(?:my|our)\s+(?:own\s+)?|own\s+)capital(?:\s+(?:is|of))?(?:\s+(?:about|around|nearly))?\s*$/
const OWN_CAPITAL_AFTER =
  /^s?\s+(?:rupees\s+)?(?:of\s+|as\s+)?(?:my\s+|our\s+)?(?:own\s+)?capital\b(?!\s+(?:city|needed|required|is\s+(?:needed|required)))/

function isOwnCapital(before: string, after: string): boolean {
  if (OWN_CAPITAL_BEFORE.test(before)) return true
  if (!OWN_CAPITAL_AFTER.test(after)) return false
  // "I need 4 lakh capital" is money the citizen needs, not money they have.
  const clause = before.split(/[.,;!?]/).pop() ?? ''
  return ![...FINANCING_KEYWORDS, ...INVESTMENT_KEYWORDS].some((kw) => clause.includes(kw))
}

function classifyMoney(
  text: string,
  mentions: MoneyMention[],
): Pick<UserProfile, 'annualIncome' | 'investmentRequired' | 'financingRequired' | 'ownContribution'> {
  const out: Pick<UserProfile, 'annualIncome' | 'investmentRequired' | 'financingRequired' | 'ownContribution'> = {}
  for (const mention of mentions) {
    const before = contextBefore(text, mention.index)
    const after = contextAfter(text, mention.endIndex)
    const category = isOwnCapital(before, after) ? 'ownContribution' : nearestMoneyCategory(before, after)
    if (category) out[category] = mention.value
  }
  return out
}

/**
 * Extract structured profile fields from one free-text user message.
 * Returns only the fields this message actually gave evidence for — the
 * caller merges this into the running profile (see orchestrator.ts).
 */
export function extractProfileFromMessage(text: string): Partial<UserProfile> {
  const extracted: Partial<UserProfile> = {}
  // Working copy only — never returned, never stored. See this function's
  // doc comment above normalizeNumberWordsForMatching for why only age/money
  // matching uses it, and every other field below still matches on `text`.
  const forNumberMatching = normalizeNumberWordsForMatching(text)

  const age = findAge(forNumberMatching)
  if (age !== undefined) extracted.age = age

  const gender = findGender(text)
  if (gender) extracted.gender = gender

  const areaType = findAreaType(text)
  if (areaType) extracted.areaType = areaType

  const state = findState(text)
  if (state) extracted.state = state

  const socialCategory = findSocialCategory(text)
  if (socialCategory) extracted.socialCategory = socialCategory

  const sector = findBusinessSector(text)
  if (sector) extracted.businessSector = sector

  const proposedBusiness = findProposedBusiness(text)
  if (proposedBusiness) extracted.proposedBusiness = proposedBusiness

  const { businessStage, businessStatus } = findBusinessStageAndStatus(text)
  if (businessStage) extracted.businessStage = businessStage
  if (businessStatus) extracted.businessStatus = businessStatus

  const education = findEducation(text)
  if (education) extracted.education = education

  const landOrAssets = findLandOrAssets(text)
  if (landOrAssets) extracted.landOrAssets = landOrAssets

  const existingLoans = findExistingLoans(text)
  if (existingLoans) extracted.existingLoans = existingLoans

  const money = classifyMoney(forNumberMatching, findMoneyMentions(forNumberMatching))
  Object.assign(extracted, money)

  return extracted
}

// Words that end a spoken name — "my name is Jordan and I want…" must yield
// "Jordan", not "Jordan And I Want".
const NAME_STOP_WORDS = new Set([
  'a', 'aged', 'also', 'am', 'an', 'and', 'at', 'but', 'currently', 'from', 'here', 'i', "i'm", 'im', 'in',
  'is', 'living', 'my', 'of', 'so', 'speaking', 'the', 'to', 'want', 'who', 'with',
])

/**
 * The applicant's name, from an explicit "my name is …" only — never
 * guessed from "I am …", which is far more often an age, a status or an
 * occupation ("I am 28", "I am a farmer"). Latin script only; speech-to-text
 * usually lowercases names, so each word's first letter is capitalized.
 * Kept separate from extractProfileFromMessage because UserProfile (the
 * /assistant profile) has no name field.
 */
export function extractApplicantName(text: string): string | undefined {
  const m = text.match(/\bmy\s+name(?:\s+is|'s)\s+([^,.;!?\n]+)/i)
  if (!m) return undefined
  const words: string[] = []
  for (const word of m[1].trim().split(/\s+/)) {
    if (NAME_STOP_WORDS.has(word.toLowerCase()) || !/^[a-z][a-z.'-]*$/i.test(word)) break
    words.push(word.charAt(0).toUpperCase() + word.slice(1))
    if (words.length === 4) break
  }
  return words.length > 0 ? words.join(' ') : undefined
}

/** Merge a new extraction into the running profile. Later statements overwrite earlier ones. */
export function mergeProfile(existing: UserProfile, extracted: Partial<UserProfile>): ExtractionResult {
  const updatedFields: Array<keyof UserProfile> = []
  const merged: UserProfile = { ...existing }
  for (const [key, value] of Object.entries(extracted)) {
    if (value === undefined) continue
    const field = key as keyof UserProfile
    if (merged[field] !== value) updatedFields.push(field)
    Object.assign(merged, { [field]: value })
  }
  return { profile: merged, updatedFields }
}

export function extractAndMerge(text: string, existing: UserProfile): ExtractionResult {
  return mergeProfile(existing, extractProfileFromMessage(text))
}
