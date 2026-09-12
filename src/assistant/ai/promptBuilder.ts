/**
 * Shared prompt construction for every provider that is a real language
 * model (Ollama today, a hosted model later). The offline template provider
 * does not use this — it has no model to prompt.
 *
 * This is the single place the anti-hallucination contract is written down.
 * Both OllamaProvider and HostedProxyProvider send exactly this system
 * prompt plus the evidence block built here, so tightening the contract
 * only ever needs to happen in one place.
 */

import { ELIGIBILITY_STATUS_LABEL } from '../eligibility'
import { normalizeSectorLabel } from '../lexicon'
import type { AIRequestContext } from './types'

export const ASSISTANT_SYSTEM_PROMPT = `You are the LokPulse Government Scheme Assistant, helping an Indian citizen understand which government livelihood/business schemes might apply to them.

You will be given, in the user turn: the applicant's profile so far, their latest message, a list of conversation history, a RETRIEVED & SCORED SCHEMES section, and a list of SUGGESTED FOLLOW-UP QUESTIONS.

Hard rules — follow all of them exactly:
1. Only ever discuss schemes that appear in the RETRIEVED & SCORED SCHEMES section. Never name, describe, or imply the existence of any other scheme, program, or government body.
2. Never state or imply a loan amount, subsidy rate, interest rate, income ceiling, age limit, document, application step, or URL that is not explicitly written in that section. If the user asks for a detail that isn't there, say you don't have verified information on that specific point and point them to the scheme's official info URL instead of guessing.
3. The match score, eligibility status, reasons, and mismatch/concern notes for each scheme are already computed deterministically — treat them as ground truth. Do not recompute, second-guess, upgrade, or downgrade them. Explain them in plain language instead.
4. Never say a user is "approved", "guaranteed", "definitely eligible", or similar. Use hedged language consistent with the given status, e.g. "a potential match based on what you've shared" or "this would need official verification". Every likely_eligible or possibly_eligible scheme must be presented as needing official verification, not as a decision.
5. If nothing in RETRIEVED & SCORED SCHEMES is a decent match, say so plainly rather than forcing a recommendation.
6. If SUGGESTED FOLLOW-UP QUESTIONS is non-empty, weave in ONE of them naturally at the end of your reply so the conversation keeps moving — do not invent a different question.
7. Keep the reply concise (roughly 3-6 short sentences plus, if useful, a short numbered list of the top schemes), warm, and in plain language for a first-time applicant. No markdown headers.
8. Do not fabricate statistics, dates, office names, phone numbers, or procedures beyond what is given.
9. A scheme's evidence may include a "Live official data" line — a statistic fetched just now from an official government open-data source (e.g. how many units were sanctioned in the applicant's state). Treat it only as supplementary real-world context, never as an eligibility rule, loan amount, or document requirement — those always come from the scheme's main entry, not from live data.

Your only job is to explain the given evidence clearly and personally — not to invent new facts.`

function summarizeProfile(context: AIRequestContext): string {
  const p = context.profile
  const parts: string[] = []
  if (p.age !== undefined) parts.push(`age ${p.age}`)
  if (p.gender) parts.push(p.gender)
  if (p.socialCategory) parts.push(p.socialCategory.toUpperCase())
  if (p.state) parts.push(`in ${p.state}${p.district ? `, ${p.district}` : ''}`)
  if (p.areaType) parts.push(p.areaType)
  if (p.businessSector) parts.push(`${normalizeSectorLabel(p.businessSector)} business`)
  if (p.businessStage === 'new' || p.businessStage === 'idea') parts.push('starting a new business')
  if (p.businessStage === 'existing_expansion') parts.push('expanding an existing business')
  if (p.annualIncome !== undefined) parts.push(`annual income ~₹${p.annualIncome.toLocaleString('en-IN')}`)
  if (p.investmentRequired !== undefined) parts.push(`investment need ~₹${p.investmentRequired.toLocaleString('en-IN')}`)
  if (p.financingRequired !== undefined) parts.push(`financing need ~₹${p.financingRequired.toLocaleString('en-IN')}`)
  if (p.ownContribution !== undefined) parts.push(`own contribution ~₹${p.ownContribution.toLocaleString('en-IN')}`)
  if (p.education) parts.push(`education: ${p.education}`)
  if (p.existingLoans) parts.push(`existing loans: ${p.existingLoans}`)
  if (p.landOrAssets) parts.push(`assets: ${p.landOrAssets}`)
  return parts.length > 0 ? parts.join(', ') : '(no structured details captured yet)'
}

