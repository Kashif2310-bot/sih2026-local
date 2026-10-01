import { createContext } from 'react'
import type { ApprovalCaseView } from '../lib/approval/views'
import type { AssessmentSnapshot } from '../lib/assessmentSnapshot'
import type { LiveSourceId } from '../lib/liveSignals'
import type { SchemePlan } from '../lib/finance'
import type {
  EntrepreneurProfile,
  LokScoreBreakdown,
  MandiSignal,
  WeatherSignal,
} from '../lib/lokScore'
import type { ResolvedLocation } from '../lib/resolveLocation'
import type { WorkingCapitalPlan } from '../lib/workingCapital'
import type { CompetitionLookupState } from '../maps/types'

export interface AppState {
  profile: EntrepreneurProfile | null
  location: ResolvedLocation | null
  weather: WeatherSignal | null
  week: Array<{ date: string; max: number; min: number; rain: number }>
  mandi: MandiSignal | null
  plan: SchemePlan | null
  workingCapital: WorkingCapitalPlan | null
  score: LokScoreBreakdown | null
  loading: boolean
  error: string | null
  errorKn: string | null
  /** Read-only approval projection — no multisig internals reach the UI. */
  approvalCase: ApprovalCaseView | null
  escrowReleased: boolean
  /** Current case id (server UUID, or a client id when working offline). */
  assessmentId: string | null
  /** False when the last scan was not saved to the backend. */
  persisted: boolean
  failedSources: LiveSourceId[]
  dataStatus: 'complete' | 'incomplete'
  competition: CompetitionLookupState
  retryingSignals: boolean
  setProfileAndScan: (p: EntrepreneurProfile) => Promise<string | null>
  hydrateFromSnapshot: (
    id: string,
    snapshot: AssessmentSnapshot,
    persisted: boolean,
  ) => Promise<void>
  hasAssessment: (id: string) => boolean
  retryLiveSignals: () => Promise<void>
  analyzeCompetition: (radiusKm: number) => Promise<void>
  signAs: (reviewerId: string) => Promise<void>
  releaseEscrow: () => void
  reset: () => void
}

export const AppCtx = createContext<AppState | null>(null)
