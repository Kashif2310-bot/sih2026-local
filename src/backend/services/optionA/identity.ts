/**
 * Shared LP-APP-* identity guard for Option A cross-service surfaces
 * (documents, notifications). Reuses Adita's own isApplicationId — never
 * redefines the LP-APP-* format independently.
 */

import { isApplicationId } from '../../../apply/application'
import { BackendError } from '../../errors'

export function assertApplicationId(value: string, field = 'applicationId'): string {
  if (!isApplicationId(value)) {
    throw new BackendError('VALIDATION', `${field} must be a valid LP-APP-* application id`)
  }
  return value
}
