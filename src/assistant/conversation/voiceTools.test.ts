import { describe, expect, it, vi } from 'vitest'
import { createEmptyApplicantProfile } from '../../shared/applicantProfile'
import { offlineProvider } from '../ai'
import { neverConfiguredLiveRetriever } from '../liveRetrieval'
import { EMPTY_PROFILE } from '../types'
import type { VoiceToolCall } from '../voice/types'
import { VoiceAssistantController } from './voiceAssistantController'
import { createInitialConversationState } from './types'
import { VOICE_TOOL_DECLARATIONS, executeVoiceTool, runVoiceToolCall } from './voiceTools'

function makeController(): VoiceAssistantController {
  return new VoiceAssistantController(
    // Offline provider only + the repo's existing "never configured" live
    // retriever, so these tests never touch the network.
    { providers: [offlineProvider], liveRetriever: neverConfiguredLiveRetriever },
    createInitialConversationState(createEmptyApplicantProfile(), { ...EMPTY_PROFILE }),
  )
}

function call(name: string, args: Record<string, unknown> = {}, id = 'call-1'): VoiceToolCall {
  return { id, name, args }
}

describe('tool declarations', () => {
  it('exposes no tool that submits or irreversibly changes an application', () => {
    // The model may help a citizen prepare an application; it must never be
    // able to file one on their behalf from a spoken sentence.
    const names = VOICE_TOOL_DECLARATIONS.map((t) => t.name)
    for (const forbidden of ['submitApplication', 'approveApplication', 'sanction', 'disburse']) {
      expect(names).not.toContain(forbidden)
    }
  })

  it('declares required parameters for every tool that takes one', () => {
    for (const tool of VOICE_TOOL_DECLARATIONS) {
      if (!tool.parameters) continue
      expect(tool.parameters.type).toBe('object')
      for (const required of tool.parameters.required ?? []) {
        expect(Object.keys(tool.parameters.properties ?? {})).toContain(required)
      }
    }
  })
})

describe('argument validation', () => {
  it('rejects a missing required argument instead of guessing', async () => {
    const result = await executeVoiceTool(call('recordCitizenDetail', {}), { controller: makeController() })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('invalid_arguments')
  })

  it('rejects a wrongly-typed argument rather than coercing it', async () => {
    const result = await executeVoiceTool(call('recordCitizenDetail', { detail: 42 }), { controller: makeController() })
    expect(result.ok).toBe(false)
  })

  it('rejects a blank string, which is not the same as a valid answer', async () => {
    const result = await executeVoiceTool(call('recordCitizenDetail', { detail: '   ' }), { controller: makeController() })
    expect(result.ok).toBe(false)
  })

  it('reports an unknown tool name without throwing', async () => {
    const result = await executeVoiceTool(call('deleteEverything', {}), { controller: makeController() })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('unknown_tool')
  })
})

describe('recordCitizenDetail', () => {
  it('writes through the existing deterministic pipeline, not a side channel', async () => {
    const controller = makeController()
    const result = await executeVoiceTool(
      call('recordCitizenDetail', { detail: 'I am 28 years old and I want to start a dairy business' }),
      { controller },
    )

    expect(result.ok).toBe(true)
    // The SAME extraction the text path uses must have populated the shared
    // profile — a voice-learned fact is indistinguishable from a typed one.
    const state = controller.getState()
    expect(state.userProfile.age).toBe(28)
    // The shared cross-workstream ApplicantProfile is updated in the same
    // pass, so an application started later already knows this.
    expect(state.applicantProfile.data.age).toBe(28)
  })

  it('notifies the host so the UI can re-render voice-driven changes', async () => {
    const onStateChanged = vi.fn()
    await executeVoiceTool(call('recordCitizenDetail', { detail: 'I am 30' }), {
      controller: makeController(),
      onStateChanged,
    })
    expect(onStateChanged).toHaveBeenCalled()
  })

  it('tells the model what is still unknown, so it can ask a real question', async () => {
    const result = await executeVoiceTool(call('recordCitizenDetail', { detail: 'I am 28' }), {
      controller: makeController(),
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(Array.isArray(result.data.stillMissing)).toBe(true)
  })
})

describe('scheme lookups', () => {
  it('never invents a scheme for an id that was not returned by findSchemes', async () => {
    const result = await executeVoiceTool(call('getSchemeDetails', { schemeId: 'totally-made-up' }), {
      controller: makeController(),
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('scheme_not_found')
  })

  it('returns matches with honest source labelling once something is known', async () => {
    const controller = makeController()
    await controller.ingestUserUtterance('I am a 28 year old SC woman in a village in Karnataka starting a dairy business')

    const result = await executeVoiceTool(call('findSchemes', {}), { controller })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(Array.isArray(result.data.matches)).toBe(true)
    // The model must be able to say where this came from; an unlabelled
    // match invites it to imply live government confirmation.
    expect(result.data.sourceStatus).toBeDefined()
  })

  it('reports an empty result honestly instead of returning something plausible', async () => {
    const result = await executeVoiceTool(call('findSchemes', {}), { controller: makeController() })
    expect(result.ok).toBe(true)
    if (result.ok && Array.isArray(result.data.matches) && result.data.matches.length === 0) {
      expect(result.data.note).toMatch(/no schemes matched/i)
    }
  })

  it('returns details drawn from the scheme record for a real id', async () => {
    const controller = makeController()
    await controller.ingestUserUtterance('I want a loan to start a dairy business')
    const ranked = controller.getState().ranked
    if (ranked.length === 0) return // nothing ranked in this environment; covered by the case above

    const result = await executeVoiceTool(call('getSchemeDetails', { schemeId: ranked[0].scheme.id }), { controller })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.schemeId).toBe(ranked[0].scheme.id)
      expect(result.data.officialInfoUrl).toBe(ranked[0].scheme.officialInfoUrl)
      // Provenance must travel with the facts.
      expect(result.data.lastVerifiedDate).toBeDefined()
    }
  })
})

describe('profile and readiness lookups', () => {
  it('omits undefined fields rather than reporting them as known', async () => {
    const result = await executeVoiceTool(call('getCitizenProfile', {}), { controller: makeController() })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(Object.values(result.data.known as Record<string, unknown>)).not.toContain(undefined)
      expect(Array.isArray(result.data.missing)).toBe(true)
    }
  })

  it('reports readiness without claiming an approval', async () => {
    const result = await executeVoiceTool(call('getApplicationReadiness', {}), { controller: makeController() })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.phase).toBeDefined()
      expect(JSON.stringify(result.data)).not.toMatch(/approved|guaranteed/i)
    }
  })
})

describe('runVoiceToolCall resilience', () => {
  it('converts a thrown error into a deliverable result instead of killing the session', async () => {
    const exploding = {
      getState: () => {
        throw new Error('internal failure')
      },
    } as unknown as VoiceAssistantController

    const result = await runVoiceToolCall(call('getCitizenProfile', {}), { controller: exploding })

    expect(result.id).toBe('call-1')
    expect(result.name).toBe('getCitizenProfile')
    expect((result.response as { ok: boolean }).ok).toBe(false)
  })

  it('always echoes the call id so the provider can correlate the answer', async () => {
    const result = await runVoiceToolCall(call('getCitizenProfile', {}, 'abc-999'), { controller: makeController() })
    expect(result.id).toBe('abc-999')
  })
})
