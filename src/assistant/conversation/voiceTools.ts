/**
 * The tools the voice provider is allowed to call, and the validated
 * execution path behind them.
 *
 * This is what makes native-audio voice safe. In the native path Gemini
 * speaks its own words, so it could in principle say anything — the
 * safeguard is not a prompt, it is that Gemini has no scheme knowledge to
 * draw on and must ask this module for every fact. Each tool answers from
 * the SAME deterministic pipeline the text assistant uses
 * (retrieval -> eligibility -> ranking -> report), never from anything new:
 *
 *   Gemini --toolCall--> VoiceConversationRuntime --> executeVoiceTool
 *                                                       |
 *                              VoiceAssistantController (existing pipeline)
 *                                                       |
 *   Gemini <--toolResponse-- structured, source-labelled result
 *
 * RULES THIS FILE ENFORCES:
 *   - Every argument is validated before use. Model output is untrusted
 *     input; a wrong type or an unknown enum value is rejected, never
 *     coerced into something that "looks close enough".
 *   - No tool mutates application state directly. The only writer is
 *     VoiceAssistantController.ingestUserUtterance, which runs the same
 *     extraction the text path runs, so a fact learned by voice is stored
 *     identically to one typed in.
 *   - No tool performs an irreversible action. Submitting an application is
 *     deliberately NOT exposed — see the note on the tool list below.
 *   - A failing tool returns a structured error to the model rather than
 *     throwing, so one bad call cannot take the session down.
 */

import type { VoiceToolCall, VoiceToolDeclaration, VoiceToolResult } from '../voice/types'
import type { VoiceAssistantController } from './voiceAssistantController'
import type { RankedScheme } from '../types'

/**
 * The declarations sent to the provider at setup. Descriptions are written
 * for the MODEL, not for a developer: they state when to call the tool,
 * because a vague description is the most common cause of a model answering
 * from its own imagination instead of asking.
 */
export const VOICE_TOOL_DECLARATIONS: VoiceToolDeclaration[] = [
  {
    name: 'recordCitizenDetail',
    description:
      'Record something the citizen just told you about themselves or their business (age, location, social category, income, the business they want to start, how much money they need, and so on). Call this whenever they share a personal or business detail, before you respond. Pass their own words.',
    parameters: {
      type: 'object',
      properties: {
        detail: {
          type: 'string',
          description: "What the citizen said about themselves, in their own words. For example: 'I am 28, from a village near Mysore, and I want to start a dairy business'.",
        },
      },
      required: ['detail'],
    },
  },
  {
    name: 'findSchemes',
    description:
      'Find government schemes that match what is currently known about the citizen. Call this before naming or describing ANY scheme — you do not know which schemes exist or who qualifies, and must not guess. Returns ranked matches with their eligibility status.',
    parameters: {
      type: 'object',
      properties: {
        focus: {
          type: 'string',
          description: "Optional topic to steer the search, such as 'dairy', 'loan', or 'tailoring'. Leave empty to use everything already known about the citizen.",
        },
      },
    },
  },
  {
    name: 'getSchemeDetails',
    description:
      'Get the full details of one scheme returned by findSchemes: what it offers, who is eligible, the documents needed, and why it did or did not match this citizen. Call this before describing a scheme in any detail.',
    parameters: {
      type: 'object',
      properties: {
        schemeId: { type: 'string', description: 'The schemeId exactly as returned by findSchemes.' },
      },
      required: ['schemeId'],
    },
  },
  {
    name: 'getCitizenProfile',
    description:
      'Look up what is already known about this citizen, and what is still missing. Call this when you need to know whether you already have a fact before asking for it again, or to decide what to ask next.',
  },
  {
    name: 'getApplicationReadiness',
    description:
      'Check how ready this citizen is to apply: what has been established, what is still missing, and the recommended next steps. Call this when the citizen asks what happens next, whether they can apply, or how far along they are.',
  },
]

/** Structured result envelope. `ok: false` is a normal outcome the model is expected to speak about honestly, not an exception. */
export type VoiceToolOutcome =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: string; message: string }

export interface VoiceToolDeps {
  controller: VoiceAssistantController
  /** Called after a tool changes conversation state, so the UI reflects a voice-driven update the same way it reflects a typed one. */
  onStateChanged?: () => void
}

function invalidArgs(message: string): VoiceToolOutcome {
  return { ok: false, error: 'invalid_arguments', message }
}

/** Reads a required string argument. Rejects wrong types and blank strings rather than silently treating them as absent. */
function requireString(args: Record<string, unknown>, key: string): string | null {
  const value = args[key]
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key]
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/** Trimmed projection of a ranked scheme — the model gets what it needs to speak accurately, not the entire internal object. */
function summarizeScheme(ranked: RankedScheme) {
  return {
    schemeId: ranked.scheme.id,
    name: ranked.scheme.name,
    eligibilityStatus: ranked.eligibility.status,
    matchScore: ranked.rankScore,
    reasons: ranked.eligibility.reasons.slice(0, 4),
  }
}

