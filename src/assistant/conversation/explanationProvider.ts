/**
 * Provider-independent explanation seam for PersonalizedReport narratives.
 *
 * LLM (or offline template) receives structured DeterministicAnalysis /
 * PersonalizedReport evidence and produces prose. It MUST NOT calculate
 * eligibility, ranking, finance, documents, or verification state.
 *
 * Every narrative is validated with the EXISTING responseGuard
 * (validateProviderReply + amount checks) before attachment.
 */

import { validateProviderReply, findUnapprovedAmounts } from '../ai/responseGuard'
import type { AIRequestContext } from '../ai/types'
import type { RankedScheme, UserProfile } from '../types'
import type { DeterministicAnalysis } from './deterministicAnalysis'
import type { ExplanationLanguage, GuardedExplanation, PersonalizedReport } from './reportModel'

export interface ReportExplanationRequest {
  analysis: DeterministicAnalysis | PersonalizedReport
  language: ExplanationLanguage
  userProfile: UserProfile
  ranked: RankedScheme[]
  message?: string
}

export interface ReportExplanationProvider {
  readonly id: string
  explain(request: ReportExplanationRequest): Promise<string>
}

/**
 * Deterministic offline explanation — personalized by applicant context,
 * grounded only in structured analysis fields.
 */
export function composeOfflineReportExplanation(request: ReportExplanationRequest): string {
  const { analysis, language, userProfile } = request
  const summary = 'executiveSummary' in analysis ? analysis.executiveSummary : undefined
  const schemes = 'relevantSchemes' in analysis ? analysis.relevantSchemes : analysis.schemeAnalyses
  const top = schemes[0]
  const suitability =
    'opportunityAssessment' in analysis ? analysis.opportunityAssessment.businessSuitability : undefined
  const finance = 'financialPath' in analysis ? analysis.financialPath : undefined
  const gaps =
    'readiness' in analysis ? analysis.readiness.materialGapsRemaining : []

  const stage =
    userProfile.businessStage === 'existing_expansion' || userProfile.businessStatus === 'existing'
      ? language === 'kn'
        ? 'ಅಸ್ತಿತ್ವದಲ್ಲಿರುವ ವ್ಯವಹಾರ ವಿಸ್ತರಣೆ'
        : 'an existing business expansion'
      : language === 'kn'
        ? 'ಹೊಸ ವ್ಯವಹಾರ'
        : 'a new/first-time business'

  const sector = userProfile.businessSector ?? summary?.whatCitizenWants ?? 'your stated activity'
  const where = userProfile.state ? (language === 'kn' ? `${userProfile.state} ನಲ್ಲಿ` : `in ${userProfile.state}`) : ''

  const lines: string[] = []

  if (language === 'kn') {
    lines.push(
      `ನೀವು ಹಂಚಿಕೊಂಡ ಮಾಹಿತಿಯ ಪ್ರಕಾರ, ${where} ${sector} (${stage}) ಕುರಿತು ವಿಶ್ಲೇಷಣೆ ಮಾಡಲಾಗಿದೆ.`,
    )
  } else if (language === 'mixed') {
    lines.push(
      `Based on what you've shared, ${sector} ${stage} ${where} — analysis madidivi from the structured evidence only.`,
    )
  } else {
    lines.push(
      `Based on the information you've given me, this looks like ${stage} focused on ${sector}${where ? ` ${where}` : ''}.`,
    )
  }

  if (top) {
    lines.push(top.matchExplanation)
  } else if (language === 'kn') {
    lines.push('ಸದ್ಯಕ್ಕೆ ಹೊಂದಾಣಿಕೆಯಾಗುವ ಯೋಜನೆಗಳು ಸಾಕಷ್ಟು ಸ್ಪಷ್ಟವಾಗಿಲ್ಲ.')
  } else {
    lines.push('No scheme match is strong enough yet to treat as a recommendation.')
  }

  if (suitability) {
    lines.push(`Business suitability (evidence-bound only): ${suitability.kind.replace(/_/g, ' ')}. ${suitability.rationale}`)
  }

  if (finance?.status === 'not_determined') {
    lines.push(
      language === 'kn'
        ? 'ಸಾಲದ ಮೊತ್ತ ಇನ್ನೂ ನಿರ್ಧರಿಸಿಲ್ಲ — ಯಾವುದೇ ಅಂಕಿ ಅಂದಾಜು ಮಾಡಿಲ್ಲ.'
        : 'The financing plan is not yet determined — no loan amount has been invented.',
    )
  } else if (finance?.nsfdcPlan) {
    // Do not embed derived EMI/loan figures in prose — those live in
    // financialPath.nsfdcPlan structured fields (from buildSchemePlan).
    lines.push(
      `An NSFDC plan was referenced from the existing finance engine (${finance.nsfdcPlan.schemeName}). See financialPath.nsfdcPlan for exact figures.`,
    )
  }

  if (gaps.length > 0) {
    lines.push(
      language === 'kn'
        ? `ಇನ್ನೂ ತಿಳಿಯಬೇಕಾದ ಮುಖ್ಯ ಅಂಶಗಳು: ${gaps.join(', ')}.`
        : `I still need more detail on: ${gaps.join(', ')} before treating matches as fully confirmed.`,
    )
  }

  lines.push(
    language === 'kn'
      ? 'ಅಧಿಕೃತ ಪರಿಶೀಲನೆ ಯೋಜನಾ ನಿರ್ಧಾರಕ್ಕೆ ಇನ್ನೂ ಅನ್ವಯಿಸುತ್ತದೆ.'
      : 'Official verification still applies before any scheme decision.',
  )

  return lines.join('\n\n')
}

