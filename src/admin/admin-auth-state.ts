import { createContext } from 'react'
import type { AdminSession } from './auth'

export interface AdminAuthState {
  session: AdminSession | null
  login: (identityId: string, password: string) => boolean
  logout: () => void
}

export const AdminAuthCtx = createContext<AdminAuthState | null>(null)
