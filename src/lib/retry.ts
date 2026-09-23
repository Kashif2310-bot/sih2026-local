import { LIVE_RETRY_BACKOFF_MS } from './config'

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Run `fn` once; on throw, wait and run exactly once more. */
export async function retryOnce<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch {
    await wait(LIVE_RETRY_BACKOFF_MS)
    return fn()
  }
}

/** Run `fn` once; if `failed(result)`, wait and run exactly once more. */
export async function retryOnceIf<T>(fn: () => Promise<T>, failed: (value: T) => boolean): Promise<T> {
  const first = await fn()
  if (!failed(first)) return first
  await wait(LIVE_RETRY_BACKOFF_MS)
  return fn()
}
