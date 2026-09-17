/**
 * Typed backend errors — safe for UI mapping; never include secrets.
 */

export type BackendErrorCode =
  | 'NOT_CONFIGURED'
  | 'NOT_FOUND'
  | 'VALIDATION'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'CONFLICT'
  | 'UPSTREAM'
  | 'SERVICE_ROLE_IN_BROWSER'
  | 'INTERNAL'

export class BackendError extends Error {
  readonly code: BackendErrorCode
  readonly details?: Record<string, unknown>
  readonly cause?: unknown

  constructor(
    code: BackendErrorCode,
    message: string,
    opts?: { details?: Record<string, unknown>; cause?: unknown },
  ) {
    super(message)
    this.name = 'BackendError'
    this.code = code
    this.details = opts?.details
    this.cause = opts?.cause
  }
}

export function isBackendError(err: unknown): err is BackendError {
  return err instanceof BackendError
}

/** Map unknown/Supabase failures into BackendError without leaking secrets. */
export function toBackendError(err: unknown, fallback: BackendErrorCode = 'UPSTREAM'): BackendError {
  if (err instanceof BackendError) return err
  const message =
    err && typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string'
      ? (err as { message: string }).message
      : 'Upstream backend failure'
  const code =
    err && typeof err === 'object' && 'code' in err && (err as { code: unknown }).code === 'PGRST116'
      ? 'NOT_FOUND'
      : fallback
  return new BackendError(code, message, { cause: err })
}
