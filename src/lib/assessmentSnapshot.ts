import type { AssessmentCreate } from './api'
import type { SchemePlan } from './finance'
import { toPaise } from './finance'
import type {
  EntrepreneurProfile,
  LokScoreBreakdown,
  MandiSignal,
  WeatherSignal,
} from './lokScore'
import type { ResolvedLocation } from './resolveLocation'
import type { WorkingCapitalPlan } from './workingCapital'

export const APP_VERSION = '0.0.0'
export const LAST_ASSESSMENT_KEY = 'lokpulse:lastAssessmentId'
export const SNAPSHOT_CACHE_PREFIX = 'lokpulse:assessment:'

export interface AssessmentSnapshot {
  profile: EntrepreneurProfile
  location: ResolvedLocation
  weather: WeatherSignal
  week: Array<{ date: string; max: number; min: number; rain: number }>
  mandi: MandiSignal | null
  plan: SchemePlan
  workingCapital: WorkingCapitalPlan | null
  score: LokScoreBreakdown
  approval: {
    applicationId: string
    frozenAt: number
  }
}

export function isAssessmentSnapshot(value: unknown): value is AssessmentSnapshot {
  if (!value || typeof value !== 'object') return false
  const v = value as Partial<AssessmentSnapshot>
  return (
    !!v.profile &&
    !!v.location &&
    !!v.weather &&
    !!v.plan &&
    !!v.score &&
    !!v.approval &&
    typeof v.approval.applicationId === 'string' &&
    Array.isArray(v.week)
  )
}

export function nsfdcScheme(plan: SchemePlan): 'micro' | 'term' {
  return plan.schemeId === 'micro_finance' ? 'micro' : 'term'
}

export function snapshotDataStatus(
  location: ResolvedLocation,
  weather: WeatherSignal,
  mandi: MandiSignal | null,
): 'complete' | 'incomplete' {
  const complete =
    weather.source === 'live' &&
    mandi != null &&
    mandi.source === 'seeded' &&
    location.competitorQueryOk
  return complete ? 'complete' : 'incomplete'
}

export function buildAssessmentCreate(
  snapshot: AssessmentSnapshot,
): AssessmentCreate {
  const marginPaise = toPaise(snapshot.profile.availableMargin)
  return {
    location_label: [snapshot.location.name, snapshot.location.district]
      .filter(Boolean)
      .join(', '),
    lat: snapshot.location.lat,
    lng: snapshot.location.lng,
    business_category: snapshot.profile.category,
    margin_paise: marginPaise,
    project_cost_paise: marginPaise * 10,
    loan_paise: toPaise(snapshot.plan.loanAmount),
    scheme: nsfdcScheme(snapshot.plan),
    lokscore: snapshot.score.total,
    lokscore_grade: snapshot.score.grade,
    data_status: snapshotDataStatus(snapshot.location, snapshot.weather, snapshot.mandi),
    inputs_json: { profile: snapshot.profile },
    outputs_json: snapshot as unknown as Record<string, unknown>,
    app_version: APP_VERSION,
  }
}

export function readLastAssessmentId(): string | null {
  try {
    return sessionStorage.getItem(LAST_ASSESSMENT_KEY) || localStorage.getItem(LAST_ASSESSMENT_KEY)
  } catch {
    return null
  }
}

export function writeLastAssessmentId(id: string, persisted: boolean): void {
  try {
    sessionStorage.setItem(LAST_ASSESSMENT_KEY, id)
    if (persisted) localStorage.setItem(LAST_ASSESSMENT_KEY, id)
  } catch {
    // private mode — in-memory navigation still works
  }
}

export function cacheSnapshot(id: string, snapshot: AssessmentSnapshot): void {
  try {
    sessionStorage.setItem(`${SNAPSHOT_CACHE_PREFIX}${id}`, JSON.stringify(snapshot))
  } catch {
    // ignore quota / private mode
  }
}

export function readCachedSnapshot(id: string): AssessmentSnapshot | null {
  try {
    const raw = sessionStorage.getItem(`${SNAPSHOT_CACHE_PREFIX}${id}`)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return isAssessmentSnapshot(parsed) ? parsed : null
  } catch {
    return null
  }
}
