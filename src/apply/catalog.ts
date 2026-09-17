/**
 * Per-scheme application schemas and recommended filing channels.
 *
 * Documents and official URLs come from the assistant knowledge base
 * (`src/assistant/data/schemes.ts`) so the apply packet and the chatbot
 * never disagree. Extra applicant fields (name, mobile) are collected here
 * because the chat profile does not include them.
 *
 * None of these schemes currently expose a credentials-backed apply API
 * that this prototype can call, so recommended_channel is guided or
 * assisted — never a pretend government API. The government_api channel
 * still exists on every scheme so the workflow is identical; it fails
 * honestly when unconfigured.
 */

import { SCHEMES } from '../assistant/data/schemes'
import { effectiveFinancingNeed } from '../assistant/missingFields'
import type { UserProfile } from '../assistant/types'
import type {
  ApplicationDocumentSpec,
  ApplicationFieldSpec,
  FilingChannel,
  SchemeApplicationSpec,
} from './types'

function commonFields(loanMax?: number, loanMin?: number): ApplicationFieldSpec[] {
  return [
    {
      key: 'applicant_name',
      label: 'Applicant full name',
      required: true,
      fieldType: 'string',
      minLength: 2,
      maxLength: 200,
      helpText: 'Name as it appears on Aadhaar / identity proof.',
    },
    {
      key: 'mobile',
      label: 'Mobile number',
      required: true,
      fieldType: 'string',
      minLength: 10,
      maxLength: 10,
      pattern: '^[6-9]\\d{9}$',
      helpText: '10-digit Indian mobile number, no country code.',
    },
    {
      key: 'state',
      label: 'State',
      required: true,
      fieldType: 'string',
      profileSource: 'state',
      maxLength: 80,
    },
    {
      key: 'district',
      label: 'District',
      required: false,
      fieldType: 'string',
      profileSource: 'district',
      maxLength: 80,
    },
    {
      key: 'area_type',
      label: 'Area type',
      required: true,
      fieldType: 'string',
      profileSource: 'areaType',
      helpText: 'rural or urban',
      maxLength: 20,
    },
    {
      key: 'age',
      label: 'Age',
      required: true,
      fieldType: 'integer',
      profileSource: 'age',
      minValue: 18,
      maxValue: 80,
    },
    {
      key: 'gender',
      label: 'Gender',
      required: true,
      fieldType: 'string',
      profileSource: 'gender',
      maxLength: 20,
    },
    {
      key: 'social_category',
      label: 'Social category',
      required: true,
      fieldType: 'string',
      profileSource: 'socialCategory',
      helpText: 'sc, st, obc, or general',
      maxLength: 20,
    },
    {
      key: 'annual_income',
      label: 'Annual household income (INR)',
      required: true,
      fieldType: 'integer',
      profileSource: 'annualIncome',
      minValue: 0,
    },
    {
      key: 'business_sector',
      label: 'Business sector',
      required: true,
      fieldType: 'string',
      profileSource: 'businessSector',
      maxLength: 80,
    },
    {
      key: 'proposed_business',
      label: 'Proposed / current business',
      required: false,
      fieldType: 'string',
      profileSource: 'proposedBusiness',
      maxLength: 200,
    },
    {
      key: 'business_stage',
      label: 'Business stage',
      required: true,
      fieldType: 'string',
      profileSource: 'businessStage',
      helpText: 'idea, new, or existing_expansion',
      maxLength: 40,
    },
    {
      key: 'loan_amount_requested',
      label: 'Loan / financing requested (INR)',
      required: true,
      fieldType: 'integer',
      profileSource: 'effectiveFinancing',
      minValue: loanMin && loanMin > 0 ? loanMin : 1,
      maxValue: loanMax,
    },
    {
      key: 'own_contribution',
      label: 'Own contribution / margin capital (INR)',
      required: false,
      fieldType: 'integer',
      profileSource: 'ownContribution',
      minValue: 0,
    },
    {
      key: 'education',
      label: 'Education qualification',
      required: false,
      fieldType: 'string',
      profileSource: 'education',
      maxLength: 120,
    },
  ]
}

function documentsFromScheme(schemeId: string): ApplicationDocumentSpec[] {
  const scheme = SCHEMES.find((s) => s.id === schemeId)
  if (!scheme) return []
  return scheme.documents.map((label, i) => ({
    key: `${schemeId}-doc-${i}`,
    label,
    required: true,
    notes: 'Declared locally — this app does not upload files to any government system.',
  }))
}

