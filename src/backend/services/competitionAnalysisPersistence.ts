import type { CompetitionAnalysisResult, CompetitionThreatLevel } from '../../maps/types'
import type { LokPulseSupabaseClient } from '../supabase/client'
import { toBackendError } from '../errors'
import { assertUuid } from '../validation'
import type { Uuid } from '../../contracts/common'

export interface StoredCompetitionAnalysis {
  applicantProfileId: Uuid
  businessType: string
  competitorCount: number
  score: number
  threatLevel: CompetitionThreatLevel
  radiusKm: number
  analyzedAt: string
}

export interface CompetitionAnalysisPersistence {
  save(applicantProfileId: Uuid, result: CompetitionAnalysisResult): Promise<StoredCompetitionAnalysis>
}

export function createSupabaseCompetitionAnalysisPersistence(
  client: LokPulseSupabaseClient,
): CompetitionAnalysisPersistence {
  return {
    async save(applicantProfileId, result) {
      assertUuid(applicantProfileId, 'applicantProfileId')
      try {
        const row = {
          applicant_profile_id: applicantProfileId,
          business_type: result.businessType,
          competitor_count: result.competitorCount,
          score: result.score,
          threat_level: result.threatLevel,
          radius_m: Math.round(result.radiusKm * 1000),
          analyzed_at: result.analyzedAt,
        }
        const { data, error } = await client
          .from('competition_analyses')
          .insert(row)
          .select('applicant_profile_id, business_type, competitor_count, score, threat_level, radius_m, analyzed_at')
          .single()
        if (error) throw toBackendError(error)
        return {
          applicantProfileId: data.applicant_profile_id as Uuid,
          businessType: data.business_type as string,
          competitorCount: data.competitor_count as number,
          score: data.score as number,
          threatLevel: data.threat_level as CompetitionThreatLevel,
          radiusKm: (data.radius_m as number) / 1000,
          analyzedAt: data.analyzed_at as string,
        }
      } catch (error) {
        throw toBackendError(error)
      }
    },
  }
}
