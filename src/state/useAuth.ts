import { useContext } from 'react'
import { AuthCtx } from './auth-state'

export function useAuth() {
  const ctx = useContext(AuthCtx)
  if (!ctx) throw new Error('useAuth outside provider')
  return ctx
}
