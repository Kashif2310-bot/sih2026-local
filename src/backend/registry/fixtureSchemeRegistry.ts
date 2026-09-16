/**
 * Scheme registry v0 fixture — NSFDC Micro Finance + Term Loan only.
 *
 * Source-backed from existing src/lib/config.ts NSFDC constants and
 * indicative document checklist (explicitly labeled prototype_indicative).
 *
 * Replace createFixtureSchemeRegistry() with a Supabase-backed implementation
 * later without changing SchemeRetrievalService consumers.
 */

import { NSFDC } from '../../lib/config'
import type { Uuid } from '../../contracts/common'
import type {
  Department,
  Ministry,
  SchemeFilter,
  SchemeRecord,
  SchemeSource,
  SchemeSummary,
  SchemeVersionRecord,
} from '../../contracts/scheme'
import type { SchemeRegistry } from '../services/types'

/** Stable UUIDs so other workstreams can hard-reference in tests/fixtures. */
export const FIXTURE_IDS = {
  ministryMosje: '11111111-1111-4111-8111-111111111101' as Uuid,
  deptNsfdc: '11111111-1111-4111-8111-111111111102' as Uuid,
  schemeMicro: '22222222-2222-4222-8222-222222222201' as Uuid,
  schemeTerm: '22222222-2222-4222-8222-222222222202' as Uuid,
  versionMicro: '33333333-3333-4333-8333-333333333301' as Uuid,
  versionTerm: '33333333-3333-4333-8333-333333333302' as Uuid,
  sourceNsfdcSite: '44444444-4444-4444-8444-444444444401' as Uuid,
  sourceConfigConst: '44444444-4444-4444-8444-444444444402' as Uuid,
} as const

const RETRIEVED_AT = '2026-09-16T00:00:00.000Z'

const ministry: Ministry = {
  id: FIXTURE_IDS.ministryMosje,
  code: 'MOSJE',
  nameEn: 'Ministry of Social Justice and Empowerment',
  nameKn: 'ಸಾಮಾಜಿಕ ನ್ಯಾಯ ಮತ್ತು ಸಬಲೀಕರಣ ಸಚಿವಾಲಯ',
  level: 'central',
}

const department: Department = {
  id: FIXTURE_IDS.deptNsfdc,
  ministryId: FIXTURE_IDS.ministryMosje,
  code: 'NSFDC',
  nameEn: 'National Scheduled Castes Finance and Development Corporation',
  nameKn: 'ರಾಷ್ಟ್ರೀಯ ಪರಿಶಿಷ್ಟ ಜಾತಿ ಹಣಕಾಸು ಮತ್ತು ಅಭಿವೃದ್ಧಿ ನಿಗಮ',
}

const sourceSite: SchemeSource = {
  id: FIXTURE_IDS.sourceNsfdcSite,
  sourceType: 'official_website',
  titleEn: 'NSFDC — official corporation site (reference; terms encoded from SIH PS + config.ts)',
  url: 'https://nsfdc.nic.in/',
  publisher: 'NSFDC',
  publishedAt: null,
  retrievedAt: RETRIEVED_AT,
  confidence: 0.7,
  status: 'prototype_indicative',
  notesEn:
    'URL is the official NSFDC domain. Loan numeric terms in this fixture are taken from the SIH26091 problem statement constants already locked in src/lib/config.ts — not scraped live.',
}

const sourceConfig: SchemeSource = {
  id: FIXTURE_IDS.sourceConfigConst,
  sourceType: 'prototype_fixture',
  titleEn: 'LokPulse NSFDC constants (src/lib/config.ts)',
  url: null,
  publisher: 'LokPulse SIH26091',
  publishedAt: RETRIEVED_AT,
  retrievedAt: RETRIEVED_AT,
  confidence: 1,
  status: 'verified',
  notesEn:
    'Authoritative numeric ladder for this prototype: margin 10%, loan 90%, Micro ≤₹1.40L / cap ₹1.25L / 6.5% / 3y / 3mo; Term ≤₹50L / cap ₹45L / 8% / 7y / 6mo.',
}

