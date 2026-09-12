/**
 * Deterministic, template-based reply generation. No model, no network
 * call — always available, and used whenever no real AI provider is
 * reachable. The text still genuinely depends on the profile and the
 * ranked evidence (never a fixed canned string), but it is composed by
 * plain code, not a language model, and the UI must label it as such.
 */

import { normalizeSectorLabel } from '../lexicon'
import type { UserProfile } from '../types'
import type { AIProvider, AIRequestContext, ProviderReply } from './types'
import { ELIGIBILITY_STATUS_LABEL } from '../eligibility'

const FIELD_PHRASES: Partial<Record<keyof UserProfile, (p: UserProfile) => string>> = {
  state: (p) => `you're in ${p.state}`,
  district: (p) => `your district is ${p.district}`,
  areaType: (p) => `you're in a ${p.areaType} area`,
  age: (p) => `you're ${p.age} years old`,
  gender: (p) => `your gender is ${p.gender}`,
  socialCategory: (p) => `your social category is ${p.socialCategory?.toUpperCase()}`,
  annualIncome: (p) => `your annual income is about ₹${p.annualIncome?.toLocaleString('en-IN')}`,
  businessSector: (p) => `you're working with a ${normalizeSectorLabel(p.businessSector ?? '')} business`,
  businessStage: (p) =>
    p.businessStage === 'existing_expansion' ? "you're expanding an existing business" : "you're starting a new business",
  investmentRequired: (p) => `your investment need is about ₹${p.investmentRequired?.toLocaleString('en-IN')}`,
  financingRequired: (p) => `your financing need is about ₹${p.financingRequired?.toLocaleString('en-IN')}`,
  ownContribution: (p) => `your own contribution is about ₹${p.ownContribution?.toLocaleString('en-IN')}`,
}

function describeUpdatedFields(profile: UserProfile, fields: Array<keyof UserProfile>): string | undefined {
  const phrases = fields.map((f) => FIELD_PHRASES[f]?.(profile)).filter((s): s is string => Boolean(s))
  if (phrases.length === 0) return undefined
  return `Got it — noted that ${phrases.join(', ')}.`
}

export function composeOfflineReply(context: AIRequestContext): string {
  const paragraphs: string[] = []

  const ack = describeUpdatedFields(context.profile, context.newlyUpdatedFields)
  if (ack) paragraphs.push(ack)

  if (context.ranked.length === 0) {
    paragraphs.push(
      "I couldn't find anything in the scheme knowledge base relevant to what you've shared so far. Tell me more about the business you're running or planning — the sector, your state, and roughly how much financing you need — and I'll take another look.",
    )
  } else {
    const promising = context.ranked.filter(
      (r) => r.eligibility.status === 'likely_eligible' || r.eligibility.status === 'possibly_eligible',
    )
    if (promising.length > 0) {
      const lines = promising
        .slice(0, 3)
        .map((r, i) => {
          const reason = r.eligibility.reasons[0]
          return `${i + 1}. ${r.scheme.name} — ${ELIGIBILITY_STATUS_LABEL[r.eligibility.status]}${reason ? ` ${reason}` : ''}`
        })
      paragraphs.push(['Based on what you\'ve told me, these look worth exploring:', ...lines].join('\n'))
    } else {
      const top = context.ranked[0]
      const concern = top.eligibility.mismatchReasons[0]
      paragraphs.push(
        `Nothing in the knowledge base looks like a strong match yet.${concern ? ` For example, for ${top.scheme.name}: ${concern}` : ''} Sharing a bit more detail may surface a better fit.`,
      )
    }
  }

  if (context.missingFields.length > 0) {
    paragraphs.push(context.missingFields[0].question)
  }

  // Data-source freshness/verification status is now conveyed by a
  // dedicated UI indicator driven by AssistantTurnResult.sourceStatus (see
  // orchestrator.ts and SourceStatusBadge.tsx), not restated in the reply
  // text itself — this used to say "Generated locally without an AI
  // model..." here, which conflated "no AI model" with "static data" in one
  // confusing, alarmist line. Removed on purpose; do not re-add it.

  return paragraphs.join('\n\n')
}

export class OfflineTemplateProvider implements AIProvider {
  readonly id = 'offline' as const

  isAvailable(): Promise<boolean> {
    return Promise.resolve(true)
  }

  generateReply(context: AIRequestContext): Promise<ProviderReply> {
    return Promise.resolve({ text: composeOfflineReply(context), usedProvider: this.id })
  }
}

export const offlineProvider = new OfflineTemplateProvider()
