/**
 * Best-effort persistence of retrieval attempts into public.scheme_retrievals
 * (see supabase/migrations/202609170001_scheme_retrievals.sql). Fire-and-forget:
 * a logging failure must never affect retrieval or discovery results.
 */

import type { LokPulseSupabaseClient } from '../../supabase/client'
import { cacheKeyFor } from './cache'
import type { RetrievalAttemptLogEntry } from './types'

export function createSupabaseRetrievalAuditLogger(
  client: LokPulseSupabaseClient,
): (entry: RetrievalAttemptLogEntry) => void {
  return (entry: RetrievalAttemptLogEntry) => {
    void client
      .from('scheme_retrievals')
      .insert({
        source_adapter_id: entry.sourceAdapterId,
        pass_type: entry.pass,
        query_signature: cacheKeyFor({ pass: entry.pass }),
        ok: entry.ok,
        record_count: entry.recordCount,
        latency_ms: entry.latencyMs,
        error_message: entry.errorMessage ?? null,
        attempted_at: entry.at,
      })
      .then(
        () => {},
        () => {
          // Best-effort audit log — swallow failures (e.g. table not migrated yet, RLS, offline).
        },
      )
  }
}
