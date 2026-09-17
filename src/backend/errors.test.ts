import { describe, expect, it } from 'vitest'
import { BackendError, isBackendError, toBackendError } from './errors'

describe('toBackendError', () => {
  it('passes through an existing BackendError unchanged', () => {
    const original = new BackendError('VALIDATION', 'bad input')
    expect(toBackendError(original)).toBe(original)
  })

  it('maps PGRST116 to a safe NOT_FOUND without leaking the raw message', () => {
    const upstream = { code: 'PGRST116', message: 'Results contain 0 rows, table public.applicants column ssn' }
    const mapped = toBackendError(upstream)
    expect(mapped.code).toBe('NOT_FOUND')
    expect(mapped.message).not.toContain('ssn')
    expect(mapped.message).not.toContain('applicants')
  })

  it('maps Postgres integrity-violation SQLSTATEs (23xxx) to a safe CONFLICT', () => {
    const upstream = {
      code: '23505',
      message: 'duplicate key value violates unique constraint "applications_secret_internal_key"',
    }
    const mapped = toBackendError(upstream)
    expect(mapped.code).toBe('CONFLICT')
    expect(mapped.message).not.toContain('secret_internal')
  })

  it('never surfaces raw text for other Postgrest-shaped errors', () => {
    const upstream = { code: '42501', message: 'permission denied for table internal_admin_secrets' }
    const mapped = toBackendError(upstream)
    expect(mapped.message).not.toContain('internal_admin_secrets')
    expect(mapped.code).toBe('UPSTREAM')
  })

  it('keeps the raw upstream error in cause for server-side logs', () => {
    const upstream = { code: '42501', message: 'permission denied for table internal_admin_secrets' }
    const mapped = toBackendError(upstream)
    expect(mapped.cause).toBe(upstream)
  })

  it('still surfaces our own plain-Error messages, which we already control', () => {
    const mapped = toBackendError(new Error('Application not found: abc-123'))
    expect(mapped.message).toBe('Application not found: abc-123')
  })

  it('respects a custom fallback code for non-Postgrest errors', () => {
    const mapped = toBackendError(new Error('boom'), 'INTERNAL')
    expect(mapped.code).toBe('INTERNAL')
  })

  it('isBackendError narrows correctly', () => {
    expect(isBackendError(new BackendError('INTERNAL', 'x'))).toBe(true)
    expect(isBackendError(new Error('x'))).toBe(false)
  })
})
