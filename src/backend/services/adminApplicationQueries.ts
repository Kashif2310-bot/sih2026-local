/**
 * Admin / application query surface for Prerna — reads Adita TrackedApplication model.
 */

import type { TrackedApplication } from '../../apply/types'
import {
  MINISTRIES,
  routeApplication,
  type MinistryId,
  type RoutingResult,
} from '../../platform/ministries'
import type { BusinessCategory } from '../../data/villages'
import type { AditaApplicationPersistence } from './aditaApplicationPersistence'
import { getAuthoritativeScheme } from '../schemes/schemeSourceOfTruth'

export interface AdminApplicationSummary {
  applicationId: string
  schemeId: string
  schemeName: string
  status: string
  outcome: string
  filedWithGovernment: boolean
  simulation: boolean
  updatedAt: string
  createdAt: string
  ministryHint?: MinistryId
}

export interface AdminApplicationDetail extends AdminApplicationSummary {
  application: TrackedApplication
  routing: RoutingResult | null
  schemeExistsInSourceOfTruth: boolean
}

export interface AdminApplicationQueries {
  listRecent(limit?: number): Promise<AdminApplicationSummary[]>
  listByStatus(status: string, limit?: number): Promise<AdminApplicationSummary[]>
  getDetail(applicationId: string): Promise<AdminApplicationDetail | null>
  routeForCategory(input: {
    category: BusinessCategory
    gender: 'male' | 'female' | 'other'
    community: 'sc' | 'st' | 'obc' | 'general'
  }): RoutingResult
  listMinistries(): typeof MINISTRIES
}

function summarize(app: TrackedApplication): AdminApplicationSummary {
  return {
    applicationId: app.applicationId,
    schemeId: app.schemeId,
    schemeName: app.schemeName,
    status: app.statusHistory.at(-1)?.step ?? app.outcome,
    outcome: app.outcome,
    filedWithGovernment: app.filedWithGovernment,
    simulation: app.simulation,
    updatedAt: app.updatedAt,
    createdAt: app.createdAt,
  }
}

export function createAdminApplicationQueries(
  apps: AditaApplicationPersistence,
): AdminApplicationQueries {
  return {
    async listRecent(limit = 50) {
      const list = await apps.list(limit)
      return list.map(summarize)
    },

    async listByStatus(status, limit = 50) {
      const list = await apps.listByStatus(status, limit)
      return list.map(summarize)
    },

    async getDetail(applicationId) {
      const application = await apps.get(applicationId)
      if (!application) return null
      const schemeExistsInSourceOfTruth = Boolean(getAuthoritativeScheme(application.schemeId))
      // Routing needs category/gender/community — unavailable without profile; return null routing.
      return {
        ...summarize(application),
        application,
        routing: null,
        schemeExistsInSourceOfTruth,
      }
    },

    routeForCategory(input) {
      return routeApplication(input)
    },

    listMinistries() {
      return MINISTRIES
    },
  }
}
