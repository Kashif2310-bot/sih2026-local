/**
 * @lokpulse/contracts — shared types for all workstreams.
 *
 * Kashif  → profile, scheme, recommendation
 * Adita   → application, scheme documents
 * Prerna  → application status, scheme summaries
 * Jordan  → approval, chain anchors, lok score snapshots
 * Backend → owns implementations behind these shapes
 */

export type * from './common'
export type * from './domain'
export type * from './profile'
export type * from './scheme'
export type * from './recommendation'
export type * from './application'
export type * from './approval'

export {
  BUSINESS_CATEGORIES,
} from './domain'

export {
  ENGINE_REQUIRED_FIELDS,
  CURATED_LOCATION_REQUIRED,
  LIVE_LOCATION_REQUIRED,
} from './profile'