const commonDocsIndicative = [
  {
    docType: 'aadhaar',
    required: true,
    labelEn: 'Aadhaar card (identity + address proof)',
    labelKn: 'ಆಧಾರ್ ಕಾರ್ಡ್ (ಗುರುತು + ವಿಳಾಸ ಪುರಾವೆ)',
    indicative: true,
  },
  {
    docType: 'caste_certificate',
    required: true,
    labelEn: 'Caste certificate (SC/ST/OBC as applicable)',
    labelKn: 'ಜಾತಿ ಪ್ರಮಾಣಪತ್ರ (ಅನ್ವಯಿಸಿದಂತೆ SC/ST/OBC)',
    indicative: true,
  },
  {
    docType: 'income_certificate',
    required: true,
    labelEn: 'Income certificate / family income proof',
    labelKn: 'ಆದಾಯ ಪ್ರಮಾಣಪತ್ರ / ಕುಟುಂಬ ಆದಾಯ ಪುರಾವೆ',
    indicative: true,
  },
  {
    docType: 'bank_passbook',
    required: true,
    labelEn: 'Bank passbook / account statement',
    labelKn: 'ಬ್ಯಾಂಕ್ ಪಾಸ್‌ಬುಕ್ / ಖಾತೆ ವಿವರ',
    indicative: true,
  },
  {
    docType: 'project_report',
    required: true,
    labelEn: 'Project report / cost estimate for the proposed business',
    labelKn: 'ಪ್ರಸ್ತಾವಿತ ವ್ಯಾಪಾರದ ಯೋಜನಾ ವರದಿ / ವೆಚ್ಚ ಅಂದಾಜು',
    indicative: true,
  },
]

const eligibilityHintsBase = {
  communitiesPreferred: ['sc'] as Array<'sc' | 'st' | 'obc' | 'general'>,
  maxAnnualIncomeRupees: 500_000,
  womenPriority: true,
  minAge: 18,
  maxAge: null,
  businessCategories: null,
  states: null,
}

