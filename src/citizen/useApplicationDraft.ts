import { useContext } from 'react'
import { ApplicationDraftCtx } from './draft-state'

export function useApplicationDraft() {
  const ctx = useContext(ApplicationDraftCtx)
  if (!ctx) throw new Error('useApplicationDraft outside provider')
  return ctx
}
