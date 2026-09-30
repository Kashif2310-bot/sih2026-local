import type { EntrepreneurProfile } from '../lib/lokScore'
import type { ResolvedLocation } from '../lib/resolveLocation'
import type { CompetitionAnalysisResult } from '../maps/types'
import { applicantProfileFromEntrepreneurProfile } from '../shared/applicantProfile'
import { createSupabaseSharedProfilePersistence } from '../backend/services/sharedProfilePersistence'
import { createSupabaseCompetitionAnalysisPersistence } from '../backend/services/competitionAnalysisPersistence'
import { ensureIdentity, isRemotePersistenceConfigured, type RemoteSyncResult } from './remotePersistence'
import { getOrCreateLocalProfileId } from './remoteProfilePersistence'

/** Persists the applicant facts first, then the derived analysis linked to that profile. */
export async function syncCompetitionAnalysis(
  profile: EntrepreneurProfile,
  location: ResolvedLocation,
  result: CompetitionAnalysisResult,
): Promise<RemoteSyncResult> {
  if (!isRemotePersistenceConfigured()) return { ok: false, reason: 'not_configured' }
  const profileId = getOrCreateLocalProfileId()
  if (!profileId) return { ok: false, reason: 'write_failed', detail: 'localStorage unavailable for profile id' }
  const client = await ensureIdentity()
  if (!client) return { ok: false, reason: 'no_identity' }

  try {
    const sharedProfile = applicantProfileFromEntrepreneurProfile(profile, location, {
      applicantId: profileId,
      source: 'user_provided',
    })
    await createSupabaseSharedProfilePersistence(client).upsert(profileId, sharedProfile)
    await createSupabaseCompetitionAnalysisPersistence(client).save(profileId, result)
    return { ok: true }
  } catch (error) {
    return { ok: false, reason: 'write_failed', detail: error instanceof Error ? error.message : String(error) }
  }
}