function microVersion(): SchemeVersionRecord {
  return {
    id: FIXTURE_IDS.versionMicro,
    schemeId: FIXTURE_IDS.schemeMicro,
    version: 'v0.1.0',
    effectiveFrom: RETRIEVED_AT,
    effectiveTo: null,
    benefits: [
      {
        kind: 'loan',
        summaryEn: 'Concessional micro finance loan up to 90% of project cost (cap ₹1.25 lakh).',
        summaryKn: 'ಯೋಜನಾ ವೆಚ್ಚದ 90% ವರೆಗೆ ರಿಯಾಯಿತಿ ಮೈಕ್ರೋ ಫೈನಾನ್ಸ್ ಸಾಲ (ಗರಿಷ್ಠ ₹1.25 ಲಕ್ಷ).',
      },
    ],
    loanTerms: {
      projectCostMinRupees: 1,
      projectCostMaxRupees: NSFDC.microProjectCapRupees,
      loanRatio: NSFDC.loanRatio,
      loanCapRupees: NSFDC.microLoanCapRupees,
      interestRatePercent: NSFDC.microRate,
      tenureYears: NSFDC.microTenureYears,
      moratoriumMonths: NSFDC.microMoratoriumMonths,
      marginRatio: NSFDC.marginRatio,
    },
    subsidies: [],
    procedureSummaryEn:
      'Apply via NSFDC channelizing agency (SCA) / bank partner. Confirm exact process with local SCA — this fixture does not claim a live application API.',
    procedureSummaryKn:
      'NSFDC ಚಾನೆಲೈಸಿಂಗ್ ಏಜೆನ್ಸಿ (SCA) / ಬ್ಯಾಂಕ್ ಪಾರ್ಟ್‌ನರ್ ಮೂಲಕ ಅರ್ಜಿ. ನಿಖರ ಪ್ರಕ್ರಿಯೆಯನ್ನು ಸ್ಥಳೀಯ SCA ಯಿಂದ ದೃಢೀಕರಿಸಿ.',
    officialUrls: ['https://nsfdc.nic.in/'],
    documents: [
      ...commonDocsIndicative,
      {
        docType: 'shg_recommendation',
        required: false,
        labelEn: 'SHG / channel partner recommendation letter, if routed via SHG',
        labelKn: 'SHG ಮೂಲಕವಾದರೆ SHG / ಚಾನೆಲ್ ಪಾರ್ಟ್‌ನರ್ ಶಿಫಾರಸು ಪತ್ರ',
        indicative: true,
      },
    ],
    eligibilitySummaryEn:
      'NSFDC core schemes target Scheduled Caste beneficiaries; typical income ceiling ≤ ₹5 lakh; women priority allocation under Term Loan / MFS.',
    eligibilitySummaryKn:
      'ಎನ್‌ಎಸ್‌ಎಫ್‌ಡಿಸಿ ಮುಖ್ಯ ಯೋಜನೆಗಳು ಪರಿಶಿಷ್ಟ ಜಾತಿ ಫಲಾನುಭವಿಗಳಿಗೆ; ಸಾಮಾನ್ಯ ಆದಾಯ ಮಿತಿ ≤ ₹5 ಲಕ್ಷ; ಮಹಿಳೆಯರಿಗೆ ಆದ್ಯತೆ.',
    eligibilityHints: { ...eligibilityHintsBase },
    verificationStatus: 'verified',
    publishedAt: RETRIEVED_AT,
    retrievedAt: RETRIEVED_AT,
    freshnessScore: 1,
    sources: [sourceConfig, sourceSite],
  }
}

