export type ApprovalErrorCode =
  | 'INVALID_SNAPSHOT'
  | 'DUPLICATE_APPLICATION'
  | 'UNKNOWN_APPLICATION'
  | 'QUORUM_POLICY_MISMATCH'
  | 'ALLOCATION_FAILED'
  | 'REVIEWER_UNKNOWN'
  | 'REVIEWER_NOT_ALLOCATED'
  | 'REVIEWER_NOT_AUTHORIZED'
  | 'REVIEWER_NO_SIGNING_KEY'
  | 'DUPLICATE_SIGNATURE'
  | 'SIGNATURE_INVALID'
  | 'QUORUM_NOT_MET'
  | 'ALREADY_AUTHORIZED'
  | 'SOURCE_HASH_MISMATCH'
  | 'APPLICATION_ID_MISMATCH'
  | 'NOT_READY_FOR_APPROVAL'
  | 'INVALID_APPLICATION_ID'
  | 'SOURCE_TAMPERED'

export class ApprovalError extends Error {
  readonly code: ApprovalErrorCode
  readonly applicationId?: string
  readonly details?: string[]

  constructor(code: ApprovalErrorCode, message: string, applicationId?: string, details?: string[]) {
    super(message)
    this.name = 'ApprovalError'
    this.code = code
    this.applicationId = applicationId
    this.details = details
  }
}
