/** Typed client for the FastAPI persistence API. No finance math lives here. */

export const DEFAULT_API_URL = 'http://127.0.0.1:8000'

export function apiBaseUrl(): string {
  const raw = import.meta.env.VITE_API_URL
  if (typeof raw === 'string' && raw.trim()) return raw.replace(/\/$/, '')
  return DEFAULT_API_URL
}

export class ApiError extends Error {
  readonly status: number
  readonly detail: unknown

  constructor(status: number, message: string, detail?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
  }
}

export interface UserCreate {
  phone?: string | null
  name?: string | null
  preferred_language?: 'en' | 'kn' | 'hi'
}

export interface UserOut {
  id: string
  phone: string | null
  name: string | null
  preferred_language: string
  role: string
  created_at: string
}

export interface AssessmentCreate {
  user_id?: string | null
  location_label: string
  lat: number
  lng: number
  business_category: string
  margin_paise: number
  project_cost_paise: number
  loan_paise: number
  scheme: 'micro' | 'term'
  lokscore: number
  lokscore_grade: string
  data_status: 'complete' | 'incomplete'
  inputs_json: Record<string, unknown>
  outputs_json: Record<string, unknown>
  app_version: string
}

export interface AssessmentOut {
  id: string
  user_id: string | null
  location_label: string
  lat: number
  lng: number
  business_category: string
  margin_paise: number
  project_cost_paise: number
  loan_paise: number
  scheme: string
  lokscore: number
  lokscore_grade: string
  data_status: string
  inputs_json: Record<string, unknown>
  outputs_json: Record<string, unknown>
  app_version: string
  created_at: string
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${apiBaseUrl()}${path}`
  let res: Response
  try {
    res = await fetch(url, {
      ...init,
      signal: init?.signal ?? AbortSignal.timeout(8_000),
      headers: {
        Accept: 'application/json',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    })
  } catch {
    throw new ApiError(0, 'backend unreachable')
  }

  const body: unknown = await res.json().catch(() => null)
  if (!res.ok) {
    const detail =
      body && typeof body === 'object' && 'detail' in body
        ? (body as { detail: unknown }).detail
        : body
    const message =
      typeof detail === 'string' ? detail : `request failed (${res.status})`
    throw new ApiError(res.status, message, detail)
  }
  return body as T
}

export function createUser(payload: UserCreate): Promise<UserOut> {
  return request<UserOut>('/users', { method: 'POST', body: JSON.stringify(payload) })
}

export function getUser(id: string): Promise<UserOut> {
  return request<UserOut>(`/users/${encodeURIComponent(id)}`)
}

export function listUserAssessments(userId: string): Promise<AssessmentOut[]> {
  return request<AssessmentOut[]>(`/users/${encodeURIComponent(userId)}/assessments`)
}

export function createAssessment(payload: AssessmentCreate): Promise<AssessmentOut> {
  return request<AssessmentOut>('/assessments', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function getAssessment(id: string): Promise<AssessmentOut> {
  return request<AssessmentOut>(`/assessments/${encodeURIComponent(id)}`)
}
