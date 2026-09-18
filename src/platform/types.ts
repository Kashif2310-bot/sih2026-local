/**
 * Shared Application domain types — the citizen wizard (src/citizen) writes
 * these, the admin app (src/admin) reads and mutates them. This is a
 * placeholder for the data contract Vamshi's real routing/data API will
 * eventually own (see docs/PRERNA_HANDOFF.md); the shape here is deliberately
 * plain-JSON-serializable so it can move to a real backend later without a
 * UI rewrite.
 */
import type { BusinessCategory } from '../data/villages'
import type { SchemeId } from '../lib/finance'
import type { LokScoreBreakdown } from '../lib/lokScore'
import type { MinistryId } from './ministries'

/** JSON-serializable attestation snapshot (mirrors src/lib/multisig Attestation). */
export interface ApplicationAttestation {
  reportHash: string
  entrepreneurName: string
  villageId: string
  lokScore: number
  schemeId: string
  projectCost: number
  loanAmount: number
  quorumRequired: number
  quorumPool: number
  timestamp: number
}

export type ApplicationStatus =
  | 'submitted'
  | 'under_review'
  | 'reviewer_assigned'
  | 'approved'
  | 'rejected'
  | 'disbursed'

export interface ApplicantInfo {
  name: string
  age: number
  gender: 'male' | 'female' | 'other'
  community: 'sc' | 'st' | 'obc' | 'general'
  phone: string
  email?: string
  address: string
  villageOrTown: string
  district: string
  state: string
  bankAccountNumber: string
  bankIfsc: string
  category: BusinessCategory
  businessDescription: string
}

export interface DocumentRecord {
  id: string
  labelEn: string
  labelKn: string
  fileName?: string
  sizeBytes?: number
  uploadedAt?: number
  status: 'missing' | 'declared_available' | 'uploaded' | 'verified' | 'rejected'
  reviewerNote?: string
}

export interface SignatureRecordLite {
  reviewerId: string
  address: string
  signature: string
  signedAt: number
}

export interface AuditEvent {
  id: string
  at: number
  actor: string
  action: string
  detail?: string
}

export interface Application {
  id: string
  createdAt: number
  updatedAt: number
  isDemoSeed?: boolean
  applicant: ApplicantInfo
  leadMinistryId: MinistryId
  supportingMinistryIds: MinistryId[]
  schemeId: SchemeId
  schemeName: string
  projectCost: number
  loanAmount: number
  lokScore: number
  lokScoreBreakdown: LokScoreBreakdown | null
  quorumRequired: number
  quorumPool: number
  mentorRequired: boolean
  documents: DocumentRecord[]
  signatures: SignatureRecordLite[]
  /** Real ECDSA attestation built on first admin sign session (JSON-serializable). */
  attestation?: ApplicationAttestation | null
  status: ApplicationStatus
  consentGiven: boolean
  consentAt?: number
  auditTrail: AuditEvent[]
}
