/**
 * Backend runtime factory (Option A).
 *
 * Primary surfaces follow teammate contracts:
 * - schemes: schemes.ts (+ optional Kashif cache)
 * - sharedProfiles: src/shared/applicantProfile.ts
 * - aditaApplications: TrackedApplication / LP-APP-*
 * - jordanApprovals: src/lib/approval/*
 * - liveRetrieval: Kashif Edge Function wrapper
 * - admin: Prerna query helpers
 *
 * Legacy Phase 1/2 ProfileService + UUID ApplicationRecord services remain
 * as compatibility adapters only — do not force other workstreams onto them.
 */

import type {
  ApplicationPersistenceService,
  ApplicationStatusService,
  ProfileService,
  RecommendationService,
  SchemeRegistry,
} from './types'
import { createMemoryProfileService } from './memoryProfileService'
import { createMemoryApplicationServices } from './memoryApplicationServices'
import { createRecommendationService } from './recommendationService'
import { createFixtureSchemeRegistry } from '../registry/fixtureSchemeRegistry'
import {
  createResilientSchemeRetrievalService,
  createSupabaseSchemeRetrievalService,
} from './supabaseSchemeRetrievalService'
import { createSupabaseProfileService } from './supabaseProfileService'
import { createSupabaseApplicationServices } from './supabaseApplicationServices'
import {
  tryCreateAnonClient,
  tryCreateServiceRoleClient,
  type LokPulseSupabaseClient,
} from '../supabase/client'
import { getSupabasePublicConfig, getSupabaseServerConfig } from '../supabase/config'
import {
  createMemorySharedProfilePersistence,
  createSupabaseSharedProfilePersistence,
  type SharedProfilePersistence,
} from './sharedProfilePersistence'
import {
  createMemoryAditaApplicationPersistence,
  createSupabaseAditaApplicationPersistence,
  type AditaApplicationPersistence,
} from './aditaApplicationPersistence'
import {
  createMemoryJordanApprovalPersistence,
  createSupabaseJordanApprovalPersistence,
  type JordanApprovalPersistence,
} from './jordanApprovalPersistence'
import {
  createLiveRetrievalGateway,
  createUnavailableLiveRetrievalGateway,
  type LiveRetrievalGateway,
} from './liveRetrievalGateway'
import { createAdminApplicationQueries, type AdminApplicationQueries } from './adminApplicationQueries'
import { createSchemeCatalogService, type SchemeCatalogService } from './schemeCatalogService'

export type BackendMode = 'auto' | 'memory' | 'supabase'

export interface BackendServices {
  mode: 'memory' | 'supabase' | 'hybrid'
  /** Option A — schemes.ts catalog */
  schemeCatalog: SchemeCatalogService
  /** Option A — shared ApplicantProfile */
  sharedProfiles: SharedProfilePersistence
  /** Option A — Adita TrackedApplication */
  aditaApplications: AditaApplicationPersistence
  /** Option A — Jordan approval persistence */
  jordanApprovals: JordanApprovalPersistence
  /** Option A — Kashif live retrieval gateway */
  liveRetrieval: LiveRetrievalGateway
  /** Option A — Prerna admin queries */
  admin: AdminApplicationQueries

  /** @deprecated Phase 1/2 UUID profile service — compat only */
  profiles: ProfileService
  /** @deprecated Phase 1/2 UUID fixture registry — use schemeCatalog */
  schemes: SchemeRegistry
  recommendations: RecommendationService
  /** @deprecated Phase 1/2 UUID application records — use aditaApplications */
  applications: ApplicationPersistenceService
  /** @deprecated use aditaApplications + admin */
  applicationStatus: ApplicationStatusService
  supabaseConfigured: boolean
}

export interface CreateBackendServicesOptions {
  mode?: BackendMode
  client?: LokPulseSupabaseClient
  browserWriteMemory?: boolean
}

function attachOptionA(
  base: Omit<
    BackendServices,
    | 'schemeCatalog'
    | 'sharedProfiles'
    | 'aditaApplications'
    | 'jordanApprovals'
    | 'liveRetrieval'
    | 'admin'
  >,
  client: LokPulseSupabaseClient | null,
  writeClient: LokPulseSupabaseClient | null,
): BackendServices {
  const sharedProfiles = writeClient
    ? createSupabaseSharedProfilePersistence(writeClient)
    : createMemorySharedProfilePersistence()
  const aditaApplications = writeClient
    ? createSupabaseAditaApplicationPersistence(writeClient)
    : createMemoryAditaApplicationPersistence()
  const jordanApprovals = writeClient
    ? createSupabaseJordanApprovalPersistence(writeClient)
    : createMemoryJordanApprovalPersistence()

  return {
    ...base,
    schemeCatalog: createSchemeCatalogService(client),
    sharedProfiles,
    aditaApplications,
    jordanApprovals,
    liveRetrieval: client ? createLiveRetrievalGateway() : createUnavailableLiveRetrievalGateway(),
    admin: createAdminApplicationQueries(aditaApplications),
  }
}

function memoryBundle(supabaseConfigured: boolean): BackendServices {
  const memory = createMemoryApplicationServices()
  const schemes = createFixtureSchemeRegistry()
  return attachOptionA(
    {
      mode: 'memory',
      profiles: createMemoryProfileService(),
      schemes,
      recommendations: createRecommendationService(schemes),
      applications: memory.persistence,
      applicationStatus: memory.status,
      supabaseConfigured,
    },
    null,
    null,
  )
}

function resolveClient(opts?: CreateBackendServicesOptions): LokPulseSupabaseClient | null {
  if (opts?.client) return opts.client
  return tryCreateServiceRoleClient() ?? tryCreateAnonClient()
}

export function createBackendServices(opts: CreateBackendServicesOptions = {}): BackendServices {
  const mode: BackendMode = opts.mode ?? 'auto'
  const publicCfg = getSupabasePublicConfig()
  const serverCfg = getSupabaseServerConfig()

  if (mode === 'memory') {
    return memoryBundle(publicCfg.configured)
  }

  const wantSupabase =
    mode === 'supabase' || publicCfg.configured || serverCfg.serviceConfigured

  if (!wantSupabase) {
    return memoryBundle(publicCfg.configured)
  }

  const client = resolveClient(opts)
  if (!client) {
    return memoryBundle(false)
  }

  const fixture = createFixtureSchemeRegistry()
  const remote = createSupabaseSchemeRetrievalService(client)
  const schemes = createResilientSchemeRetrievalService(remote, fixture)

  const inBrowser = typeof window !== 'undefined'
  const forceMemoryWrites =
    opts.browserWriteMemory ?? (inBrowser && !opts.client && !serverCfg.serviceConfigured)

  if (forceMemoryWrites) {
    const memory = createMemoryApplicationServices()
    return attachOptionA(
      {
        mode: 'hybrid',
        profiles: createMemoryProfileService(),
        schemes,
        recommendations: createRecommendationService(schemes),
        applications: memory.persistence,
        applicationStatus: memory.status,
        supabaseConfigured: true,
      },
      client,
      null,
    )
  }

  const apps = createSupabaseApplicationServices(client)
  return attachOptionA(
    {
      mode: 'supabase',
      profiles: createSupabaseProfileService(client),
      schemes,
      recommendations: createRecommendationService(schemes),
      applications: apps.persistence,
      applicationStatus: apps.status,
      supabaseConfigured: true,
    },
    client,
    client,
  )
}