function termVersion(): SchemeVersionRecord {
  return {
    id: FIXTURE_IDS.versionTerm,
    schemeId: FIXTURE_IDS.schemeTerm,
    version: 'v0.1.0',
    effectiveFrom: RETRIEVED_AT,
    effectiveTo: null,
    benefits: [
      {
        kind: 'loan',
        summaryEn: 'Concessional term loan up to 90% of project cost (cap ₹45 lakh) for projects above ₹1.40 lakh up to ₹50 lakh.',
        summaryKn: '₹1.40 ಲಕ್ಷಕ್ಕಿಂತ ಹೆಚ್ಚು ಯೋಜನೆಗಳಿಗೆ 90% ವರೆಗೆ ಟರ್ಮ್ ಲೋನ್ (ಗರಿಷ್ಠ ₹45 ಲಕ್ಷ).',
      },
    ],
    loanTerms: {
      projectCostMinRupees: NSFDC.microProjectCapRupees + 1,
      projectCostMaxRupees: NSFDC.termProjectCapRupees,
      loanRatio: NSFDC.loanRatio,
      loanCapRupees: NSFDC.termLoanCapRupees,
      interestRatePercent: NSFDC.termRate,
      tenureYears: NSFDC.termTenureYears,
      moratoriumMonths: NSFDC.termMoratoriumMonths,
      marginRatio: NSFDC.marginRatio,
    },
    subsidies: [],
    procedureSummaryEn:
      'Apply via NSFDC channelizing agency (SCA) / bank partner. Confirm exact process with local SCA — this fixture does not claim a live application API.',
    procedureSummaryKn:
      'NSFDC ಚಾನೆಲೈಸಿಂಗ್ ಏಜೆನ್ಸಿ (SCA) / ಬ್ಯಾಂಕ್ ಪಾರ್ಟ್‌ನರ್ ಮೂಲಕ ಅರ್ಜಿ. ನಿಖರ ಪ್ರಕ್ರಿಯೆಯನ್ನು ಸ್ಥಳೀಯ SCA ಯಿಂದ ದೃಢೀಕರಿಸಿ.',
    officialUrls: ['https://nsfdc.nic.in/'],
    documents: [
      ...commonDocsIndicative,
      {
        docType: 'collateral_guarantor',
        required: false,
        labelEn: 'Collateral / guarantor details as required by the lending channel partner',
        labelKn: 'ಸಾಲ ನೀಡುವ ಚಾನೆಲ್ ಪಾರ್ಟ್‌ನರ್ ಅಗತ್ಯಪಡಿಸುವ ಜಾಮೀನು / ಖಾತರಿದಾರ ವಿವರ',
        indicative: true,
      },
      {
        docType: 'premises_proof',
        required: false,
        labelEn: 'Site / premises proof (owned or leased) for the proposed unit',
        labelKn: 'ಪ್ರಸ್ತಾವಿತ ಘಟಕಕ್ಕೆ ಸ್ಥಳ / ಆವರಣ ಪುರಾವೆ',
        indicative: true,
      },
    ],
    eligibilitySummaryEn:
      'NSFDC core schemes target Scheduled Caste beneficiaries; typical income ceiling ≤ ₹5 lakh; women priority allocation under Term Loan / MFS.',
    eligibilitySummaryKn:
      'ಎನ್‌ಎಸ್‌ಎಫ್‌ಡಿಸಿ ಮುಖ್ಯ ಯೋಜನೆಗಳು ಪರಿಶಿಷ್ಟ ಜಾತಿ ಫಲಾನುಭವಿಗಳಿಗೆ; ಸಾಮಾನ್ಯ ಆದಾಯ ಮಿತಿ ≤ ₹5 ಲಕ್ಷ; ಮಹಿಳೆಯರಿಗೆ ಆದ್ಯತೆ.',
    eligibilityHints: { ...eligibilityHintsBase },
    verificationStatus: 'verified',
    publishedAt: RETRIEVED_AT,
    retrievedAt: RETRIEVED_AT,
    freshnessScore: 1,
    sources: [sourceConfig, sourceSite],
  }
}

function buildSchemes(): SchemeRecord[] {
  const microV = microVersion()
  const termV = termVersion()
  return [
    {
      id: FIXTURE_IDS.schemeMicro,
      code: 'NSFDC_MICRO_FINANCE',
      nameEn: 'NSFDC Micro Finance Scheme',
      nameKn: 'ಎನ್‌ಎಸ್‌ಎಫ್‌ಡಿಸಿ ಮೈಕ್ರೋ ಫೈನಾನ್ಸ್ ಯೋಜನೆ',
      jurisdiction: 'central',
      owningDepartmentId: FIXTURE_IDS.deptNsfdc,
      owningMinistryId: FIXTURE_IDS.ministryMosje,
      status: 'active',
      latestVersion: microV,
    },
    {
      id: FIXTURE_IDS.schemeTerm,
      code: 'NSFDC_TERM_LOAN',
      nameEn: 'NSFDC Term Loan Scheme',
      nameKn: 'ಎನ್‌ಎಸ್‌ಎಫ್‌ಡಿಸಿ ಟರ್ಮ್ ಲೋನ್ ಯೋಜನೆ',
      jurisdiction: 'central',
      owningDepartmentId: FIXTURE_IDS.deptNsfdc,
      owningMinistryId: FIXTURE_IDS.ministryMosje,
      status: 'active',
      latestVersion: termV,
    },
  ]
}

const HONESTY_EN =
  'Registry v0 fixture: only NSFDC Micro Finance and Term Loan. Numeric terms from SIH26091 / src/lib/config.ts. Document lists are indicative (prototype_indicative), not from a specific circular. No live scraping. No other schemes claimed.'

