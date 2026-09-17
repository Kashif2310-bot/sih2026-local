export type * from './types'

export { createDataGovInAdapter } from './dataGovInAdapter'
export type { DataGovInAdapterConfig } from './dataGovInAdapter'

export { createRetrievalOrchestrator } from './orchestrator'
export type { RetrievalOrchestrator, RetrievalOrchestratorOptions } from './orchestrator'

export { createOfficialSchemeDiscoveryService } from './officialSchemeDiscoveryService'
export type { OfficialDiscoveryEnvelope, OfficialSchemeDiscoveryService } from './officialSchemeDiscoveryService'

export { computeFreshnessScore, dedupCandidates, normalizeRawRecord, toSchemeSource } from './normalize'

export { cacheKeyFor, RetrievalCache, SourceHealthTracker } from './cache'

export { fetchJsonWithRetry } from './httpClient'
export type { FetchJsonOptions, FetchJsonResult } from './httpClient'
