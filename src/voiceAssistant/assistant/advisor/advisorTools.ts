import { DOCUMENT_KIND_LABEL, type DocumentKind } from '../../application/documents'
import type { FeasibilityState } from '../../application/feasibility'
import type { FunctionDeclaration, ToolCall } from '../live/geminiProtocol'
import {
  chooseApplicationScheme,
  deriveAdvisorView,
  focusSearch,
  ingestUtterance,
  knownProfileFields,
  recognisedFields,
  showSchemeDetails,
  type AdvisorField,
  type AdvisorState,
  type AdvisorView,
  type SchemeMatch,
} from './advisor'

/** Model-facing descriptions, adapted from the main prototype's voiceTools.ts. */
export const ADVISOR_TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: 'recordCitizenDetail',
    description:
      "Record something the citizen just told you about themselves, their business or their documents (name, mobile number, age, state, district, rural or urban, gender, social category, income, the business, how much loan they need, their own contribution, years of experience, which documents they have). Call this whenever they share any such detail, before you respond. Pass their own words. The result fills the application form on their screen and tells you the next thing the form still needs.",
    parameters: {
      type: 'OBJECT',
      properties: {
        detail: {
          type: 'STRING',
          description:
            "What the citizen said, in English and as close to their own words as possible. If they spoke Kannada, translate it faithfully, keeping every name and number exactly. For example: 'I am 28, from a village near Mysore, and I want a 12 lakh loan for a dairy business'.",
        },
      },
      required: ['detail'],
    },
  },
  {
    name: 'findSchemes',
    description:
      'Find government schemes that match what is currently known about the citizen. Call this before naming or describing ANY scheme — you do not know which schemes exist or who qualifies, and must not guess. Returns ranked matches with their match percentage and eligibility status, and which scheme the application is being filled for. Works with a partial profile.',
    parameters: {
      type: 'OBJECT',
      properties: {
        focus: {
          type: 'STRING',
          description:
            "Optional topic to steer the search, such as 'dairy', 'loan', or 'tailoring'. Leave empty to use everything already known about the citizen.",
        },
      },
    },
  },
  {
    name: 'getSchemeDetails',
    description:
      "Get the full details of one scheme returned by findSchemes: what it offers, its eligibility rules checked against this citizen, the documents needed, and its application form fields. Also shows that scheme's details on the citizen's screen. It does not change which scheme the application is for. Call this before describing a scheme in any detail.",
    parameters: {
      type: 'OBJECT',
      properties: {
        schemeId: { type: 'STRING', description: 'The schemeId exactly as returned by findSchemes.' },
      },
      required: ['schemeId'],
    },
  },
  {
    name: 'applyForScheme',
    description:
      "Switch the application to a specific scheme, only when the citizen clearly asks to apply for that scheme instead of their top match. Pass an empty schemeId to go back to following the top match. Details already given carry over to the new form.",
    parameters: {
      type: 'OBJECT',
      properties: {
        schemeId: { type: 'STRING', description: 'The schemeId exactly as returned by findSchemes, or empty to follow the top match.' },
      },
    },
  },
  {
    name: 'getCitizenProfile',
    description:
      'Look up everything already on file for this citizen (including documents they said they have) and what the application still needs, in the order to ask. Call this before asking for anything, if you are not sure it is already on file.',
  },
  {
    name: 'getApplicationReadiness',
    description:
      "Check the application for the current scheme: how many required fields and documents are complete, what is still missing and how to ask for it, any value that needs confirmation, the Ishaara feasibility (LokScore) status, and whether the citizen can review and submit. Call this when the citizen asks how far along they are, or whether they can submit.",
  },
]

export const SOURCE_STATUS = 'curated_reference_data_not_live_government_data'

export type AdvisorToolOutcome =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: string; message: string }

export interface AdvisorToolContext {
  feasibility?: FeasibilityState
  /** The application scheme Gemini was last told about, so a change caused by live speech is still reported. */
  lastReportedSchemeId?: string | null
}

export interface AdvisorToolResult {
  state: AdvisorState
  outcome: AdvisorToolOutcome
}

