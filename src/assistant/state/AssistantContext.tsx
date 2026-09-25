import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createEmptyApplicantProfile, type ApplicantProfile } from '../../shared/applicantProfile'
import type { ChatTurn } from '../ai/types'
import { assessReadiness } from '../conversation/readiness'
import { buildPersonalizedReport } from '../conversation/report'
import type { PersonalizedReport } from '../conversation/reportModel'
import { createInitialConversationState } from '../conversation/types'
import { VoiceAssistantController, type VoiceAssistantTurnResult } from '../conversation/voiceAssistantController'
import {
  VoiceConversationRuntime,
  type AssistantAudioState,
  type RuntimeEvent,
} from '../conversation/voiceConversationRuntime'
import type { SourceCoverageAccounting } from '../evidence/types'
import type { MissingFieldInfo } from '../missingFields'
import { createInitialProfile, defaultAssistantDeps, runAssistantTurn, type ActionPlanStep } from '../orchestrator'
import type { ContextualEvidenceItem, RankedScheme, UserProfile } from '../types'
import { geminiLiveVoiceSessionFactory } from '../voice'
import { BrowserAudioBridge, isBrowserVoiceAudioSupported } from '../voice/audio/browserAudioBridge'
import { VOICE_SYSTEM_INSTRUCTION } from '../voice/voiceSystemInstruction'
import { VOICE_TOOL_DECLARATIONS } from '../conversation/voiceTools'
import type { VoiceSessionFactory } from '../voice/types'
import { AssistantCtx, type AssistantState, type UIMessage } from './assistant-state'
import { mapVoiceTurnResult } from './voiceTurnMapping'
import { syncApplicantProfile } from '../../platform/remoteProfilePersistence'

export interface AssistantProviderProps {
  children: ReactNode
  initialProfile?: UserProfile
  caseBound?: boolean
  /**
   * Injection point for tests only — defaults to the real Gemini Live
   * factory. The typed-text pipeline never goes through a VoiceSession at
   * all (see runTurn below), so swapping this never affects text-chat
   * behavior; it only controls what `startVoice()` connects to.
   */
  voiceSessionFactory?: VoiceSessionFactory
}

