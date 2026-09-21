import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import {
  requestOtp as apiRequestOtp,
  verifyOtp as apiVerifyOtp,
  type UserOut,
} from '../lib/api'
import { clearAuth, readAuth, writeAuth, type StoredAuth } from '../lib/authSession'

interface AuthState {
  user: UserOut | null
  token: string | null
  requestOtp: (phone: string) => Promise<string>
  verifyOtp: (phone: string, code: string) => Promise<StoredAuth>
  logout: () => void
}

const AuthCtx = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<StoredAuth | null>(() => readAuth())

  const requestOtp = useCallback(async (phone: string) => {
    const issued = await apiRequestOtp(phone)
    return issued.code
  }, [])

  const verifyOtp = useCallback(async (phone: string, code: string) => {
    const next = await apiVerifyOtp(phone, code)
    writeAuth(next)
    setSession(next)
    return next
  }, [])

  const logout = useCallback(() => {
    clearAuth()
    setSession(null)
  }, [])

  const value = useMemo<AuthState>(
    () => ({
      user: session?.user ?? null,
      token: session?.token ?? null,
      requestOtp,
      verifyOtp,
      logout,
    }),
    [session, requestOtp, verifyOtp, logout],
  )

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthCtx)
  if (!ctx) throw new Error('useAuth outside provider')
  return ctx
}
