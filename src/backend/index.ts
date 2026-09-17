/**
 * Backend public surface for other workstreams (Option A).
 *
 * Prefer createBackendServices() — exposes:
 *   schemeCatalog, sharedProfiles, aditaApplications, jordanApprovals,
 *   liveRetrieval, admin
 * plus legacy Phase 1/2 UUID services as compatibility only.
 */

export type * from './services/types'

export { BackendError, isBackendError, toBackendError } from './errors'
export type { BackendErrorCode } from './errors'

export {
  assertUuid,
  assertLocale,
  assertApplicationStatus,
  validateCreateApplicationInput,
  validateUpdateFieldsInput,
} from './validation'

export {
  createEmptyApplicantProfileV2,
  applyProfilePatch,
  getMissingFields,
  emptyField,
  fieldFrom,
} from './adapters/profileHelpers'

export {
  toEntrepreneurProfile,
  fromEntrepreneurProfile,
} from './adapters/profileAdapter'
export type {
  ProfileAdapterResult,
  ProfileAdapterSuccess,
  ProfileAdapterFailure,
} from './adapters/profileAdapter'

export {
  sharedProfileFromV2,
  v2FromSharedProfile,
} from './adapters/applicantProfileV2Bridge'

export {
  createFixtureSchemeRegistry,
  getDefaultSchemeRegistry,
  FIXTURE_IDS,
  FIXTURE_TO_SCHEME_TS_ID,
} from './registry/fixtureSchemeRegistry'

export {
  listAuthoritativeSchemes,
  getAuthoritativeScheme,
  getSchemeView,
  listSchemeViews,
  schemeKnowledgeMeta,
} from './schemes/schemeSourceOfTruth'
export type { SchemeView, SchemeCacheRow } from './schemes/schemeSourceOfTruth'

export { createRecommendationService } from './services/recommendationService'
export { createMemoryProfileService } from './services/memoryProfileService'
export { createMemoryApplicationServices } from './services/memoryApplicationServices'
export type { MemoryApplicationStore } from './services/memoryApplicationServices'

export {
  createSupabaseSchemeRetrievalService,
  createResilientSchemeRetrievalService,
} from './services/supabaseSchemeRetrievalService'
export { createSupabaseProfileService } from './services/supabaseProfileService'
export {
  createSupabaseApplicationServices,
  createSupabaseApplicationPersistenceService,
  createSupabaseApplicationStatusService,
} from './services/supabaseApplicationServices'

export {
  createMemorySharedProfilePersistence,
  createSupabaseSharedProfilePersistence,
} from './services/sharedProfilePersistence'
export type { SharedProfilePersistence } from './services/sharedProfilePersistence'

export {
  createMemoryAditaApplicationPersistence,
  createSupabaseAditaApplicationPersistence,
} from './services/aditaApplicationPersistence'
export type { AditaApplicationPersistence } from './services/aditaApplicationPersistence'

export { persistApplicationThenApproval } from './services/persistApplicationThenApproval'

export {
  createMemoryJordanApprovalPersistence,
  createSupabaseJordanApprovalPersistence,
} from './services/jordanApprovalPersistence'
export type { JordanApprovalPersistence, ChainAnchorRecord } from './services/jordanApprovalPersistence'

export {
  createLiveRetrievalGateway,
  createUnavailableLiveRetrievalGateway,
} from './services/liveRetrievalGateway'
export type { LiveRetrievalGateway, LiveRetrievalResult } from './services/liveRetrievalGateway'

export { createAdminApplicationQueries } from './services/adminApplicationQueries'
export type {
  AdminApplicationQueries,
  AdminApplicationSummary,
  AdminApplicationDetail,
} from './services/adminApplicationQueries'

export {
  createSchemeCatalogService,
  SCHEME_TS_IDS,
} from './services/schemeCatalogService'
export type { SchemeCatalogService } from './services/schemeCatalogService'

export {
  DEFAULT_SCHEME_MINISTRY,
  resolveMinistryForScheme,
  listSchemeMinistrySeedRows,
  ministryCatalog,
} from './services/ministryMapping'

export { createBackendServices } from './services/createBackendServices'
export type { BackendServices, BackendMode, CreateBackendServicesOptions } from './services/createBackendServices'

export { createMemoryDocumentService } from './services/documents/memoryDocumentService'
export { createSupabaseDocumentService } from './services/documents/supabaseDocumentService'
export { computeMissingDocuments } from './services/documents/missingDocuments'

export { createMemoryNotificationService } from './services/notifications/memoryNotificationService'
export { createSupabaseNotificationService } from './services/notifications/supabaseNotificationService'
export type { NotificationProvider, NotificationProviderMap } from './services/notifications/provider'

export {
  CANONICAL_APPLICATION_STATUSES,
  canonicalStatusForWorkflowStep,
  isCanonicalApplicationStatus,
  assertCanonicalApplicationStatus,
} from '../contracts/applicationStatus'
export type { CanonicalApplicationStatus } from '../contracts/applicationStatus'

export { createMemoryApplicationStatusStore } from './services/applicationStatus/memoryApplicationStatusStore'
export { createSupabaseApplicationStatusStore } from './services/applicationStatus/supabaseApplicationStatusStore'
export { withCanonicalStatusPersistence } from './services/applicationStatus/withCanonicalStatusPersistence'

export type * from './services/officialSource/types'
export { createDataGovInAdapter } from './services/officialSource/dataGovInAdapter'
export { createRetrievalOrchestrator } from './services/officialSource/orchestrator'
export type { RetrievalOrchestrator } from './services/officialSource/orchestrator'
export { createOfficialSchemeDiscoveryService } from './services/officialSource/officialSchemeDiscoveryService'
export type { OfficialSchemeDiscoveryService, OfficialDiscoveryEnvelope } from './services/officialSource/officialSchemeDiscoveryService'

export {
  getSupabasePublicConfig,
  getSupabaseServerConfig,
  isSupabaseIntegrationEnabled,
} from './supabase/config'
export type { SupabasePublicConfig, SupabaseServerConfig } from './supabase/config'

export {
  createAnonClient,
  createServiceRoleClient,
  tryCreateAnonClient,
  tryCreateServiceRoleClient,
} from './supabase/client'
export type { LokPulseSupabaseClient } from './supabase/client'
