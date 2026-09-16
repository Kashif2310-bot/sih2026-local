/**
 * Backend public surface for other workstreams.
 *
 * @example Kashif
 *   import { createEmptyApplicantProfileV2, applyProfilePatch, getMissingFields } from '../backend'
 *   import { createRecommendationService, getDefaultSchemeRegistry } from '../backend'
 *
 * @example Adita / Prerna
 *   import { createMemoryApplicationServices } from '../backend'
 *
 * @example Jordan
 *   import type { ApprovalRequestRecord, ChainAnchorRecord, QuorumRequirement } from '../contracts'
 */

export type * from './services/types'

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

export { getSupabasePublicConfig } from './supabase/config'
export type { SupabasePublicConfig } from './supabase/config'