function describeSchemeEvidence(context: AIRequestContext): string {
  const top = context.ranked.slice(0, 5)
  if (top.length === 0) return 'No schemes in the knowledge base matched this profile.'

  return top
    .map((r, i) => {
      const s = r.scheme
      const lines = [
        `${i + 1}. ${s.name} [${s.scope === 'state' ? s.state : 'Central'} scheme]`,
        `   Eligibility status: ${r.eligibility.status} — ${ELIGIBILITY_STATUS_LABEL[r.eligibility.status]}`,
        `   Match score: ${r.eligibility.score}/100 (confidence in this score: ${r.eligibility.confidence})`,
      ]
      if (r.eligibility.reasons.length > 0) lines.push(`   Supporting reasons: ${r.eligibility.reasons.join(' | ')}`)
      if (r.eligibility.mismatchReasons.length > 0)
        lines.push(`   Concerns/mismatches: ${r.eligibility.mismatchReasons.join(' | ')}`)
      if (r.eligibility.missingInfo.length > 0)
        lines.push(`   Still unknown for this scheme: ${r.eligibility.missingInfo.join(', ')}`)
      if (s.loanAmount) {
        const range =
          s.loanAmount.minRupees !== undefined && s.loanAmount.maxRupees !== undefined
            ? `₹${s.loanAmount.minRupees.toLocaleString('en-IN')}–₹${s.loanAmount.maxRupees.toLocaleString('en-IN')}`
            : s.loanAmount.maxRupees !== undefined
              ? `up to ₹${s.loanAmount.maxRupees.toLocaleString('en-IN')}`
              : undefined
        lines.push(`   Loan: ${[range, s.loanAmount.notes].filter(Boolean).join(' — ')}`)
      }
      if (s.subsidy) lines.push(`   Subsidy: ${s.subsidy.description}`)
      if (s.interest?.ratePercent !== undefined) lines.push(`   Interest: ${s.interest.ratePercent}%${s.interest.notes ? ` — ${s.interest.notes}` : ''}`)
      lines.push(`   Official info: ${s.officialInfoUrl}`)
      lines.push(`   Source: ${s.source} (last verified ${s.lastVerifiedDate}) — a maintained reference entry, confirm before acting.`)
      if (r.liveEvidence && r.liveEvidence.length > 0) {
        for (const live of r.liveEvidence) {
          lines.push(
            `   Live official data (${live.sourceName}, retrieved ${live.retrievedAt}${live.publishedAt ? `, published ${live.publishedAt}` : ''}): ${live.summary} — ${live.sourceUrl}`,
          )
        }
      }
      return lines.join('\n')
    })
    .join('\n\n')
}

function describeMissingFields(context: AIRequestContext): string {
  if (context.missingFields.length === 0) return 'None — enough is known to evaluate the tracked fields.'
  return context.missingFields
    .slice(0, 3)
    .map((m) => `- ${m.question}`)
    .join('\n')
}

function describeHistory(context: AIRequestContext): string {
  if (context.history.length === 0) return '(no prior turns)'
  return context.history
    .slice(-6)
    .map((t) => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.text}`)
    .join('\n')
}

export function buildUserTurn(context: AIRequestContext): string {
  return [
    `USER PROFILE SO FAR:\n${summarizeProfile(context)}`,
    `RECENT CONVERSATION:\n${describeHistory(context)}`,
    `LATEST MESSAGE:\n"${context.message}"`,
    `RETRIEVED & SCORED SCHEMES (deterministic — explain, do not alter):\n${describeSchemeEvidence(context)}`,
    `SUGGESTED FOLLOW-UP QUESTIONS (weave in at most one, only if it fits):\n${describeMissingFields(context)}`,
  ].join('\n\n')
}
