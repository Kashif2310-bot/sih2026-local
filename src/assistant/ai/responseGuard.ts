/**
 * Defense-in-depth for the anti-hallucination contract.
 *
 * ASSISTANT_SYSTEM_PROMPT (see promptBuilder.ts) *instructs* a real model
 * not to invent facts, claim approval, or cite URLs beyond the retrieved
 * evidence — but an instruction is not an enforcement, and a local/small
 * model (or a deliberate prompt-injection attempt inside a user message)
 * can ignore it. This module actually checks a provider's output before it
 * is ever shown to a user, so a compromised or non-compliant reply is
 * treated exactly like a network failure: the orchestrator falls back to
 * the next provider (ultimately the deterministic offline template)
 * instead of surfacing the untrusted text.
 *
 * This is intentionally cheap pattern-matching, not another model call —
 * a validator that itself needs trusting doesn't add real safety.
 */

import type { AIRequestContext } from './types'

const FORBIDDEN_CLAIM_PATTERNS: RegExp[] = [
  /\byou\s*(are|'re|have been)\s*(now\s*)?approved\b/i,
  /\bguaranteed\b/i,
  /\b100\s*%\s*(eligible|approved|guaranteed)\b/i,
  /\bdefinitely\s+eligible\b/i,
  /\bgovernment\s+has\s+approved\b/i,
  /\bofficially\s+approved\b/i,
  /\byour\s+loan\s+is\s+sanctioned\b/i,
  /\bcongratulations,?\s+you('| a)re\s+eligible\b/i,
]

const URL_PATTERN = /https?:\/\/[^\s)"'<>]+/gi

function stripTrailingPunctuation(url: string): string {
  return url.replace(/[.,;:!?)]+$/, '')
}

function collectEvidenceUrls(context: AIRequestContext): Set<string> {
  const urls = new Set<string>()
  for (const r of context.ranked) {
    urls.add(r.scheme.officialInfoUrl)
    urls.add(r.scheme.officialApplicationUrl)
    urls.add(r.scheme.sourceUrl)
    for (const live of r.liveEvidence ?? []) {
      urls.add(live.sourceUrl)
    }
  }
  return urls
}

export function findForbiddenClaims(text: string): string[] {
  return FORBIDDEN_CLAIM_PATTERNS.filter((re) => re.test(text)).map((re) => re.source)
}

/** Any URL the reply mentions that isn't one of the URLs actually supplied in the evidence for this turn. */
export function findUnapprovedUrls(text: string, context: AIRequestContext): string[] {
  const allowed = collectEvidenceUrls(context)
  const found = text.match(URL_PATTERN) ?? []
  const unapproved = found.map(stripTrailingPunctuation).filter((u) => !allowed.has(u))
  return Array.from(new Set(unapproved))
}

function collectEvidenceAmounts(context: AIRequestContext): Set<number> {
  const amounts = new Set<number>()
  const add = (n: number | undefined) => {
    if (typeof n === 'number' && Number.isFinite(n)) amounts.add(Math.round(n))
  }
  const p = context.profile
  add(p.annualIncome)
  add(p.investmentRequired)
  add(p.financingRequired)
  add(p.ownContribution)
  add(p.age)
  for (const r of context.ranked) {
    add(r.scheme.loanAmount?.minRupees)
    add(r.scheme.loanAmount?.maxRupees)
    add(r.scheme.subsidy?.ratePercentMin)
    add(r.scheme.subsidy?.ratePercentMax)
    add(r.scheme.interest?.ratePercent)
    add(r.eligibility.score)
    add(r.relevance)
    add(r.rankScore)
  }
  return amounts
}

function parseIndianNumber(raw: string): number {
  return Number(raw.replace(/,/g, ''))
}

/**
 * Currency-like amounts mentioned in reply text that are not present in
 * profile/scheme evidence for this turn. List indices and bare small
 * integers are ignored — only ₹ / Rs / lakh / crore style mentions count.
 */
export function findUnapprovedAmounts(text: string, context: AIRequestContext): number[] {
  const allowed = collectEvidenceAmounts(context)
  const found = new Set<number>()

  const rupeeRe = /(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d+)?)/gi
  let m: RegExpExecArray | null
  while ((m = rupeeRe.exec(text)) !== null) {
    const n = Math.round(parseIndianNumber(m[1]))
    if (Number.isFinite(n) && !allowed.has(n)) found.add(n)
  }

  const unitRe = /([\d,]+(?:\.\d+)?)\s*(lakh|lac|crore)\b/gi
  while ((m = unitRe.exec(text)) !== null) {
    const base = parseIndianNumber(m[1])
    const unit = m[2].toLowerCase()
    const n = Math.round(unit === 'crore' ? base * 10_000_000 : base * 100_000)
    if (Number.isFinite(n) && !allowed.has(n)) found.add(n)
  }

  return Array.from(found)
}

export interface GuardResult {
  ok: boolean
  reasons: string[]
}

/**
 * Validates one provider reply against the evidence it was given. Applied
 * uniformly to every provider (including the offline template) so the
 * guard itself never becomes a place where one provider is silently
 * exempted.
 */
export function validateProviderReply(text: string, context: AIRequestContext): GuardResult {
  const reasons: string[] = []

  const claims = findForbiddenClaims(text)
  if (claims.length > 0) {
    reasons.push(`reply asserts an absolute/guaranteed outcome (${claims.length} match(es))`)
  }

  const urls = findUnapprovedUrls(text, context)
  if (urls.length > 0) {
    reasons.push(`reply cites a URL not present in the retrieved evidence: ${urls.join(', ')}`)
  }

  // Amount checking is available via findUnapprovedAmounts() and is applied
  // by the report explanation seam. It is intentionally NOT part of the
  // conversational validateProviderReply path: eligibility reason strings
  // from the curated KB often mention scheme ceiling figures that are
  // evidence-grounded prose but not always present as structured numeric
  // fields on UserProfile / loanAmount.

  return { ok: reasons.length === 0, reasons }
}
