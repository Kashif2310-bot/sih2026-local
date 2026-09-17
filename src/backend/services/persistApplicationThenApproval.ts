/**
 * Integration save-order helper: TrackedApplication row first, then Jordan
 * ApprovalCase. Does not open, sign, or authorize cases — ApprovalService
 * remains the only quorum authority. Callers pass a case they already
 * obtained from createApprovalService().
 */

import type { TrackedApplication } from '../../apply/types'
import type { ApprovalCase } from '../../lib/approval/contracts'
import { BackendError } from '../errors'
import { assertApplicationId } from './optionA/identity'
import type { AditaApplicationPersistence } from './aditaApplicationPersistence'
import type { JordanApprovalPersistence } from './jordanApprovalPersistence'

export async function persistApplicationThenApproval(input: {
  applications: AditaApplicationPersistence
  approvals: JordanApprovalPersistence
  application: TrackedApplication
  approvalCase?: ApprovalCase
}): Promise<{ application: TrackedApplication; approvalCase: ApprovalCase | null }> {
  assertApplicationId(input.application.applicationId)
  if (input.approvalCase && input.approvalCase.applicationId !== input.application.applicationId) {
    throw new BackendError(
      'VALIDATION',
      'Approval case applicationId must match the TrackedApplication LP-APP-* id',
    )
  }

  const application = await input.applications.save(input.application)
  if (!input.approvalCase) {
    return { application, approvalCase: null }
  }
  const approvalCase = await input.approvals.saveCase(input.approvalCase)
  return { application, approvalCase }
}
