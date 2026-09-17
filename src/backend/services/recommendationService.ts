/**
 * Deterministic scheme recommender v0 — grounded in registry facts only.
 * Does not invent schemes; does not call an LLM.
 */

import { NSFDC } from '../../lib/config'
import type { MissingField } from '../../contracts/profile'
import type {
  RecommendationEnvelope,
  RecommendationInput,
  RecommendationNextStep,
  RecommendationResult,
} from '../../contracts/recommendation'
import type { SchemeRecord } from '../../contracts/scheme'
import type { RecommendationService, SchemeRegistry } from '../services/types'
import { getDefaultSchemeRegistry } from '../registry/fixtureSchemeRegistry'
import { getMissingFields } from '../adapters/profileHelpers'

function projectCostFromMargin(margin: number): number {
  return Math.round(margin * 10 * 100) / 100
}

/** Deterministic follow-up actions — never an LLM suggestion, only rules over eligible/missing/reasons. */
function buildNextSteps(
  eligible: boolean,
  missing: MissingField[],
  reasons: RecommendationResult['reasons'],
): RecommendationNextStep[] {
  const steps: RecommendationNextStep[] = []

  if (missing.length > 0) {
    const keys = missing.map((m) => m.key).join(', ')
    steps.push({
      code: 'provide_missing_profile_fields',
      messageEn: `Provide the missing profile details needed to confirm this: ${keys}.`,
      messageKn: `ಇದನ್ನು ದೃಢೀಕರಿಸಲು ಕೊರತೆಯಿರುವ ಪ್ರೊಫೈಲ್ ವಿವರಗಳನ್ನು ನೀಡಿ: ${keys}.`,
    })
  }

  const blocking = reasons.filter((r) => r.severity === 'blocking')
  if (blocking.length > 0) {
    steps.push({
      code: 'resolve_blocking_eligibility',
      messageEn: 'Resolve the blocking eligibility issue(s) above before applying for this scheme.',
      messageKn: 'ಈ ಯೋಜನೆಗೆ ಅರ್ಜಿ ಸಲ್ಲಿಸುವ ಮೊದಲು ಮೇಲಿನ ಅಡ್ಡಿಪಡಿಸುವ ಅರ್ಹತಾ ಸಮಸ್ಯೆಗಳನ್ನು ಪರಿಹರಿಸಿ.',
    })
  }

  if (eligible && missing.length === 0 && blocking.length === 0) {
    steps.push({
      code: 'gather_documents_and_apply',
      messageEn: 'Gather the listed documents and apply via the NSFDC channelizing agency / bank partner noted in the procedure summary.',
      messageKn: 'ಪಟ್ಟಿ ಮಾಡಿದ ದಾಖಲೆಗಳನ್ನು ಸಂಗ್ರಹಿಸಿ ಮತ್ತು ಪ್ರಕ್ರಿಯೆ ಸಾರಾಂಶದಲ್ಲಿ ಸೂಚಿಸಿದ NSFDC ಚಾನೆಲೈಸಿಂಗ್ ಏಜೆನ್ಸಿ / ಬ್ಯಾಂಕ್ ಪಾರ್ಟ್‌ನರ್ ಮೂಲಕ ಅರ್ಜಿ ಸಲ್ಲಿಸಿ.',
    })
  }

  return steps
}

