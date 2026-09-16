const SESSION_KEY = 'lokpulse:admin:session'

export interface AdminIdentity {
  id: string
  name: string
  nameKn: string
}

/** Demo identities only — not real government accounts. */
export const ADMIN_IDENTITIES: AdminIdentity[] = [
  {
    id: 'admin-sca',
    name: 'Priya Hegde (SCA District Officer)',
    nameKn: 'ಪ್ರಿಯಾ ಹೆಗಡೆ (ಎಸ್‌ಸಿಎ ಜಿಲ್ಲಾ ಅಧಿಕಾರಿ)',
  },
  {
    id: 'admin-bank',
    name: 'Ramesh Naik (Bank Channel Partner)',
    nameKn: 'ರಮೇಶ್ ನಾಯ್ಕ್ (ಬ್ಯಾಂಕ್ ಚಾನೆಲ್ ಪಾರ್ಟನರ್)',
  },
  {
    id: 'admin-nsfdc',
    name: 'Suresh Patil (NSFDC State Nodal)',
    nameKn: 'ಸುರೇಶ್ ಪಾಟೀಲ್ (ಎನ್‌ಎಸ್‌ಎಫ್‌ಡಿಸಿ ರಾಜ್ಯ ನೋಡಲ್)',
  },
]

export interface AdminSession {
  identityId: string
  name: string
  loggedInAt: number
}

export function readAdminSession(): AdminSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    if (!raw) return null
    return JSON.parse(raw) as AdminSession
  } catch {
    return null
  }
}

export function writeAdminSession(session: AdminSession) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
  } catch {
    // sessionStorage blocked — login will not survive refresh
  }
}

export function clearAdminSession() {
  try {
    sessionStorage.removeItem(SESSION_KEY)
  } catch {
    // ignore
  }
}