export async function executeVoiceTool(call: VoiceToolCall, deps: VoiceToolDeps): Promise<VoiceToolOutcome> {
  const { controller } = deps
  const args = call.args ?? {}

  switch (call.name) {
    case 'recordCitizenDetail': {
      const detail = requireString(args, 'detail')
      if (!detail) return invalidArgs('A non-empty `detail` string is required.')
      // The ONLY write path. Runs the same extraction, evidence and ranking
      // steps a typed message runs — a fact learned by voice is stored
      // exactly like a fact that was typed.
      const result = await controller.ingestUserUtterance(detail, call.id)
      deps.onStateChanged?.()
      const known = result.state.userProfile
      return {
        ok: true,
        data: {
          recorded: true,
          // Reporting what is still missing lets the model choose its next
          // question from real gaps instead of guessing at one.
          stillMissing: result.state.missingFields.slice(0, 3).map((m) => m.field),
          knownFields: Object.keys(known).filter((k) => k !== 'rawNotes' && known[k as keyof typeof known] !== undefined),
        },
      }
    }

    case 'findSchemes': {
      const focus = optionalString(args, 'focus')
      // With a focus term, route through the same ingest path a typed query
      // takes, so ranking and live evidence reflect what was just asked.
      // Without one, read the state as it stands — re-running the pipeline
      // on nothing would refetch evidence for no new information.
      let state = controller.getState()
      if (focus) {
        state = (await controller.ingestUserUtterance(focus, call.id)).state
        deps.onStateChanged?.()
      }
      const ranked = state.ranked
      if (ranked.length === 0) {
        return {
          ok: true,
          data: {
            matches: [],
            note: 'No schemes matched what is currently known. More detail about the citizen is needed before schemes can be suggested.',
            stillMissing: state.missingFields.slice(0, 3).map((m) => m.field),
          },
        }
      }
      return {
        ok: true,
        data: {
          matches: ranked.slice(0, 5).map(summarizeScheme),
          // Honest provenance — the model must not present curated
          // reference data as live government confirmation.
          sourceStatus: state.sourceStatus ?? 'local_reference_data_only',
        },
      }
    }

    case 'getSchemeDetails': {
      const schemeId = requireString(args, 'schemeId')
      if (!schemeId) return invalidArgs('A non-empty `schemeId` string is required.')
      const match = controller.getState().ranked.find((r) => r.scheme.id === schemeId)
      if (!match) {
        return {
          ok: false,
          error: 'scheme_not_found',
          message: `No scheme with id "${schemeId}" is in the current results. Call findSchemes first and use an id it returned.`,
        }
      }
      const scheme = match.scheme
      return {
        ok: true,
        data: {
          schemeId: scheme.id,
          name: scheme.name,
          description: scheme.description,
          ministry: scheme.ministry,
          eligibilityStatus: match.eligibility.status,
          reasons: match.eligibility.reasons,
          mismatchReasons: match.eligibility.mismatchReasons,
          missingInfo: match.eligibility.missingInfo,
          loanAmount: scheme.loanAmount ?? null,
          subsidy: scheme.subsidy ?? null,
          interest: scheme.interest ?? null,
          documents: scheme.documents,
          applicationSteps: scheme.applicationSteps,
          officialApplicationUrl: scheme.officialApplicationUrl,
          officialInfoUrl: scheme.officialInfoUrl,
          // Curated reference data, re-verified on this date — the model is
          // told so it can say so, instead of implying live confirmation.
          confidence: scheme.confidence,
          lastVerifiedDate: scheme.lastVerifiedDate,
        },
      }
    }

    case 'getCitizenProfile': {
      const state = controller.getState()
      const profile = state.userProfile
      const known: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(profile)) {
        if (key === 'rawNotes' || value === undefined) continue
        known[key] = value
      }
      return {
        ok: true,
        data: {
          known,
          missing: state.missingFields.map((m) => ({ field: m.field, question: m.question })),
          phase: state.phase,
        },
      }
    }

    case 'getApplicationReadiness': {
      const state = controller.getState()
      return {
        ok: true,
        data: {
          phase: state.phase,
          missing: state.missingFields.slice(0, 5).map((m) => m.field),
          topMatches: state.ranked.slice(0, 3).map(summarizeScheme),
          sourceStatus: state.sourceStatus ?? 'local_reference_data_only',
        },
      }
    }

    default:
      return {
        ok: false,
        error: 'unknown_tool',
        message: `There is no tool named "${call.name}".`,
      }
  }
}

/**
 * Runs one call and always produces a deliverable result — a thrown error
 * becomes a structured `execution_failed` response rather than propagating
 * into the session's event handling and killing the conversation.
 */
export async function runVoiceToolCall(call: VoiceToolCall, deps: VoiceToolDeps): Promise<VoiceToolResult> {
  let outcome: VoiceToolOutcome
  try {
    outcome = await executeVoiceTool(call, deps)
  } catch (cause) {
    outcome = {
      ok: false,
      error: 'execution_failed',
      // The model speaks this aloud, so it must be a sentence a citizen can
      // hear — never a stack trace or an internal identifier.
      message: cause instanceof Error ? cause.message : 'That lookup could not be completed.',
    }
  }
  return { id: call.id, name: call.name, response: outcome as unknown as Record<string, unknown> }
}