function requireString(args: Record<string, unknown>, key: string): string | null {
  const value = args[key]
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  return requireString(args, key) ?? undefined
}

function summarize(match: SchemeMatch) {
  return {
    schemeId: match.id,
    name: match.name,
    eligibilityStatus: match.status,
    matchPercent: match.matchPercent,
    reasons: match.reasons.slice(0, 4),
    ...(match.mismatchReasons.length > 0 ? { mismatchReasons: match.mismatchReasons.slice(0, 2) } : {}),
    ...(match.missingInfo.length > 0 ? { missingInfo: match.missingInfo.slice(0, 2) } : {}),
  }
}

function knownFacts(view: AdvisorView): Record<string, unknown> {
  const known: Record<string, unknown> = {}
  for (const field of knownProfileFields(view.profile)) {
    if (field !== 'existingLoans') known[field] = view.profile[field]
  }
  const { details } = view
  if (details.applicantName) known.applicantName = details.applicantName
  if (details.mobile) known.mobile = details.mobile
  if (details.experienceYears !== undefined) known.experienceYears = details.experienceYears
  if (details.nhgMembership) known.nhgMembership = details.nhgMembership
  const documents = Object.entries(view.documents).map(([kind, declaration]) => `${DOCUMENT_KIND_LABEL[kind as DocumentKind]}: ${declaration === 'missing' ? 'does not have' : 'has it'}`)
  if (documents.length > 0) known.documents = documents
  return known
}

function topMatch(view: AdvisorView) {
  return view.top ? { schemeId: view.top.id, name: view.top.name, matchPercent: view.top.matchPercent, eligibilityStatus: view.top.status } : null
}

function applicationSummary(view: AdvisorView) {
  const form = view.application
  if (!form) return null
  const confirm = form.fields.filter((field) => field.status === 'needs_confirmation')
  return {
    schemeId: form.schemeId,
    scheme: form.schemeName,
    followsTopMatch: form.basis === 'top_match',
    requiredFieldsComplete: `${form.readiness.fieldsDone}/${form.readiness.fieldsTotal}`,
    documentsDeclared: `${form.readiness.documentsDone}/${form.readiness.documentsTotal}`,
    readinessPercent: form.readiness.percent,
    nextToAsk: view.nextQuestion ? { item: view.nextQuestion.label, question: view.nextQuestion.question } : null,
    ...(confirm.length > 0 ? { needsConfirmation: confirm.map((field) => ({ field: field.label, value: field.display, why: field.note })) } : {}),
    readyForReview: form.readiness.canSubmit,
  }
}

function applicationChange(view: AdvisorView, context: AdvisorToolContext) {
  const current = view.application?.schemeId ?? null
  if (context.lastReportedSchemeId === undefined || context.lastReportedSchemeId === current || !view.application) return {}
  const previous = context.lastReportedSchemeId ? view.ranked.find((r) => r.scheme.id === context.lastReportedSchemeId) : undefined
  return {
    applicationSwitched: {
      from: previous ? previous.scheme.shortName ?? previous.scheme.name : null,
      to: view.application.schemeName,
      matchPercent: view.applicationMatch?.matchPercent ?? null,
      note: 'The application form on screen now follows this scheme. Details already given carried over. Tell the citizen briefly.',
    },
  }
}

const FIELD_LABELS: Partial<Record<AdvisorField, string>> = {
  applicantName: 'name',
  mobile: 'mobile number',
  experienceYears: 'experience',
  nhgMembership: 'NHG membership',
  financingRequired: 'loan needed',
  investmentRequired: 'project cost',
  ownContribution: 'own contribution',
  annualIncome: 'family income',
  socialCategory: 'social category',
  businessSector: 'business sector',
  proposedBusiness: 'business idea',
  businessStage: 'business stage',
  areaType: 'rural or urban',
  curatedVillageId: 'village',
}

function describeField(field: AdvisorField): string {
  if (field.startsWith('document:')) return DOCUMENT_KIND_LABEL[field.slice('document:'.length) as DocumentKind]
  return FIELD_LABELS[field] ?? field
}

