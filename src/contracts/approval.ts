/**
 * Approval / chain-anchor contracts for Jordan.
 * Backend stores evidence; cryptographic signing stays in multisig.ts / Solidity.
 */

import type { IsoDateTime, Uuid } from './common'

/** Mirrors existing adaptive quorum concept — do not redesign without team decision. */
export interface QuorumRequirement {
  quorumRequired: number
  quorumPool: number
  mentorRequired: boolean
  lokScoreTotal: number
}

export interface ApprovalRequestRecord {
  id: Uuid
  applicationId: Uuid
  lokScoreSnapshotId: Uuid | null
  quorumRequired: number
  quorumPool: number
  mentorRequired: boolean
  status: 'open' | 'quorum_met' | 'released' | 'cancelled'
  reportHash: string | null
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
}

export interface ApprovalSignatureRecord {
  id: Uuid
  approvalRequestId: Uuid
  reviewerId: Uuid
  address: string
  signature: string
  signedAt: IsoDateTime
  valid: boolean
}

/**
 * Minimal on-chain / audit evidence — never put PII here.
 * Aligns with AdaptiveSanction.sol case fields.
 */
export interface ChainAnchorRecord {
  id: Uuid
  applicationId: Uuid
  approvalRequestId: Uuid | null
  reportHash: string
  quorumRequired: number
  mentorRequired: boolean
  txRef: string | null
  chainId: string | null
  anchoredAt: IsoDateTime
}

export interface LokScoreSnapshotRecord {
  id: Uuid
  applicationId: Uuid | null
  applicantProfileId: Uuid | null
  total: number
  grade: 'A' | 'B' | 'C' | 'D'
  breakdown: {
    demand: number
    competitionGap: number
    weatherFit: number
    financialFit: number
    eligibility: number
  }
  quorumRequired: number
  quorumPool: number
  mentorRequired: boolean
  inputHash: string
  weights: {
    demand: number
    competitionGap: number
    weather: number
    finance: number
    eligibility: number
  }
  createdAt: IsoDateTime
}
