/**
 * Local Ollama provider — talks to a locally running `ollama serve`
 * (http://localhost:11434), which never requires an API key. This is the
 * "local Llama" option: works fully offline from the internet's point of
 * view, no secret ever leaves the machine.
 */

import { AI_HEALTHCHECK_TIMEOUT_MS, AI_REQUEST_TIMEOUT_MS, OLLAMA_BASE_URL, OLLAMA_MODEL, shouldProbeLocalOllama } from '../aiConfig'
import { ASSISTANT_SYSTEM_PROMPT, buildUserTurn } from './promptBuilder'
import type { AIProvider, AIRequestContext, ProviderReply } from './types'

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: ctrl.signal })
  } finally {
    clearTimeout(t)
  }
}

export class OllamaProvider implements AIProvider {
  readonly id = 'ollama' as const
  private readonly baseUrl: string
  private readonly model: string

  constructor(baseUrl: string = OLLAMA_BASE_URL, model: string = OLLAMA_MODEL) {
    this.baseUrl = baseUrl
    this.model = model
  }

  async isAvailable(): Promise<boolean> {
    const pageHost = typeof window !== 'undefined' ? window.location.hostname : undefined
    if (!shouldProbeLocalOllama(pageHost, this.baseUrl)) return false
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/api/tags`, { method: 'GET' }, AI_HEALTHCHECK_TIMEOUT_MS)
      return res.ok
    } catch {
      return false
    }
  }

  async generateReply(context: AIRequestContext): Promise<ProviderReply> {
    const res = await fetchWithTimeout(
      `${this.baseUrl}/api/chat`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          stream: false,
          options: { temperature: 0.2 },
          messages: [
            { role: 'system', content: ASSISTANT_SYSTEM_PROMPT },
            { role: 'user', content: buildUserTurn(context) },
          ],
        }),
      },
      AI_REQUEST_TIMEOUT_MS,
    )
    if (!res.ok) throw new Error(`Ollama request failed with status ${res.status}`)

    const data: unknown = await res.json()
    const text =
      data && typeof data === 'object' && 'message' in data
        ? (data as { message?: { content?: unknown } }).message?.content
        : undefined
    if (typeof text !== 'string' || text.trim().length === 0) {
      throw new Error('Ollama returned an empty or malformed response')
    }
    return { text: text.trim(), usedProvider: this.id }
  }
}
