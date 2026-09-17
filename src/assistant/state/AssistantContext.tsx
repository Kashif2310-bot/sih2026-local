import { useCallback, useRef, useState, type ReactNode } from 'react'
import type { ChatTurn } from '../ai/types'
import type { MissingFieldInfo } from '../missingFields'
import { createInitialProfile, defaultAssistantDeps, runAssistantTurn, type ActionPlanStep } from '../orchestrator'
import type { RankedScheme, UserProfile } from '../types'
import { AssistantCtx, type AssistantState, type UIMessage } from './assistant-state'

export function AssistantProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<UserProfile>(() => createInitialProfile())
  const [messages, setMessages] = useState<UIMessage[]>([])
  const [ranked, setRanked] = useState<RankedScheme[]>([])
  const [missingFields, setMissingFields] = useState<MissingFieldInfo[]>([])
  const [actionPlan, setActionPlan] = useState<ActionPlanStep[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedSchemeId, setSelectedSchemeId] = useState<string | null>(null)
  const [hasStarted, setHasStarted] = useState(false)

  const pendingTextRef = useRef<string | null>(null)
  const idCounterRef = useRef(0)
  const genId = () => {
    idCounterRef.current += 1
    return `msg-${idCounterRef.current}`
  }

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
        const result = await runAssistantTurn({ message: text, profile, history }, defaultAssistantDeps())
        setProfile(result.profile)
        setRanked(result.ranked)
        setMissingFields(result.missingFields)
        setActionPlan(result.actionPlan)
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
    [messages, profile],
  )

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (!trimmed || loading) return
      await runTurn(trimmed, true)
    },
    [runTurn, loading],
  )

  const retryLast = useCallback(async () => {
    const text = pendingTextRef.current
    if (!text || loading) return
    await runTurn(text, false)
  }, [runTurn, loading])

  const selectScheme = useCallback((id: string | null) => setSelectedSchemeId(id), [])

  const reset = useCallback(() => {
    setProfile(createInitialProfile())
    setMessages([])
    setRanked([])
    setMissingFields([])
    setActionPlan([])
    setError(null)
    setSelectedSchemeId(null)
    setHasStarted(false)
    pendingTextRef.current = null
  }, [])

  const value: AssistantState = {
    profile,
    messages,
    ranked,
    missingFields,
    actionPlan,
    loading,
    error,
    selectedSchemeId,
    hasStarted,
    sendMessage,
    retryLast,
    selectScheme,
    reset,
  }

  return <AssistantCtx.Provider value={value}>{children}</AssistantCtx.Provider>
}