export class OfflineReportExplanationProvider implements ReportExplanationProvider {
  readonly id = 'offline_template'

  explain(request: ReportExplanationRequest): Promise<string> {
    return Promise.resolve(composeOfflineReportExplanation(request))
  }
}

export const offlineReportExplanationProvider = new OfflineReportExplanationProvider()

function toGuardContext(request: ReportExplanationRequest): AIRequestContext {
  return {
    profile: request.userProfile,
    message: request.message ?? '',
    history: [],
    missingFields: [],
    ranked: request.ranked,
    newlyUpdatedFields: [],
  }
}

export interface AttachExplanationResult {
  report: PersonalizedReport
  explanation: GuardedExplanation
}

/**
 * Runs a provider, validates with responseGuard (+ amount checks), and
 * returns a NEW report object with explanations attached. On guard failure,
 * substitutes the offline deterministic template rather than attaching
 * untrusted text.
 */
export async function attachGuardedExplanation(
  report: PersonalizedReport,
  request: Omit<ReportExplanationRequest, 'analysis'> & {
    analysis?: DeterministicAnalysis | PersonalizedReport
    provider?: ReportExplanationProvider
  },
): Promise<AttachExplanationResult> {
  const provider = request.provider ?? offlineReportExplanationProvider
  const fullRequest: ReportExplanationRequest = {
    analysis: request.analysis ?? report,
    language: request.language,
    userProfile: request.userProfile,
    ranked: request.ranked,
    message: request.message,
  }

  const context = toGuardContext(fullRequest)
  let text = await provider.explain(fullRequest)
  let usedProvider: GuardedExplanation['usedProvider'] =
    provider.id === 'offline_template' ? 'offline_template' : 'ai_provider'
  let fellBack = false

  const claimGuard = validateProviderReply(text, context)
  const amountHits = findUnapprovedAmounts(text, context)
  if (!claimGuard.ok || amountHits.length > 0) {
    text = composeOfflineReportExplanation({ ...fullRequest, language: request.language })
    usedProvider = 'deterministic_fallback'
    fellBack = true
  }

  // Re-validate fallback (should always pass; if not, strip to a minimal safe line).
  const fallbackGuard = validateProviderReply(text, context)
  const fallbackAmounts = findUnapprovedAmounts(text, context)
  if (!fallbackGuard.ok || fallbackAmounts.length > 0) {
    text =
      request.language === 'kn'
        ? 'ರಚನಾತ್ಮಕ ವಿಶ್ಲೇಷಣೆಯನ್ನು ನೋಡಿ. ಅನುಮೋದನೆ ಇಲ್ಲ.'
        : 'See the structured analysis fields. No approval or guarantee is implied.'
    usedProvider = 'deterministic_fallback'
    fellBack = true
  }

  const explanation: GuardedExplanation = {
    language: request.language,
    text,
    usedProvider,
    guardPassed: true,
    fellBack,
  }

  const next: PersonalizedReport = {
    ...report,
    opportunityAssessment: {
      ...report.opportunityAssessment,
      narrative: text,
    },
    explanations: [...(report.explanations ?? []), explanation],
  }

  return { report: next, explanation }
}