function scoreScheme(
  scheme: SchemeRecord,
  input: RecommendationInput,
  missing: MissingField[],
): RecommendationResult | null {
  const v = scheme.latestVersion
  if (!v || !v.loanTerms) return null

  const profile = input.profile
  const reasons: RecommendationResult['reasons'] = []
  let score = 40
  let eligible = true

  const community = profile.community.value
  const preferred = v.eligibilityHints.communitiesPreferred
  if (community && preferred.includes(community)) {
    score += 30
    reasons.push({
      code: 'community_match',
      messageEn: `Community ${community.toUpperCase()} matches preferred beneficiaries for this scheme.`,
      messageKn: `ಸಮುದಾಯ ${community.toUpperCase()} ಈ ಯೋಜನೆಯ ಆದ್ಯತಾ ಫಲಾನುಭವಿಗಳಿಗೆ ಹೊಂದುತ್ತದೆ.`,
      severity: 'positive',
    })
  } else if (community) {
    score -= 15
    eligible = community === 'sc' ? eligible : false
    reasons.push({
      code: 'community_alternate',
      messageEn: 'NSFDC core schemes target SC beneficiaries — flag for alternate channel if not SC.',
      messageKn: 'ಎನ್‌ಎಸ್‌ಎಫ್‌ಡಿಸಿ ಮುಖ್ಯ ಯೋಜನೆಗಳು ಪರಿಶಿಷ್ಟ ಜಾತಿಗೆ — ಪರ್ಯಾಯ ಮಾರ್ಗ ಗುರುತಿಸಿ.',
      severity: community === 'sc' ? 'info' : 'warning',
    })
    if (community !== 'sc') eligible = false
  }

  const income = profile.annualIncome.value
  const maxIncome = v.eligibilityHints.maxAnnualIncomeRupees
  if (income != null && maxIncome != null) {
    if (income <= maxIncome) {
      score += 15
      reasons.push({
        code: 'income_ok',
        messageEn: `Income within typical ceiling (≤ ₹${maxIncome.toLocaleString('en-IN')}).`,
        messageKn: `ಆದಾಯ ಮಿತಿಯೊಳಗೆ (≤ ₹${maxIncome.toLocaleString('en-IN')}).`,
        severity: 'positive',
      })
    } else {
      score -= 20
      eligible = false
      reasons.push({
        code: 'income_high',
        messageEn: 'Income above typical NSFDC ceiling.',
        messageKn: 'ಆದಾಯ NSFDC ಮಿತಿ ಮೀರಿದೆ.',
        severity: 'blocking',
      })
    }
  }

  if (profile.gender.value === 'female' && v.eligibilityHints.womenPriority) {
    score += 10
    reasons.push({
      code: 'women_priority',
      messageEn: 'Women get priority allocation under NSFDC Term Loan / MFS targets.',
      messageKn: 'ಮಹಿಳೆಯರಿಗೆ NSFDC ಆದ್ಯತೆ ಗುರಿ.',
      severity: 'positive',
    })
  }

  const margin = profile.availableMargin.value
  if (margin == null || margin <= 0) {
    reasons.push({
      code: 'margin_missing',
      messageEn: 'Available margin capital is required to place the project on the NSFDC ladder.',
      messageKn: 'ಯೋಜನಾ ವೆಚ್ಚಕ್ಕೆ ಮಾರ್ಜಿನ್ ಬಂಡವಾಳ ಅಗತ್ಯ.',
      severity: 'blocking',
    })
    return {
      schemeId: scheme.id,
      schemeVersionId: v.id,
      schemeCode: scheme.code,
      schemeNameEn: scheme.nameEn,
      schemeNameKn: scheme.nameKn,
      rank: 0,
      score: Math.max(0, Math.min(100, score)),
      eligible: false,
      reasons,
      schemeVersion: v.version,
      missingFields: missing,
      freshnessScore: v.freshnessScore,
      nextSteps: buildNextSteps(false, missing, reasons),
    }
  }

  const projectCost = projectCostFromMargin(margin)
  const terms = v.loanTerms
  const min = terms.projectCostMinRupees ?? 0
  const max = terms.projectCostMaxRupees ?? Number.POSITIVE_INFINITY

  if (projectCost < min || projectCost > max) {
    eligible = false
    reasons.push({
      code: 'project_cost_out_of_band',
      messageEn: `Implied project cost ₹${projectCost.toLocaleString('en-IN')} is outside this scheme’s band (₹${min.toLocaleString('en-IN')}–₹${max === Number.POSITIVE_INFINITY ? '∞' : max.toLocaleString('en-IN')}).`,
      messageKn: `ಯೋಜನಾ ವೆಚ್ಚ ₹${projectCost.toLocaleString('en-IN')} ಈ ಯೋಜನೆಯ ವ್ಯಾಪ್ತಿಯ ಹೊರಗೆ.`,
      severity: 'blocking',
    })
  } else {
    score += 20
    reasons.push({
      code: 'project_cost_fit',
      messageEn: `Implied project cost ₹${projectCost.toLocaleString('en-IN')} (margin × 10) fits this scheme band.`,
      messageKn: `ಯೋಜನಾ ವೆಚ್ಚ ₹${projectCost.toLocaleString('en-IN')} ಈ ಯೋಜನೆಗೆ ಹೊಂದುತ್ತದೆ.`,
      severity: 'positive',
    })
  }

  if (projectCost > NSFDC.termProjectCapRupees) {
    eligible = false
    reasons.push({
      code: 'over_nsfdc_cap',
      messageEn: `Project cost exceeds NSFDC Term Loan cap (₹${NSFDC.termProjectCapRupees.toLocaleString('en-IN')}).`,
      messageKn: 'ಯೋಜನಾ ವೆಚ್ಚ NSFDC ಮಿತಿ ಮೀರಿದೆ.',
      severity: 'blocking',
    })
  }

  return {
    schemeId: scheme.id,
    schemeVersionId: v.id,
    schemeCode: scheme.code,
    schemeNameEn: scheme.nameEn,
    schemeNameKn: scheme.nameKn,
    rank: 0,
    score: Math.max(0, Math.min(100, score)),
    eligible,
    reasons,
    schemeVersion: v.version,
    missingFields: missing,
    freshnessScore: v.freshnessScore,
    nextSteps: buildNextSteps(eligible, missing, reasons),
  }
}

export function createRecommendationService(
  registry: SchemeRegistry = getDefaultSchemeRegistry(),
): RecommendationService {
  return {
    async recommend(input: RecommendationInput): Promise<RecommendationEnvelope> {
      const missing = getMissingFields(input.profile)
      const envelopeBase = await registry.listSchemes()
      const schemes: SchemeRecord[] = []
      for (const summary of envelopeBase.data) {
        const full = await registry.getScheme(summary.id)
        if (full) schemes.push(full)
      }

      const results: RecommendationResult[] = []
      for (const s of schemes) {
        const r = scoreScheme(s, input, missing)
        if (r) results.push(r)
      }

      results.sort((a, b) => {
        if (a.eligible !== b.eligible) return a.eligible ? -1 : 1
        return b.score - a.score
      })
      results.forEach((r, i) => {
        r.rank = i + 1
      })

      const limit = input.limit ?? 10
      const sliced = results.slice(0, limit)

      return {
        data: sliced,
        provenance: envelopeBase.provenance,
        verificationStatus: envelopeBase.verificationStatus,
        stale: envelopeBase.stale,
        sourceIds: envelopeBase.sourceIds,
        retrievedAt: new Date().toISOString(),
        honestyNoteEn:
          envelopeBase.honestyNoteEn +
          ' Recommendations are deterministic rule matches against registry v0 — not LLM judgments.',
        honestyNoteKn: envelopeBase.honestyNoteKn,
      }
    },
  }
}
