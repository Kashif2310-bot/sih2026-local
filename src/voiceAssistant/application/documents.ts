import type { DocumentDeclaration } from '../../apply/types'
import type { UserProfile } from '../../assistant/types'

/**
 * Every document label in the curated scheme data falls into one of these
 * kinds, so one spoken statement ("I have my Aadhaar and bank passbook")
 * declares the matching document on whichever scheme's form is active.
 */
export type DocumentKind =
  | 'aadhaar'
  | 'bank'
  | 'caste'
  | 'income'
  | 'project_report'
  | 'photo'
  | 'education'
  | 'identity_address'
  | 'residence'
  | 'nhg'
  | 'business_proof'
  | 'trade_proof'
  | 'collateral'
  | 'mobile'

export const DOCUMENT_KIND_LABEL: Record<DocumentKind, string> = {
  aadhaar: 'Aadhaar card',
  bank: 'Bank account details',
  caste: 'Caste certificate',
  income: 'Income certificate',
  project_report: 'Project report / business plan',
  photo: 'Photographs',
  education: 'Education proof',
  identity_address: 'Identity and address proof',
  residence: 'Ration card / resident proof',
  nhg: 'NHG membership details',
  business_proof: 'Proof of business',
  trade_proof: 'Proof of trade',
  collateral: 'Collateral / guarantor details',
  mobile: 'Mobile number',
}

/** Ordered: the first pattern that matches a curated label decides its kind. */
const LABEL_KIND: Array<[DocumentKind, RegExp]> = [
  ['aadhaar', /aadhaar/i],
  ['bank', /bank account/i],
  ['caste', /caste|category certificate/i],
  ['income', /income certificate/i],
  ['project_report', /project report|business plan|project proposal|cost estimate|\bdpr\b/i],
  ['photo', /photograph/i],
  ['education', /education/i],
  ['identity_address', /identity and address/i],
  ['residence', /ration card|resident proof/i],
  ['nhg', /\bnhg\b|neighbourhood group/i],
  ['business_proof', /business existence/i],
  ['trade_proof', /proof of trade|traditional occupation/i],
  ['collateral', /collateral|guarantor/i],
  ['mobile', /mobile number/i],
]

export function documentKind(label: string): DocumentKind | null {
  return LABEL_KIND.find(([, pattern]) => pattern.test(label))?.[0] ?? null
}

/**
 * Some curated labels carry their own condition ("…, if applying under SC/ST
 * category", "…, if already operating"). When the applicant's known facts
 * show the condition does not hold, the document does not apply to them.
 * Unknown facts keep the document required.
 */
export function documentApplies(label: string, profile: UserProfile): boolean {
  const lower = label.toLowerCase()
  if (lower.includes('if applying under sc/st')) {
    return profile.socialCategory === undefined || profile.socialCategory === 'sc' || profile.socialCategory === 'st'
  }
  if (/caste|category/.test(lower) && lower.includes('if applicable')) {
    return profile.socialCategory !== 'general'
  }
  if (lower.includes('if already operating')) {
    return profile.businessStage === undefined || profile.businessStage === 'existing_expansion'
  }
  return true
}

