import { useContext } from 'react'
import { AdminAuthCtx } from './admin-auth-state'

export function useAdminAuth() {
  const ctx = useContext(AdminAuthCtx)
  if (!ctx) throw new Error('useAdminAuth outside provider')
  return ctx
}
