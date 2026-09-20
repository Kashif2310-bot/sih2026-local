import { describe, expect, it, vi } from 'vitest'
import { retryOnce, retryOnceIf } from './retry'

describe('retryOnce', () => {
  it('returns the first success without a second call', async () => {
    const fn = vi.fn().mockResolvedValue('ok')
    await expect(retryOnce(fn)).resolves.toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('retries once after a throw', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('fail')).mockResolvedValueOnce('ok')
    await expect(retryOnce(fn)).resolves.toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })
})

describe('retryOnceIf', () => {
  it('retries when the first result is a failure value', async () => {
    const fn = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ ok: true })
    await expect(retryOnceIf(fn, (v) => v == null)).resolves.toEqual({ ok: true })
    expect(fn).toHaveBeenCalledTimes(2)
  })
})