/** How citizens name each kind of document when they talk. */
const SPOKEN_KIND: Array<[DocumentKind, RegExp]> = [
  ['aadhaar', /\b(?:aadhaar|aadhar|adhaar|adhar)\b/i],
  ['bank', /\bbank\s+(?:account|passbook|details|book)\b|\bpass\s?book\b/i],
  ['caste', /\bcaste\b|\bcategory\s+certificate\b|\bcommunity\s+certificate\b/i],
  ['income', /\bincome\s+(?:certificate|proof)\b/i],
  ['project_report', /\bproject\s+(?:report|proposal)\b|\bbusiness\s+plan\b|\bdpr\b|\bcost\s+estimate\b/i],
  ['photo', /\bphoto(?:graph)?s?\b/i],
  ['education', /\b(?:education|school|study)\s+(?:certificate|proof)\b|\bmarks?\s*(?:card|sheet)\b|\bsslc\s+(?:certificate|card)\b|\bdegree\s+certificate\b/i],
  ['identity_address', /\b(?:identity|id|address)\s+proof\b|\bvoter\s+id\b|\bpan\s+card\b|\bdriving\s+licen[cs]e\b/i],
  ['residence', /\bration\s+card\b|\bresiden(?:t|ce)\s+(?:proof|certificate)\b/i],
  ['nhg', /\b(?:nhg|kudumbashree)\s+(?:membership|card|details|passbook|book)\b/i],
  ['business_proof', /\b(?:business|shop|trade)\s+(?:licen[cs]e|registration)\b|\budyam\b|\bgst\s+(?:registration|certificate)\b|\bproof\s+of\s+business\b/i],
  ['trade_proof', /\bproof\s+of\s+(?:trade|occupation)\b|\btrade\s+proof\b|\bartisan\s+(?:card|id)\b/i],
  ['collateral', /\bcollateral\b|\bguarantor\b/i],
  ['mobile', /\b(?:mobile|phone)\s+(?:number|no\.?)\b/i],
]

const ALL_DOCUMENTS = /\ball\s+(?:the\s+|my\s+|these\s+|of\s+the\s+|required\s+)*(?:documents|papers|certificates)\b/i
const NEGATIVE = /\b(?:don'?t|do\s+not|doesn'?t|no|not|haven'?t|have\s+not|hasn'?t|without|missing|lost|yet\s+to|need\s+to\s+get|still\s+need)\b/i
const PORTAL = /\b(?:upload|attach|submit)\b[^.]*\b(?:portal|online|later)\b|\bon\s+the\s+portal\b/i
const POSITIVE = /\b(?:have|has|got|ready|available|with\s+me|possess|holding|can\s+(?:bring|provide|give|submit|show|upload|get)|will\s+(?:bring|provide|give|submit|upload))\b/i

export type DocumentDeclarations = Partial<Record<DocumentKind, DocumentDeclaration>>
export type DocumentStatement = DocumentDeclarations & { all?: DocumentDeclaration }

function clauses(text: string): string[] {
  return text
    .split(/[.;!?]+|\bbut\b|\bexcept(?:\s+for)?\b|\bhowever\b|,\s*(?=not\b|no\b|i\b)|\band\s+(?=i\b|i'm\b)/i)
    .map((part) => part.trim())
    .filter(Boolean)
}

/**
 * Document possession stated in one utterance. "except" starts a new clause
 * that inherits the opposite of the "all documents" claim before it, so
 * "I have all documents except the income certificate" marks everything
 * available and the income certificate missing.
 */
export function extractDocumentStatement(text: string): DocumentStatement {
  const statement: DocumentStatement = {}
  const parts = clauses(text)
  let previous: DocumentDeclaration | null = null
  const exceptRuns = text.split(/\bexcept(?:\s+for)?\b/i).length > 1

  parts.forEach((clause, index) => {
    const kinds = SPOKEN_KIND.filter(([, pattern]) => pattern.test(clause)).map(([kind]) => kind)
    const coversAll = ALL_DOCUMENTS.test(clause)
    if (kinds.length === 0 && !coversAll) return

    let declaration: DocumentDeclaration | null = null
    if (NEGATIVE.test(clause)) declaration = 'missing'
    else if (PORTAL.test(clause)) declaration = 'will_submit_on_portal'
    else if (POSITIVE.test(clause)) declaration = 'declared_available'
    else if (exceptRuns && index > 0 && previous === 'declared_available') declaration = 'missing'
    if (!declaration) return

    if (coversAll) statement.all = declaration
    for (const kind of kinds) statement[kind] = declaration
    previous = declaration
  })
  return statement
}

/** Later statements win, as for every other fact; "all documents" applies to every kind not named separately. */
export function mergeDocumentStatement(current: DocumentDeclarations, statement: DocumentStatement): DocumentDeclarations {
  const { all, ...named } = statement
  const next: DocumentDeclarations = { ...current }
  if (all) {
    for (const kind of Object.keys(DOCUMENT_KIND_LABEL) as DocumentKind[]) next[kind] = all
  }
  return { ...next, ...named }
}
