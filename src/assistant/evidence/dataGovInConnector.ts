/**
 * GovernmentSourceConnector implementation for data.gov.in (Prompt 8).
 *
 * Deliberately a thin adapter around the EXISTING, tested LiveRetriever
 * (../liveRetrieval.ts / the Supabase Edge Function) rather than a second
 * network path: the browser must still never call a government API
 * directly or hold its key (see liveRetrieval.ts's header comment), and
 * that contract/timeout/trust-domain validation is already implemented and
 * tested there. This connector's only job is to NORMALIZE that retriever's
 * output into the connector-framework shape — it adds no new network
 * behavior.
 *
 * HONESTY NOTE: the REAL data.gov.in Edge Function only ever returns
 * generic statistical/performance summaries (see its header comment) with
 * no explicit scheme identifier or canonical application URL — so in
 * production, every record this connector normalizes will have
 * `explicitSchemeId` and `officialApplicationUrl` left undefined, and
 * schemeBinding.ts will always classify this connector's live evidence as
 * live_contextual, never live_official, until the underlying source
 * actually starts supplying one of those two fields. This connector still
 * passes either field through when the underlying LiveRetriever's item DOES
 * carry one (rather than hard-coding it away) — that's what makes correct
 * binding testable with a fake retriever, and what lets this same connector
 * code keep working unmodified if the Edge Function is later enriched.
 */

import type { LiveRetriever } from '../liveRetrieval'
import type {
  ConnectorQuery,
  GovernmentSourceConnector,
  GovernmentSourceDescriptor,
  NormalizedGovernmentRecord,
} from './types'

export const DATA_GOV_IN_DESCRIPTOR: GovernmentSourceDescriptor = {
  id: 'data-gov-in',
  name: 'data.gov.in (Open Government Data Platform)',
  sourceType: 'open_data_api',
  officialDomain: 'api.data.gov.in',
  scope: 'central',
}

function stableRecordId(sourceUrl: string, summary: string, schemeId: string): string {
  // No per-record id is available from the underlying retriever (the Edge
  // Function discards the raw record after summarizing it), so a
  // deterministic composite stands in — same inputs always produce the same
  // id, which is what deduplication/change-detection actually need.
  return `${sourceUrl}::${schemeId}::${summary}`
}

export class DataGovInConnector implements GovernmentSourceConnector {
  readonly descriptor = DATA_GOV_IN_DESCRIPTOR
  private readonly retriever: LiveRetriever

  constructor(retriever: LiveRetriever) {
    this.retriever = retriever
  }

  isAvailable(): Promise<boolean> {
    return this.retriever.isAvailable()
  }

  async fetchNormalized(query: ConnectorQuery): Promise<NormalizedGovernmentRecord[]> {
    const items = await this.retriever.retrieve({ schemeIds: query.schemeIds, state: query.state })

    // One normalized record per UNIQUE (sourceUrl, summary, explicit binding)
    // combination — the retriever's legacy shape multiplies one record
    // across every requested scheme id, which is exactly the binding bug
    // Prompt 8 Step 4 fixes. Collapsing back to one record here means
    // downstream binding sees the record once, on its own merits, not once
    // per request.
    const seen = new Map<string, NormalizedGovernmentRecord>()
    for (const item of items) {
      const key = `${item.sourceUrl}::${item.summary}::${item.explicitSchemeId ?? ''}::${item.officialApplicationUrl ?? ''}`
      if (seen.has(key)) continue
      seen.set(key, {
        sourceRecordId: item.sourceRecordId ?? stableRecordId(item.sourceUrl, item.summary, 'shared'),
        sourceId: this.descriptor.id,
        sourceName: item.sourceName,
        sourceType: this.descriptor.sourceType,
        sourceUrl: item.sourceUrl,
        // Passed through ONLY if the retriever's item actually carries one —
        // never derived from item.schemeId, which just records "which
        // scheme this was requested for", not anything the source itself
        // declared. Today's real data.gov.in Edge Function never sets
        // either field (see header comment), so this is a no-op in
        // production until a richer connector/response exists; a test
        // double that supplies them is honored, which is what makes
        // correct binding actually testable.
        explicitSchemeId: item.explicitSchemeId,
        officialApplicationUrl: item.officialApplicationUrl,
        state: query.state,
        sector: query.sector,
        retrievedAt: item.retrievedAt,
        publishedAt: item.publishedAt,
        summary: item.summary,
        rawReference: item.sourceUrl,
      })
    }
    return Array.from(seen.values())
  }
}
