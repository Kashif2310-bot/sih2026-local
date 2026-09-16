import type { Application, AuditEvent } from '../platform/types'

export interface FlatAuditEvent extends AuditEvent {
  applicationId: string
  applicantName: string
}

export function flattenAuditTrail(apps: Application[]): FlatAuditEvent[] {
  const rows: FlatAuditEvent[] = []
  for (const app of apps) {
    for (const evt of app.auditTrail) {
      rows.push({
        ...evt,
        applicationId: app.id,
        applicantName: app.applicant.name,
      })
    }
  }
  return rows.sort((a, b) => b.at - a.at)
}

export function isPendingStatus(status: Application['status']): boolean {
  return status === 'submitted' || status === 'under_review' || status === 'reviewer_assigned'
}
