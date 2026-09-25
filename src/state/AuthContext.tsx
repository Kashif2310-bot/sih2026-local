import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { requestOtp as apiRequestOtp, verifyOtp as apiVerifyOtp } from '../lib/api'
import { clearAuth, readAuth, writeAuth, type StoredAuth } from '../lib/authSession'
import { AuthCtx, type AuthState } from './auth-state'

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
