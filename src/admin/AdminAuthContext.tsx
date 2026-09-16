import { useCallback, useMemo, useState, type ReactNode } from 'react'
import {
  ADMIN_IDENTITIES,
  clearAdminSession,
  readAdminSession,
  writeAdminSession,
  type AdminSession,
} from './auth'
import { AdminAuthCtx } from './admin-auth-state'

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AdminSession | null>(() => readAdminSession())

  const login = useCallback((identityId: string, password: string) => {
    if (!identityId || !password.trim()) return false
    const identity = ADMIN_IDENTITIES.find((i) => i.id === identityId)
    if (!identity) return false
    const next: AdminSession = {
      identityId: identity.id,
      name: identity.name,
      loggedInAt: Date.now(),
    }
    writeAdminSession(next)
    setSession(next)
    return true
  }, [])

  const logout = useCallback(() => {
    clearAdminSession()
    setSession(null)
  }, [])

  const value = useMemo(() => ({ session, login, logout }), [session, login, logout])

  return <AdminAuthCtx.Provider value={value}>{children}</AdminAuthCtx.Provider>
}