const HONESTY_KN =
  'ರಿಜಿಸ್ಟ್ರಿ v0: ಕೇವಲ NSFDC ಮೈಕ್ರೋ ಮತ್ತು ಟರ್ಮ್ ಲೋನ್. ಸಂಖ್ಯೆಗಳು SIH26091 / config.ts ನಿಂದ. ದಾಖಲೆ ಪಟ್ಟಿ ಸೂಚಕ ಮಾತ್ರ.'

function toSummary(s: SchemeRecord): SchemeSummary {
  return {
    id: s.id,
    code: s.code,
    nameEn: s.nameEn,
    nameKn: s.nameKn,
    jurisdiction: s.jurisdiction,
    verificationStatus: s.latestVersion?.verificationStatus ?? 'unverified',
    provenance: 'curated_seed',
    latestVersionId: s.latestVersion?.id ?? null,
    latestVersion: s.latestVersion?.version ?? null,
  }
}

function matchesFilter(s: SchemeRecord, filter?: SchemeFilter): boolean {
  if (!filter) return true
  if (filter.jurisdiction && s.jurisdiction !== filter.jurisdiction) return false
  if (filter.ministryId && s.owningMinistryId !== filter.ministryId) return false
  if (filter.departmentId && s.owningDepartmentId !== filter.departmentId) return false
  if (filter.verificationStatus) {
    const st = s.latestVersion?.verificationStatus
    if (st !== filter.verificationStatus) return false
  }
  // businessCategory / stateCode: NSFDC fixture applies nationally and to all categories
  return true
}

function versionEnvelope(v: SchemeVersionRecord) {
  return {
    data: v,
    provenance: 'curated_seed' as const,
    verificationStatus: v.verificationStatus,
    stale: false,
    sourceIds: v.sources.map((x) => x.id),
    retrievedAt: v.retrievedAt,
    honestyNoteEn: HONESTY_EN,
    honestyNoteKn: HONESTY_KN,
  }
}

/** In-memory registry implementing SchemeRetrievalService. */
export function createFixtureSchemeRegistry(): SchemeRegistry {
  const schemes = buildSchemes()
  const byId = new Map(schemes.map((s) => [s.id, s]))
  const byCode = new Map(schemes.map((s) => [s.code, s]))

  return {
    async listSchemes(filter) {
      const list = schemes.filter((s) => matchesFilter(s, filter)).map(toSummary)
      return {
        data: list,
        provenance: 'curated_seed',
        verificationStatus: 'verified',
        stale: false,
        sourceIds: [FIXTURE_IDS.sourceConfigConst, FIXTURE_IDS.sourceNsfdcSite],
        retrievedAt: RETRIEVED_AT,
        honestyNoteEn: HONESTY_EN,
        honestyNoteKn: HONESTY_KN,
      }
    },

    async getScheme(schemeId) {
      return byId.get(schemeId) ?? byCode.get(schemeId) ?? null
    },

    async getSchemeVersion(schemeId, version) {
      const s = byId.get(schemeId) ?? byCode.get(schemeId)
      if (!s?.latestVersion) return null
      if (s.latestVersion.version !== version) return null
      return versionEnvelope(s.latestVersion)
    },

    async getLatestVerifiedVersion(schemeId) {
      const s = byId.get(schemeId) ?? byCode.get(schemeId)
      if (!s?.latestVersion) return null
      if (
        s.latestVersion.verificationStatus !== 'verified' &&
        s.latestVersion.verificationStatus !== 'prototype_indicative'
      ) {
        return null
      }
      return versionEnvelope(s.latestVersion)
    },

    async listMinistries() {
      return [ministry]
    },

    async listDepartments(ministryId) {
      if (ministryId && ministryId !== ministry.id) return []
      return [department]
    },
  }
}

/** Singleton for app wiring — tests may call createFixtureSchemeRegistry() fresh. */
let defaultRegistry: SchemeRegistry | null = null

export function getDefaultSchemeRegistry(): SchemeRegistry {
  if (!defaultRegistry) defaultRegistry = createFixtureSchemeRegistry()
  return defaultRegistry
}
