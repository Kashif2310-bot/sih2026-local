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

function isPostgrestLikeError(err: unknown): err is { code: string; message?: string } {
  return (
    Boolean(err) &&
    typeof err === 'object' &&
    'code' in (err as object) &&
    typeof (err as { code: unknown }).code === 'string'
  )
}

const SAFE_UPSTREAM_MESSAGE = 'Upstream data store error.'
const SAFE_CONFLICT_MESSAGE = 'The request conflicts with existing data.'

/**
 * Map unknown/Supabase failures into BackendError without leaking secrets
 * or internal schema details (table/column/constraint names, SQL text) to
 * whatever eventually renders `.message`. Raw upstream detail is preserved
 * only in the non-public `cause` for server-side logs.
 */
export function toBackendError(err: unknown, fallback: BackendErrorCode = 'UPSTREAM'): BackendError {
  if (err instanceof BackendError) return err

  if (isPostgrestLikeError(err)) {
    if (err.code === 'PGRST116') {
      return new BackendError('NOT_FOUND', 'Resource not found.', { cause: err })
    }
    // Postgres SQLSTATE class 23 = integrity constraint violation (unique/fk/check/not-null).
    // These are safe to distinguish as CONFLICT, but the raw text often names columns/constraints — don't pass it through.
    if (/^23/.test(err.code)) {
      return new BackendError('CONFLICT', SAFE_CONFLICT_MESSAGE, { cause: err })
    }
    // Any other Postgres/PostgREST-shaped error: never surface raw upstream text.
    return new BackendError(fallback, SAFE_UPSTREAM_MESSAGE, { cause: err })
  }

  // Not a Postgrest-shaped error — most commonly a plain Error thrown by our
  // own code (e.g. `new Error('Application not found: ...')`), whose message
  // we already control and is safe to surface as-is.
  const message =
    err && typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string'
      ? (err as { message: string }).message
      : 'Upstream backend failure'
  return new BackendError(fallback, message, { cause: err })
}
