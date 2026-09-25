import { createContext } from 'react'
import type { UserOut } from '../lib/api'
import type { StoredAuth } from '../lib/authSession'

export interface AuthState {
  user: UserOut | null
  token: string | null
  requestOtp: (phone: string) => Promise<string>
  verifyOtp: (phone: string, code: string) => Promise<StoredAuth>
  logout: () => void
}

export const AuthCtx = createContext<AuthState | null>(null)
