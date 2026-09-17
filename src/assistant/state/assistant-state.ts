import { createContext } from 'react'
import type { ProviderId } from '../ai/types'
import type { MissingFieldInfo } from '../missingFields'
import type { ActionPlanStep } from '../orchestrator'
import type { RankedScheme, RetrievalSourceStatus, UserProfile } from '../types'

export interface UIMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  timestamp: number
  isFallback?: boolean
  providerUsed?: ProviderId
  /** What actually happened with live government-source retrieval on the turn that produced this message — drives the visible source-status line. Absent for user messages. */
  sourceStatus?: RetrievalSourceStatus
}

export interface AssistantState {
  profile: UserProfile
  messages: UIMessage[]
  ranked: RankedScheme[]
  missingFields: MissingFieldInfo[]
  actionPlan: ActionPlanStep[]
  loading: boolean
  error: string | null
  selectedSchemeId: string | null
  hasStarted: boolean
  sendMessage: (text: string) => Promise<void>
  retryLast: () => Promise<void>
  selectScheme: (id: string | null) => void
  reset: () => void
}

export const AssistantCtx = createContext<AssistantState | null>(null)
