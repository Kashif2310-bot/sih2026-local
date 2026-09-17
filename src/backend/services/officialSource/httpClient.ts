/**
 * Minimal fetch client for official source adapters: timeout + bounded retry
 * with backoff. No adapter should call fetch() directly — this is the one
 * place that owns "safe external retrieval" (Phase 11).
 */

export interface FetchJsonOptions {
  timeoutMs?: number
  retries?: number
  backoffMs?: number
  headers?: Record<string, string>
}

export interface FetchJsonResult {
  ok: boolean
  status: number | null
  data: unknown
  errorMessage?: string
  latencyMs: number
}

const DEFAULT_TIMEOUT_MS = 8_000
const DEFAULT_RETRIES = 2
const DEFAULT_BACKOFF_MS = 300

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function attemptOnce(url: string, timeoutMs: number, headers?: Record<string, string>): Promise<FetchJsonResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const start = Date.now()
  try {
    const res = await fetch(url, { signal: controller.signal, headers })
    const latencyMs = Date.now() - start
    if (!res.ok) {
      return { ok: false, status: res.status, data: null, errorMessage: `HTTP ${res.status}`, latencyMs }
    }
    const data = await res.json()
    return { ok: true, status: res.status, data, latencyMs }
  } catch (err) {
    const latencyMs = Date.now() - start
    const errorMessage = err instanceof Error ? err.message : 'Unknown fetch failure'
    return { ok: false, status: null, data: null, errorMessage, latencyMs }
  } finally {
    clearTimeout(timer)
  }
}

/** Never throws — callers branch on `ok`. Retries only transient (network/timeout) failures. */
export async function fetchJsonWithRetry(url: string, opts: FetchJsonOptions = {}): Promise<FetchJsonResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const retries = opts.retries ?? DEFAULT_RETRIES
  const backoffMs = opts.backoffMs ?? DEFAULT_BACKOFF_MS

  let last: FetchJsonResult = { ok: false, status: null, data: null, errorMessage: 'not attempted', latencyMs: 0 }
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    last = await attemptOnce(url, timeoutMs, opts.headers)
    if (last.ok) return last
    // Don't retry deterministic client errors (4xx) — only network/timeout/5xx.
    if (last.status !== null && last.status >= 400 && last.status < 500) return last
    if (attempt < retries) await sleep(backoffMs * 2 ** attempt)
  }
  return last
}
