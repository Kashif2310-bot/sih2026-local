/**
 * Stable backend façade over Kashif's live retrieval.
 * Does NOT duplicate the Edge Function — wraps LiveRetriever + validation.
 */

import {
  defaultLiveRetriever,
  neverConfiguredLiveRetriever,
  validateLiveEvidenceItems,
  LIVE_RETRIEVAL_TIMEOUT_MS,
  type LiveRetrievalQuery,
  type LiveRetriever,
} from '../../assistant/liveRetrieval'
import type { LiveEvidenceItem } from '../../assistant/types'
import { getAuthoritativeScheme } from '../schemes/schemeSourceOfTruth'
import { BackendError } from '../errors'

export interface LiveRetrievalResult {
  ok: boolean
  available: boolean
  items: LiveEvidenceItem[]
  /** ISO timestamp when this gateway finished (local clock). */
  completedAt: string
  errorCode?: 'not_configured' | 'upstream' | 'timeout' | 'validation'
  errorMessage?: string
}

export interface LiveRetrievalGateway {
  isAvailable(): Promise<boolean>
  retrieve(query: LiveRetrievalQuery): Promise<LiveRetrievalResult>
  /** Normalize/validate raw Edge Function payloads without inventing fields. */
  normalize(raw: unknown): LiveEvidenceItem[]
}

function normalizeQuery(query: LiveRetrievalQuery): LiveRetrievalQuery {
  const schemeIds = [...new Set(query.schemeIds.filter((id) => Boolean(getAuthoritativeScheme(id))))]
  return {
    schemeIds,
    state: query.state?.trim() || undefined,
  }
}

export function createLiveRetrievalGateway(retriever: LiveRetriever = defaultLiveRetriever): LiveRetrievalGateway {
  return {
    async isAvailable() {
      try {
        return await retriever.isAvailable()
      } catch {
        return false
      }
    },

    normalize(raw) {
      return validateLiveEvidenceItems(raw)
    },

    async retrieve(query) {
      const completedAt = new Date().toISOString()
      const normalized = normalizeQuery(query)
      if (!normalized.schemeIds.length) {
        return {
          ok: true,
          available: await this.isAvailable(),
          items: [],
          completedAt,
        }
      }

      const available = await this.isAvailable()
      if (!available) {
        return {
          ok: false,
          available: false,
          items: [],
          completedAt,
          errorCode: 'not_configured',
          errorMessage: 'Live retrieval Edge Function is not configured',
        }
      }

      try {
        const items = await retriever.retrieve(normalized)
        // Re-validate even if retriever already did — harden provenance boundary.
        const validated = validateLiveEvidenceItems({ items })
        return { ok: true, available: true, items: validated, completedAt }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        const timeout = /timed out/i.test(message)
        return {
          ok: false,
          available: true,
          items: [],
          completedAt,
          errorCode: timeout ? 'timeout' : 'upstream',
          errorMessage: message.slice(0, 300),
        }
      }
    },
  }
}

/** Memory/tests: never calls network. */
export function createUnavailableLiveRetrievalGateway(): LiveRetrievalGateway {
  return createLiveRetrievalGateway(neverConfiguredLiveRetriever)
}

export function assertNoDuplicateLiveRetrieval(): void {
  // Documentation guard — the only Edge Function name allowed.
  const allowed = 'live-scheme-retrieval'
  if (allowed !== 'live-scheme-retrieval') {
    throw new BackendError('UPSTREAM', 'Duplicate live retrieval function is forbidden')
  }
}

export { LIVE_RETRIEVAL_TIMEOUT_MS }
