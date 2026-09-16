import { createContext } from 'react'
import type { RankedScheme } from '../assistant/types'
import type { Application, DocumentRecord } from '../platform/types'
import type { ExtraApplicantInfo } from './draft-types'

export interface DraftState {
  transcript: string
  extra: ExtraApplicantInfo
  documents: DocumentRecord[]
  consentGiven: boolean
  consentAt: number | null
  consentName: string
  submittedId: string | null
  rankedSchemes: RankedScheme[]
  setTranscript: (t: string) => void
  updateExtra: (patch: Partial<ExtraApplicantInfo>) => void
  ensureDocuments: () => void
  updateDocument: (id: string, patch: Partial<DocumentRecord>) => void
  setConsent: (given: boolean, name: string) => void
  setRankedSchemes: (ranked: RankedScheme[]) => void
  submit: () => Application | null
  reset: () => void
}

export const ApplicationDraftCtx = createContext<DraftState | null>(null)
