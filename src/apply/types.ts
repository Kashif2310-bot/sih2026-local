/**
 * Adita — application automation domain types.
 *
 * One workflow is used for every filing channel (government API, assisted,
 * guided). A "submitted to government" outcome is only legal when a real
 * government endpoint accepted the packet. Assisted/guided produce a local
 * tracking id and a packet — they never pretend a government office received
 * the application. Simulation is an explicit opt-in and is labelled as such.
 */

import type { UserProfile } from '../assistant/types'
import type { ConversationPayload, FrozenSnapshot, SubmissionPackage } from './application'

export type { ConversationPayload, FrozenSnapshot, SubmissionPackage }

export const WORKFLOW_STEPS = [
  'profile_and_scheme',
  'application_schema',
  'field_mapping',
  'missing_fields',
  'document_requirements',
  'validation',
  'generated_application',
  'user_review',
  'corrections',
  'explicit_consent',
  'submission',
  'application_id',
  'status_tracking',
] as const

export type WorkflowStep = (typeof WORKFLOW_STEPS)[number]

/** Filing channel. Same engine; different last-mile adapter. */
export type FilingChannel = 'government_api' | 'assisted' | 'guided'

export type FieldType = 'string' | 'integer' | 'boolean'

export interface ApplicationFieldSpec {
  key: string
  label: string
  required: boolean
  fieldType: FieldType
  /** Path on UserProfile, or a derived mapper name. */
  profileSource?: keyof UserProfile | 'effectiveFinancing'
  helpText?: string
  minLength?: number
  maxLength?: number
  minValue?: number
  maxValue?: number
  pattern?: string
}

export interface ApplicationDocumentSpec {
  key: string
  label: string
  required: boolean
  notes?: string
}

export type DocumentDeclaration = 'missing' | 'declared_available' | 'will_submit_on_portal'

export interface ChannelPolicy {
  recommended: FilingChannel
  rationale: string
  /** True only when this prototype actually has credentials/config to call it. */
  governmentApiConfigured: boolean
}

export interface SchemeApplicationSpec {
  schemeId: string
  displayName: string
  officialApplicationUrl: string
  officialInfoUrl: string
  applyProcess: string[]
  channel: ChannelPolicy
  fields: ApplicationFieldSpec[]
  documents: ApplicationDocumentSpec[]
}

export interface MappedField {
  key: string
  label: string
  required: boolean
  fieldType: FieldType
  value: string | number | boolean | undefined
  source: 'profile' | 'derived' | 'user' | 'empty'
  helpText?: string
}

export interface MappedDocument {
  key: string
  label: string
  required: boolean
  notes?: string
  declaration: DocumentDeclaration
}

export interface ValidationIssue {
  code: string
  field?: string
  message: string
  blocking: boolean
}

export interface GeneratedPacket {
  schemeId: string
  schemeName: string
  channel: FilingChannel
  fields: Record<string, string | number | boolean>
  documents: Array<{ key: string; label: string; declaration: DocumentDeclaration }>
  officialApplicationUrl: string
  generatedAt: string
}

export interface ConsentRecord {
  accepted: boolean
  acceptedAt?: string
  /** Exact consent sentence the user agreed to — stored, not paraphrased later. */
  text: string
  channel: FilingChannel
  simulate: boolean
}

/**
 * Honest outcomes. `submitted_to_government` is reserved for a real API
 * acknowledgement. Nothing else may use that label.
 */
export type FilingOutcome =
  | 'submitted_to_government'
  | 'government_api_unavailable'
  | 'government_api_rejected'
  | 'assisted_packet_ready'
  | 'guided_packet_ready'
  | 'simulation_recorded'
  | 'blocked_by_validation'
  | 'consent_required'

export interface ChannelSubmitResult {
  outcome: FilingOutcome
  /** True only when a live government system accepted the packet. */
  filedWithGovernment: boolean
  simulation: boolean
  trackingId: string
  governmentApplicationId?: string
  officialPortalUrl?: string
  nextSteps: string[]
  honestLabel: string
  detail: string
}

export interface TrackedApplication {
  applicationId: string
  trackingId: string
  schemeId: string
  schemeName: string
  channel: FilingChannel
  outcome: FilingOutcome
  filedWithGovernment: boolean
  simulation: boolean
  governmentApplicationId?: string
  officialPortalUrl?: string
  honestLabel: string
  detail: string
  nextSteps: string[]
  packet: GeneratedPacket
  consent: ConsentRecord
  conversation?: ConversationPayload
  snapshot?: FrozenSnapshot
  package?: SubmissionPackage
  statusHistory: Array<{ at: string; step: WorkflowStep; note: string }>
  createdAt: string
  updatedAt: string
}

export interface PreparedApplication {
  scheme: SchemeApplicationSpec
  mappedFields: MappedField[]
  missingFields: MappedField[]
  documents: MappedDocument[]
  issues: ValidationIssue[]
  canPreparePacket: boolean
  packet: GeneratedPacket | null
  completedSteps: WorkflowStep[]
}