function feasibilitySummary(state: FeasibilityState | undefined, view: AdvisorView) {
  const feasibility = state ?? view.feasibility
  switch (feasibility.status) {
    case 'ready':
      return { status: 'ready', lokScore: feasibility.report.lokScore.total, grade: feasibility.report.lokScore.grade }
    case 'waiting':
      return { status: 'waiting_for_details', stillNeeded: feasibility.missing.map((m) => m.label) }
    case 'computing':
      return { status: 'computing' }
    default:
      return { status: feasibility.status, reason: feasibility.reason }
  }
}

const invalid = (state: AdvisorState, message: string): AdvisorToolResult => ({
  state,
  outcome: { ok: false, error: 'invalid_arguments', message },
})

/**
 * Executes one Gemini tool call against the advisor state. Pure: the caller
 * commits the returned state, so a tool's effect on the profile, ranking and
 * application form is exactly what the UI renders next.
 */
export function runAdvisorTool(
  state: AdvisorState,
  call: Pick<ToolCall, 'name' | 'args'>,
  context: AdvisorToolContext = {},
): AdvisorToolResult {
  const args = call.args ?? {}

  switch (call.name) {
    case 'recordCitizenDetail': {
      const detail = requireString(args, 'detail')
      if (!detail) return invalid(state, 'A non-empty `detail` string is required.')
      const { state: next, updatedFields } = ingestUtterance(state, detail)
      const view = deriveAdvisorView(next)
      // Live transcripts are ingested as they arrive, so a detail is often already on file when this call lands.
      const alreadyOnFile = recognisedFields(detail).filter((field) => !updatedFields.includes(field))
      const note =
        updatedFields.length > 0
          ? undefined
          : alreadyOnFile.length > 0
            ? 'These details were already on file from what the citizen said; they are saved.'
            : 'No detail was recognised in that, so nothing was saved. Do not claim it was.'
      return {
        state: next,
        outcome: {
          ok: true,
          data: {
            recorded: updatedFields.map(describeField),
            ...(alreadyOnFile.length > 0 ? { alreadyOnFile: alreadyOnFile.map(describeField) } : {}),
            ...(note ? { note } : {}),
            topMatch: topMatch(view),
            ...applicationChange(view, context),
            application: applicationSummary(view),
            ...(view.application ? {} : { nextToAsk: view.nextQuestion?.question ?? null }),
          },
        },
      }
    }

    case 'findSchemes': {
      const { state: next } = focusSearch(state, optionalString(args, 'focus'))
      const view = deriveAdvisorView(next)
      if (view.matches.length === 0) {
        return {
          state: next,
          outcome: {
            ok: true,
            data: {
              matches: [],
              note: 'Nothing is known about the citizen yet, so no scheme can be matched. Ask about them first.',
              nextToAsk: view.nextQuestion?.question ?? null,
            },
          },
        }
      }
      return {
        state: next,
        outcome: {
          ok: true,
          data: {
            matches: view.matches.slice(0, 5).map(summarize),
            applicationFor: view.application ? { schemeId: view.application.schemeId, name: view.application.schemeName } : null,
            ...applicationChange(view, context),
            sourceStatus: SOURCE_STATUS,
          },
        },
      }
    }

    case 'getSchemeDetails': {
      const schemeId = requireString(args, 'schemeId')
      if (!schemeId) return invalid(state, 'A non-empty `schemeId` string is required.')
      const view = deriveAdvisorView(state)
      const match = view.ranked.find((r) => r.scheme.id === schemeId)
      if (!match) {
        return {
          state,
          outcome: {
            ok: false,
            error: 'scheme_not_found',
            message: `No scheme with id "${schemeId}" is in the current results. Call findSchemes first and use an id it returned.`,
          },
        }
      }
      const { scheme, eligibility } = match
      const next = showSchemeDetails(state, scheme.id === view.application?.schemeId ? null : scheme.id)
      const detailView = deriveAdvisorView({ ...next, applicationSchemeId: scheme.id })
      return {
        state: next,
        outcome: {
          ok: true,
          data: {
            schemeId: scheme.id,
            name: scheme.name,
            description: scheme.description,
            ministry: scheme.ministry,
            eligibilityStatus: eligibility.status,
            matchPercent: match.rankScore,
            eligibilityRules: detailView.criteria?.criteria.map((c) => ({ rule: c.label, requirement: c.requirement, citizen: c.applicantValue, status: c.status })),
            loanAmount: scheme.loanAmount ?? null,
            subsidy: scheme.subsidy ?? null,
            interest: scheme.interest ?? null,
            documents: scheme.documents,
            applicationFormRequires: detailView.application?.fields.filter((f) => f.required).map((f) => f.label),
            thisSchemesForm: view.forms[scheme.id]
              ? {
                  percentFilled: view.forms[scheme.id].readiness.percent,
                  stillNeeded: view.forms[scheme.id].missing.map((item) => item.label),
                  note: 'Filled from the same answers as the application; shown when the citizen opens this scheme.',
                }
              : null,
            isTheApplicationScheme: scheme.id === view.application?.schemeId,
            note:
              scheme.id === view.application?.schemeId
                ? 'This is the scheme the application is being filled for.'
                : `The application stays on ${view.application?.schemeName ?? 'the top match'}. Use applyForScheme only if the citizen asks to apply for this one instead.`,
            lastVerifiedDate: scheme.lastVerifiedDate,
            sourceStatus: SOURCE_STATUS,
          },
        },
      }
    }

    case 'applyForScheme': {
      const schemeId = optionalString(args, 'schemeId') ?? null
      const view = deriveAdvisorView(state)
      if (schemeId && !view.ranked.some((r) => r.scheme.id === schemeId)) {
        return {
          state,
          outcome: { ok: false, error: 'scheme_not_found', message: `No scheme with id "${schemeId}" is in the current results. Call findSchemes first.` },
        }
      }
      const next = chooseApplicationScheme(state, schemeId)
      const nextView = deriveAdvisorView(next)
      return {
        state: next,
        outcome: {
          ok: true,
          data: {
            ...applicationChange(nextView, { lastReportedSchemeId: view.application?.schemeId ?? null }),
            application: applicationSummary(nextView),
            ...(nextView.applicationMatch && nextView.applicationMatch.status === 'likely_ineligible'
              ? { warning: 'The citizen does not meet at least one rule of this scheme. Say so plainly.', mismatchReasons: nextView.applicationMatch.mismatchReasons }
              : {}),
          },
        },
      }
    }

    case 'getCitizenProfile': {
      const view = deriveAdvisorView(state)
      return {
        state,
        outcome: {
          ok: true,
          data: {
            known: knownFacts(view),
            stillNeeded: view.application
              ? view.application.missing.map((item) => ({ item: item.label, question: item.question }))
              : view.missingFields.map((m) => ({ item: m.field, question: m.question })),
            nextToAsk: view.nextQuestion?.question ?? null,
          },
        },
      }
    }

    case 'getApplicationReadiness': {
      const view = deriveAdvisorView(state)
      const form = view.application
      return {
        state,
        outcome: {
          ok: true,
          data: {
            ...applicationChange(view, context),
            application: applicationSummary(view),
            missingFields: form?.missing.filter((item) => item.kind === 'field').map((item) => ({ field: item.label, question: item.question })) ?? [],
            missingDocuments: form?.missing.filter((item) => item.kind === 'document').map((item) => item.label) ?? [],
            blockingIssues: form?.readiness.blocking.filter((issue) => issue.code !== 'missing_field' && issue.code !== 'missing_document').map((issue) => issue.message) ?? [],
            feasibilityReport: feasibilitySummary(context.feasibility, view),
            howToSubmit: form?.readiness.canSubmit
              ? 'Everything required is complete. Ask the citizen to press "Review application" on screen, check the details, tick the consent box and submit.'
              : 'Not ready to submit yet: collect the missing items first.',
            sourceStatus: SOURCE_STATUS,
          },
        },
      }
    }

    default:
      return { state, outcome: { ok: false, error: 'unknown_tool', message: `There is no tool named "${call.name}".` } }
  }
}
