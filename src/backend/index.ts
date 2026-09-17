/**
 * Backend public surface for other workstreams.
 *
 * Prefer createBackendServices() — auto-selects Supabase when configured,
 * otherwise memory/fixture so the existing prototype never hard-depends on Supabase.
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
  createFixtureSchemeRegistry,
  getDefaultSchemeRegistry,
  FIXTURE_IDS,
} from './registry/fixtureSchemeRegistry'

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
export { createBackendServices } from './services/createBackendServices'
export type { BackendServices, BackendMode, CreateBackendServicesOptions } from './services/createBackendServices'

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