interface ChannelOverride {
  recommended: FilingChannel
  rationale: string
  extraFields?: ApplicationFieldSpec[]
}

const CHANNEL: Record<string, ChannelOverride> = {
  'nsfdc-micro-finance': {
    recommended: 'assisted',
    rationale:
      'NSFDC applications are filed through the State Channelising Agency, not a public apply API. Assisted submission prepares the packet your SCA / partner bank can take forward.',
  },
  'nsfdc-term-loan': {
    recommended: 'assisted',
    rationale:
      'NSFDC term-loan cases go through the SCA. This prototype has no SCA filing credentials, so assisted packet preparation is the honest path.',
  },
  pmegp: {
    recommended: 'guided',
    rationale:
      'KVIC does not publish a public apply API this prototype can call. Guided submission opens the official PMEGP e-portal with your packet pre-filled for you to submit there.',
    extraFields: [
      {
        key: 'education',
        label: 'Education qualification',
        required: true,
        fieldType: 'string',
        profileSource: 'education',
        maxLength: 120,
        helpText: 'At least Class VIII pass is typically required for larger PMEGP projects.',
      },
    ],
  },
  'pm-mudra-yojana': {
    recommended: 'guided',
    rationale:
      'MUDRA loans are filed with a bank or on Jan Samarth / Udyamimitra. No central public apply API is configured here, so guided filing on the official portal is the honest path.',
  },
  'stand-up-india': {
    recommended: 'guided',
    rationale:
      'Stand-Up India applications go through standupmitra.in or a bank branch. This prototype has no portal credentials, so guided submission is the working channel.',
  },
  'pm-vishwakarma': {
    recommended: 'guided',
    rationale:
      'PM Vishwakarma registration is via CSC or the official portal. Guided submission prepares the packet and sends you to pmvishwakarma.gov.in.',
  },
  'nbcfdc-term-loan': {
    recommended: 'assisted',
    rationale:
      'NBCFDC is routed through the State Channelising Agency. Assisted submission prepares that packet; this platform cannot file with NBCFDC itself.',
  },
  'kudumbashree-microenterprise': {
    recommended: 'assisted',
    rationale:
      'Kudumbashree microenterprise support is endorsed through the NHG / CDS. Assisted submission prepares the packet for your local unit.',
    extraFields: [
      {
        key: 'nhg_membership',
        label: 'Kudumbashree NHG name / membership id',
        required: true,
        fieldType: 'string',
        maxLength: 120,
      },
    ],
  },
}

function isGovApiConfigured(): boolean {
  const url = import.meta.env.VITE_GOV_APPLY_API_URL
  return typeof url === 'string' && url.trim().length > 0
}

export function getSchemeApplicationSpec(schemeId: string): SchemeApplicationSpec {
  const scheme = SCHEMES.find((s) => s.id === schemeId)
  if (!scheme) {
    const known = SCHEMES.map((s) => s.id).join(', ')
    throw new Error(`Unknown scheme '${schemeId}'. Known schemes: ${known}`)
  }
  const override = CHANNEL[schemeId]
  const extras = override?.extraFields ?? []
  const base = commonFields(scheme.loanAmount?.maxRupees, scheme.loanAmount?.minRupees)
  const merged = [...base]
  for (const extra of extras) {
    const idx = merged.findIndex((f) => f.key === extra.key)
    if (idx >= 0) merged[idx] = extra
    else merged.push(extra)
  }

  return {
    schemeId: scheme.id,
    displayName: scheme.shortName ?? scheme.name,
    officialApplicationUrl: scheme.officialApplicationUrl,
    officialInfoUrl: scheme.officialInfoUrl,
    applyProcess: scheme.applicationSteps,
    channel: {
      recommended: override?.recommended ?? 'guided',
      rationale:
        override?.rationale ??
        'No government apply API is configured for this scheme. Guided or assisted filing is the honest path.',
      governmentApiConfigured: isGovApiConfigured(),
    },
    fields: merged,
    documents: documentsFromScheme(scheme.id),
  }
}

export function listApplySchemes(): Array<{ id: string; name: string; recommended: FilingChannel }> {
  return SCHEMES.map((s) => ({
    id: s.id,
    name: s.shortName ?? s.name,
    recommended: CHANNEL[s.id]?.recommended ?? 'guided',
  }))
}

export function derivedFinancing(profile: UserProfile): number | undefined {
  return effectiveFinancingNeed(profile)
}