export function AssistantProvider({
  children,
  initialProfile,
  caseBound = false,
  voiceSessionFactory = geminiLiveVoiceSessionFactory,
}: AssistantProviderProps) {
  const seed = () => initialProfile ?? createInitialProfile()
  const [profile, setProfile] = useState<UserProfile>(seed)
  const [applicantProfile, setApplicantProfile] = useState<ApplicantProfile>(() => createEmptyApplicantProfile())
  const [messages, setMessages] = useState<UIMessage[]>([])
  const [ranked, setRanked] = useState<RankedScheme[]>([])
  const [missingFields, setMissingFields] = useState<MissingFieldInfo[]>([])
  const [actionPlan, setActionPlan] = useState<ActionPlanStep[]>([])
  const [sourceStatus, setSourceStatus] = useState<AssistantState['sourceStatus']>(null)
  const [contextualEvidence, setContextualEvidence] = useState<ContextualEvidenceItem[]>([])
  const [evidenceCoverage, setEvidenceCoverage] = useState<SourceCoverageAccounting | null>(null)
  const [report, setReport] = useState<PersonalizedReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedSchemeId, setSelectedSchemeId] = useState<string | null>(null)
  const [hasStarted, setHasStarted] = useState(false)

  const [voiceAvailable, setVoiceAvailable] = useState(false)
  const [voiceAudioState, setVoiceAudioState] = useState<AssistantAudioState>('idle')
  const [voiceActive, setVoiceActive] = useState(false)
  const [voiceError, setVoiceError] = useState<string | null>(null)

  const pendingTextRef = useRef<string | null>(null)
  const idCounterRef = useRef(0)
  const genId = () => {
    idCounterRef.current += 1
    return `msg-${idCounterRef.current}`
  }

  /** Tracks the last emitted report so refreshes bump version without mutating history — same pattern VoiceAssistantController itself uses internally for its own report cursor. */
  const reportCursorRef = useRef<{ reportId: string; version: number } | null>(null)

  const voiceRuntimeRef = useRef<VoiceConversationRuntime | null>(null)
  const voiceUnsubscribeRef = useRef<(() => void) | null>(null)
  /** True while startVoice() is mid-flight. React StrictMode double-invokes effects and a user can double-click; without this, two sessions and two microphones are opened. */
  const voiceStartingRef = useRef(false)
  const voiceControllerUnsubscribeRef = useRef<(() => void) | null>(null)

  // Cheap, non-hanging support check (see VoiceSessionFactory.isSupported
  // contract) — with no Gemini relay configured (the default), this
  // resolves false and the UI must show an honest "voice not available"
  // state rather than ever faking a connection. Never re-checked mid
  // session; a real deployment's configuration doesn't change at runtime.
  useEffect(() => {
    let cancelled = false
    voiceSessionFactory
      .isSupported()
      .then((supported) => {
        if (!cancelled) setVoiceAvailable(supported)
      })
      .catch(() => {
        if (!cancelled) setVoiceAvailable(false)
      })
    return () => {
      cancelled = true
    }
  }, [voiceSessionFactory])

  useEffect(() => {
    return () => {
      // Unmount safety net — never leave a live session/socket behind.
      voiceUnsubscribeRef.current?.()
      voiceControllerUnsubscribeRef.current?.()
      void voiceRuntimeRef.current?.dispose()
    }
  }, [])

  // Every turn re-runs the full pipeline (extract -> retrieve -> eligibility
  // -> rank -> AI explanation) against the CURRENT profile — never a cached
  // result — so a profile change always produces fresh recommendations on
  // the very next message. See orchestrator.ts.
  const runTurn = useCallback(
    async (text: string, appendUserMessage: boolean) => {
      setLoading(true)
      setError(null)
      if (appendUserMessage) {
        setMessages((prev) => [...prev, { id: genId(), role: 'user', text, timestamp: Date.now() }])
        setHasStarted(true)
      }
      pendingTextRef.current = text
      try {
        const history: ChatTurn[] = messages.map((m) => ({ role: m.role, text: m.text }))
        const result = await runAssistantTurn(
          { message: text, profile, history, applicantProfile },
          defaultAssistantDeps(),
        )
        setProfile(result.profile)
        setApplicantProfile(result.applicantProfile)
        // Fire-and-forget, exactly like apply/store.ts's syncTrackedApplication:
        // never awaited, never blocks the UI, and a failure here cannot affect
        // the conversation, which already has everything it needs from the
        // state just set above. See remoteProfilePersistence.ts for why this
        // is a client-side RLS-enforced write, not a privileged endpoint.
        void syncApplicantProfile(result.applicantProfile)
        setRanked(result.ranked)
        setMissingFields(result.missingFields)
        setActionPlan(result.actionPlan)
        setSourceStatus(result.sourceStatus)
        setContextualEvidence(result.contextualEvidence)
        setEvidenceCoverage(result.evidenceCoverage)

        // Same deterministic evidence already computed above — never a
        // second analysis engine, just the existing report builder fed
        // from this turn's own outputs (mirrors VoiceAssistantController's
        // internal report-building step exactly).
        const readiness = assessReadiness({
          userProfile: result.profile,
          ranked: result.ranked,
          missingFields: result.missingFields,
        })
        const nextReport = buildPersonalizedReport({
          applicantProfile: result.applicantProfile,
          userProfile: result.profile,
          ranked: result.ranked,
          actionPlan: result.actionPlan,
          readiness,
          sourceStatus: result.sourceStatus,
          contextualEvidence: result.contextualEvidence,
          evidenceCoverage: result.evidenceCoverage,
          previous: reportCursorRef.current,
        })
        reportCursorRef.current = { reportId: nextReport.reportId, version: nextReport.version }
        setReport(nextReport)

        setMessages((prev) => [
          ...prev,
          {
            id: genId(),
            role: 'assistant',
            text: result.reply.text,
            timestamp: Date.now(),
            isFallback: result.reply.isFallback,
            providerUsed: result.reply.usedProvider,
            sourceStatus: result.sourceStatus,
          },
        ])
        pendingTextRef.current = null
      } catch (e) {
        setError(
          e instanceof Error
            ? e.message
            : 'The assistant could not respond right now. Please try again.',
        )
      } finally {
        setLoading(false)
      }
    },
    [messages, profile, applicantProfile],
  )

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (!trimmed) return
      // Text-input escape hatch while a voice session is active (see
      // VoiceSession.sendTextInput's own docs): goes through the SAME
      // session -> event -> controller pipeline a spoken turn would,
      // rather than a second, disconnected text path — so typing still
      // works exactly as documented even when a live mic transport isn't
      // available yet.
      if (voiceActive && voiceRuntimeRef.current) {
        voiceRuntimeRef.current.sendText(trimmed)
        return
      }
      if (loading) return
      await runTurn(trimmed, true)
    },
    [runTurn, loading, voiceActive],
  )

  const retryLast = useCallback(async () => {
    const text = pendingTextRef.current
    if (!text || loading) return
    await runTurn(text, false)
  }, [runTurn, loading])

  const selectScheme = useCallback((id: string | null) => setSelectedSchemeId(id), [])

  /**
   * Folds one completed VOICE turn into the exact same state text turns
   * write into — one assistant state model, never a second one. See
   * VoiceAssistantController/VoiceConversationRuntime for the engine that
   * produced this (question policy, readiness, evidence-invalidation
   * gating) — none of that is reimplemented here. The actual field mapping
   * is a pure function (voiceTurnMapping.ts) so it can be unit-tested
   * without a browser.
   */
  const mergeVoiceTurn = useCallback((result: VoiceAssistantTurnResult) => {
    const mapped = mapVoiceTurnResult(result, genId)
    setProfile(mapped.profile)
    setApplicantProfile(mapped.applicantProfile)
    void syncApplicantProfile(mapped.applicantProfile)
    setRanked(mapped.ranked)
    setMissingFields(mapped.missingFields)
    setActionPlan(mapped.actionPlan)
    setSourceStatus(mapped.sourceStatus)
    setContextualEvidence(mapped.contextualEvidence)
    setEvidenceCoverage(mapped.evidenceCoverage)
    reportCursorRef.current = { reportId: mapped.report.reportId, version: mapped.report.version }
    setReport(mapped.report)
    setMessages((prev) => [...prev, ...mapped.newMessages])
    setHasStarted(true)
  }, [])

  /**
   * Appends one native-audio transcript to the SAME message list typed
   * turns use. `fromVoice` marks the modality; nothing else differs,
   * because nothing else should — this is one conversation.
   */
  const appendVoiceTranscript = useCallback((role: 'user' | 'assistant', text: string) => {
    setMessages((prev) => [...prev, { id: genId(), role, text, timestamp: Date.now(), fromVoice: true }])
    setHasStarted(true)
  }, [])

  /**
   * Projects the controller's current ConversationState into the UI state.
   * Used on the native-audio path, where analysis advances through tool
   * calls and ingested utterances rather than through a single
   * turn_completed result. Reads the same fields mapVoiceTurnResult maps —
   * never a second analysis engine.
   */
  const syncFromController = useCallback((controller: VoiceAssistantController) => {
    const state = controller.getState()
    setProfile(state.userProfile)
    setApplicantProfile(state.applicantProfile)
    void syncApplicantProfile(state.applicantProfile)
    setRanked(state.ranked)
    setMissingFields(state.missingFields)
    setSourceStatus(state.sourceStatus)
  }, [])

  const startVoice = useCallback(async () => {
    if (voiceRuntimeRef.current || voiceStartingRef.current) return // already active or mid-start — idempotent under StrictMode
    voiceStartingRef.current = true
    setVoiceError(null)
    if (!voiceAvailable) {
      setVoiceError('Voice is not configured for this deployment — continue with text below.')
      voiceStartingRef.current = false
      return
    }
    try {
      const supported = await voiceSessionFactory.isSupported()
      if (!supported) {
        setVoiceError('Voice is not available right now — continue with text below.')
        return
      }
      const controller = new VoiceAssistantController({}, createInitialConversationState(applicantProfile, profile))

      // The controller already announces a rebuilt report every turn — reuse
      // that rather than recomputing one here, which would be a second
      // analysis engine drifting from the first.
      voiceControllerUnsubscribeRef.current = controller.subscribe((event) => {
        if (event.type === 'report_ready') {
          reportCursorRef.current = { reportId: event.report.reportId, version: event.report.version }
          setReport(event.report)
          setActionPlan(event.report.recommendedNextSteps)
          setContextualEvidence(event.report.governmentContextualEvidence ?? [])
        }
      })

      // Native-audio mode: Gemini generates and speaks its own reply, which
      // is the only way to get a real conversational voice experience (the
      // alternative — controller text spoken by a separate TTS — is the
      // transcribe/generate/synthesize pipeline this product explicitly is
      // not). The safety boundary moves from "we author every word" to "the
      // model has no facts of its own and must call a tool", which is what
      // VOICE_TOOL_DECLARATIONS and VOICE_SYSTEM_INSTRUCTION enforce.
      const audioSupported = isBrowserVoiceAudioSupported()
      const session = voiceSessionFactory.create({
        language: { primary: 'auto', allowCodeSwitching: true },
        applicantProfile,
        replySource: 'provider',
        audioInputMode: audioSupported ? 'continuous' : 'push_to_talk',
        tools: VOICE_TOOL_DECLARATIONS,
        systemInstruction: VOICE_SYSTEM_INSTRUCTION,
      })

      const audio = audioSupported
        ? new BrowserAudioBridge({
            onMicrophoneError: (error) => setVoiceError(error.message),
            onPlaybackError: (error) => setVoiceError(error.message),
          })
        : undefined

      const runtime = new VoiceConversationRuntime({
        session,
        controller,
        replyAuthority: 'provider',
        audio,
        toolDeps: { controller },
      })
      voiceUnsubscribeRef.current = runtime.subscribe((event: RuntimeEvent) => {
        switch (event.type) {
          case 'audio_state_changed':
            setVoiceAudioState(event.audioState)
            return
          case 'turn_completed':
            mergeVoiceTurn(event.result)
            return
          case 'transcript':
            // Native-audio turns produce transcripts rather than a
            // controller-authored reply. They join the SAME message list
            // typed turns use — one conversation, two modalities.
            appendVoiceTranscript(event.role, event.text)
            return
          case 'state_changed':
            // A tool wrote to conversation state (or an utterance was
            // ingested) — project it into the UI exactly as a text turn
            // would, so profile/schemes/report panels stay live.
            syncFromController(controller)
            return
          case 'error':
            setVoiceError(event.error.message)
            return
          case 'tool_call':
            return
          case 'closed':
            setVoiceActive(false)
            setVoiceAudioState('idle')
            return
        }
      })
      voiceRuntimeRef.current = runtime
      await runtime.start()
      setVoiceActive(true)
    } catch (e) {
      voiceUnsubscribeRef.current?.()
      voiceUnsubscribeRef.current = null
      voiceControllerUnsubscribeRef.current?.()
      voiceControllerUnsubscribeRef.current = null
      const failed = voiceRuntimeRef.current
      voiceRuntimeRef.current = null
      // A runtime that got as far as being constructed may already hold a
      // live microphone/socket even though start() threw — dispose it, or
      // the recording indicator stays lit after a failed start.
      if (failed) void failed.dispose()
      setVoiceError(e instanceof Error ? e.message : 'Voice could not start — continue with text below.')
    } finally {
      voiceStartingRef.current = false
    }
  }, [voiceAvailable, voiceSessionFactory, applicantProfile, profile, mergeVoiceTurn, appendVoiceTranscript, syncFromController])

  const stopVoice = useCallback(async () => {
    voiceStartingRef.current = false
    const runtime = voiceRuntimeRef.current
    voiceUnsubscribeRef.current?.()
    voiceUnsubscribeRef.current = null
    voiceControllerUnsubscribeRef.current?.()
    voiceControllerUnsubscribeRef.current = null
    voiceRuntimeRef.current = null
    if (runtime) await runtime.dispose()
    setVoiceActive(false)
    setVoiceAudioState('idle')
  }, [])

  const interruptVoice = useCallback(() => {
    voiceRuntimeRef.current?.interrupt()
  }, [])

  const reset = useCallback(() => {
    voiceStartingRef.current = false
    voiceUnsubscribeRef.current?.()
    voiceControllerUnsubscribeRef.current?.()
    void voiceRuntimeRef.current?.dispose()
    voiceUnsubscribeRef.current = null
    voiceControllerUnsubscribeRef.current = null
    voiceRuntimeRef.current = null

    setProfile(seed())
    setApplicantProfile(createEmptyApplicantProfile())
    setMessages([])
    setRanked([])
    setMissingFields([])
    setActionPlan([])
    setSourceStatus(null)
    setContextualEvidence([])
    setEvidenceCoverage(null)
    setReport(null)
    reportCursorRef.current = null
    setError(null)
    setSelectedSchemeId(null)
    setHasStarted(false)
    setVoiceActive(false)
    setVoiceAudioState('idle')
    setVoiceError(null)
    pendingTextRef.current = null
  }, [initialProfile])

  const value: AssistantState = {
    profile,
    applicantProfile,
    messages,
    ranked,
    missingFields,
    actionPlan,
    sourceStatus,
    contextualEvidence,
    evidenceCoverage,
    report,
    loading,
    error,
    selectedSchemeId,
    hasStarted,
    caseBound,
    sendMessage,
    retryLast,
    selectScheme,
    reset,
    voiceAvailable,
    voiceAudioState,
    voiceActive,
    voiceError,
    startVoice,
    stopVoice,
    interruptVoice,
  }

  return <AssistantCtx.Provider value={value}>{children}</AssistantCtx.Provider>
}
