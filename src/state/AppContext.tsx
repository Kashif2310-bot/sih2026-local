import { useCallback, useRef, useState, type ReactNode } from 'react'
import { createAssessment } from '../lib/api'
import { readAuth } from '../lib/authSession'
import {
  buildAssessmentCreate,
  cacheSnapshot,
  writeLastAssessmentId,
  type AssessmentSnapshot,
} from '../lib/assessmentSnapshot'
import { buildSchemePlan } from '../lib/finance'
import { collectFailedSources, dataStatusFromFailures, type LiveSourceId } from '../lib/liveSignals'
import { computeLokScore, type EntrepreneurProfile, type WeatherSignal } from '../lib/lokScore'
import { fetchMandiSignal } from '../lib/mandi'
import { canSanction } from '../lib/sanctionGate'
import {
  densityFromCount,
  fetchCompetitorsNearby,
  geocodeLocation,
  reverseGeocode,
  type CompetitorPoi,
} from '../lib/geo'
import { fetchWeather, fetchWeekTemps, unavailableWeather } from '../lib/weather'
import { resolveCuratedVillage, resolveLiveLocation, type ResolvedLocation } from '../lib/resolveLocation'
import { buildWorkingCapital, type WorkingCapitalPlan } from '../lib/workingCapital'
import { AppCtx, type AppState } from './app-state'
import { REACH_KM } from '../lib/config'
import { COMPETITION_RADIUS_KM } from '../maps/businessTypeConfig'
import { searchNearbyCompetition } from '../maps/googlePlaces'
import { mapsKeyConfigured } from '../maps/mapsKey'
import type { CompetitionAnalysisResult, CompetitionLookupState } from '../maps/types'
import { syncCompetitionAnalysis } from '../platform/remoteCompetitionPersistence'

// The approval layer pulls in ethers (real ECDSA) and is not cheap to
// parse/execute, so it is dynamically imported on first scan rather than
// bundled into the eagerly-loaded app shell. The UI only ever touches the
// approval *service* — never multisig internals.
let approvalModulePromise: Promise<{
  service: typeof import('../lib/approval/service')
  contracts: typeof import('../lib/approval/contracts')
}> | null = null

function loadApproval() {
  if (!approvalModulePromise) {
    approvalModulePromise = Promise.all([
      import('../lib/approval/service'),
      import('../lib/approval/contracts'),
    ]).then(([service, contracts]) => ({ service, contracts }))
  }
  return approvalModulePromise
}

type ApprovalService = ReturnType<
  Awaited<ReturnType<typeof loadApproval>>['service']['createApprovalService']
>

export function AppProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<EntrepreneurProfile | null>(null)
  const [location, setLocation] = useState<ResolvedLocation | null>(null)
  const [weather, setWeather] = useState<WeatherSignal | null>(null)
  const [week, setWeek] = useState<AppState['week']>([])
  const [mandi, setMandi] = useState<AppState['mandi']>(null)
  const [plan, setPlan] = useState<AppState['plan']>(null)
  const [workingCapital, setWorkingCapital] = useState<WorkingCapitalPlan | null>(null)
  const [score, setScore] = useState<AppState['score']>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorKn, setErrorKn] = useState<string | null>(null)
  const [approvalCase, setApprovalCase] = useState<AppState['approvalCase']>(null)
  const [escrowReleased, setEscrowReleased] = useState(false)
  const [assessmentId, setAssessmentId] = useState<string | null>(null)
  const [persisted, setPersisted] = useState(false)
  const [failedSources, setFailedSources] = useState<LiveSourceId[]>([])
  const [retryingSignals, setRetryingSignals] = useState(false)
  const [competition, setCompetition] = useState<CompetitionLookupState>({ status: 'idle' })
  const serviceRef = useRef<ApprovalService | null>(null)
  const applicationIdRef = useRef<string | null>(null)
  const assessmentIdRef = useRef<string | null>(null)
  const snapshotRef = useRef<AssessmentSnapshot | null>(null)
  const readyRef = useRef(false)

  const setProfileAndScan = useCallback(async (p: EntrepreneurProfile) => {
    setLoading(true)
    setError(null)
    setErrorKn(null)
    setApprovalCase(null)
    setEscrowReleased(false)
    setPersisted(false)
    setCompetition({ status: p.locationMode === 'live' && !p.demoMode ? 'loading' : 'idle' })
    readyRef.current = false
    const radiusKm = p.radiusKm || REACH_KM.default

    try {
      let resolved: ResolvedLocation
      let competitionAnalysis: CompetitionAnalysisResult | undefined
      let competitionError: string | undefined
      if (p.locationMode === 'live' && !p.demoMode) {
        // Google Places only with a Maps key; without one, resolveLiveLocation keeps OpenStreetMap Overpass.
        const useGooglePlaces = mapsKeyConfigured()
        const live = await resolveLiveLocation({
          query: p.liveQuery,
          lat: p.liveLat,
          lng: p.liveLng,
          category: p.category,
          radiusKm,
          competitorSource: useGooglePlaces ? 'google_places' : 'overpass',
          competitorLookup: useGooglePlaces ? async ({ lat, lng, category }) => {
            try {
              competitionAnalysis = await searchNearbyCompetition({
                latitude: lat,
                longitude: lng,
                businessType: category,
                radiusKm: COMPETITION_RADIUS_KM.default,
              })
              const pois: CompetitorPoi[] = competitionAnalysis.competitors.map((item) => ({
                id: item.placeId,
                name: item.name,
                lat: item.latitude,
                lng: item.longitude,
                tags: {},
                address: item.address,
                rating: item.rating,
                ratingCount: item.ratingCount,
                distanceKm: item.distanceKm,
                source: 'google_places',
              }))
              return { ok: true, pois }
            } catch (lookupError) {
              competitionError = lookupError instanceof Error
                ? lookupError.message
                : 'Google Places competition analysis failed.'
              return { ok: false, pois: [], error: competitionError }
            }
          } : undefined,
        })
        if (!live.ok) {
          setError(live.error)
          setErrorKn(live.errorKn)
          setCompetition({ status: 'error', message: live.error })
          return null
        }
        resolved = live.location
        if (competitionAnalysis) {
          resolved = {
            ...resolved,
            competitorDensity: {
              ...resolved.competitorDensity,
              [p.category]: densityFromCount(competitionAnalysis.competitorCount),
            },
            notes: `Google Places returned ${competitionAnalysis.competitorCount} similar businesses within ${competitionAnalysis.radiusKm} km. Population/PPI not available — not fabricated.`,
            provenanceLabelEn: `Live Google Maps lookup for ${resolved.name}`,
          }
        }
      } else {
        resolved = await resolveCuratedVillage(p.villageId, p.category, radiusKm, p.demoMode)
      }

      const scheme = buildSchemePlan(p.availableMargin)
      const wc = buildWorkingCapital({
        category: p.category,
        projectCostRupees: scheme.projectCost,
        monthlyOpexRupees: scheme.opsCostMonthly,
      })

      let w: WeatherSignal
      let wk: AppState['week'] = []
      if (p.demoMode) {
        w = unavailableWeather()
        wk = []
      } else {
        try {
          ;[w, wk] = await Promise.all([
            fetchWeather(resolved.lat, resolved.lng),
            fetchWeekTemps(resolved.lat, resolved.lng),
          ])
        } catch {
          w = unavailableWeather()
          wk = []
        }
      }

      const m = await fetchMandiSignal(resolved, p.category)
      const lok = computeLokScore({
        profile: p,
        location: resolved,
        weather: w,
        mandi: m,
        plan: scheme,
      })

      const approval = await loadApproval()
      // A fresh service per scan keeps one demo session isolated from the next.
      const svc = approval.service.createApprovalService()
      serviceRef.current = svc

      // /scan demo is not Adita's apply wizard. Provisional ids remain only
      // on this cockpit path. When a real SubmissionPackage exists, call
      // openApprovalCaseFromAditaPackage() instead (LP-APP-… ids).
      const frozenAt = Date.now()
      const applicationId = approval.contracts.provisionalApplicationId({
        applicantRef: p.name,
        villageId: resolved.id,
        schemeId: scheme.schemeId,
        frozenAt,
      })
      const view = svc.openApprovalCase({
        applicationId,
        applicantRef: p.name,
        villageId: resolved.id,
        schemeId: scheme.schemeId,
        projectCost: scheme.projectCost,
        loanAmount: scheme.loanAmount,
        lokScore: lok,
        frozenAt,
      })
      applicationIdRef.current = applicationId

      const weatherSkipped = !!p.demoMode
      const failed = collectFailedSources(resolved, w, weatherSkipped)
      const snapshot: AssessmentSnapshot = {
        profile: p,
        location: resolved,
        weather: w,
        week: wk,
        mandi: m,
        plan: scheme,
        workingCapital: wc,
        score: lok,
        approval: { applicationId, frozenAt },
        failedSources: failed,
        weatherSkipped,
        competitionAnalysis,
        competitionError,
      }

      let id: string = crypto.randomUUID()
      let saved = false
      try {
        const row = await createAssessment(buildAssessmentCreate(snapshot, readAuth()?.user.id))
        id = row.id
        saved = true
      } catch {
        saved = false
      }
      cacheSnapshot(id, snapshot)
      writeLastAssessmentId(id, saved)
      assessmentIdRef.current = id
      snapshotRef.current = snapshot
      readyRef.current = true

      setProfile(p)
      setLocation(resolved)
      setWeather(w)
      setWeek(wk)
      setMandi(m)
      setPlan(scheme)
      setWorkingCapital(wc)
      setScore(lok)
      setApprovalCase(view)
      setAssessmentId(id)
      setPersisted(saved)
      setFailedSources(failed)
      setCompetition(
        competitionAnalysis
          ? { status: 'success', result: competitionAnalysis }
          : competitionError
            ? { status: 'error', message: competitionError }
            : { status: 'idle' },
      )
      if (competitionAnalysis) void syncCompetitionAnalysis(p, resolved, competitionAnalysis)
      return id
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Scan failed'
      setError(message)
      setErrorKn('ಸ್ಕ್ಯಾನ್ ವಿಫಲವಾಗಿದೆ')
      setCompetition({ status: 'error', message })
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  const hydrateFromSnapshot = useCallback(
    async (id: string, snapshot: AssessmentSnapshot, saved: boolean) => {
      const approval = await loadApproval()
      const svc = approval.service.createApprovalService()
      serviceRef.current = svc
      const view = svc.openApprovalCase({
        applicationId: snapshot.approval.applicationId,
        applicantRef: snapshot.profile.name,
        villageId: snapshot.location.id,
        schemeId: snapshot.plan.schemeId,
        projectCost: snapshot.plan.projectCost,
        loanAmount: snapshot.plan.loanAmount,
        lokScore: snapshot.score,
        frozenAt: snapshot.approval.frozenAt,
      })
      applicationIdRef.current = snapshot.approval.applicationId
      assessmentIdRef.current = id
      snapshotRef.current = snapshot
      readyRef.current = true
      const failed =
        snapshot.failedSources ??
        collectFailedSources(snapshot.location, snapshot.weather, snapshot.weatherSkipped ?? false)
      setProfile(snapshot.profile)
      setLocation(snapshot.location)
      setWeather(snapshot.weather)
      setWeek(snapshot.week)
      setMandi(snapshot.mandi)
      setPlan(snapshot.plan)
      setWorkingCapital(snapshot.workingCapital)
      setScore(snapshot.score)
      setApprovalCase(view)
      setEscrowReleased(false)
      setAssessmentId(id)
      setPersisted(saved)
      setFailedSources(failed)
      setCompetition(
        snapshot.competitionAnalysis
          ? { status: 'success', result: snapshot.competitionAnalysis }
          : snapshot.competitionError
            ? { status: 'error', message: snapshot.competitionError }
            : { status: 'idle' },
      )
      setError(null)
      setErrorKn(null)
    },
    [],
  )

  const hasAssessment = useCallback((id: string) => {
    return readyRef.current && assessmentIdRef.current === id
  }, [])

  const retryLiveSignals = useCallback(async () => {
    const snap = snapshotRef.current
    const id = assessmentIdRef.current
    if (!snap || !id) return
    setRetryingSignals(true)
    try {
      let location = snap.location
      let weather = snap.weather
      let week = snap.week
      const failed = [...(snap.failedSources ?? collectFailedSources(snap.location, snap.weather, snap.weatherSkipped ?? false))]

      if (failed.includes('geocoding')) {
        const q = snap.profile.liveQuery
        const lat = snap.profile.liveLat ?? location.lat
        const lng = snap.profile.liveLng ?? location.lng
        const hit = q?.trim() ? await geocodeLocation(q) : await reverseGeocode(lat, lng)
        if (hit) {
          location = { ...location, name: hit.displayName.split(',')[0] ?? location.name, lat: hit.lat, lng: hit.lng, geocodeOk: true }
        }
      }

      // Either competitor source is retried through Overpass, so a success is labelled as Overpass.
      if (failed.includes('overpass') || failed.includes('google_places')) {
        const live = await fetchCompetitorsNearby({
          lat: location.lat,
          lng: location.lng,
          category: snap.profile.category,
          radiusKm: location.radiusKm,
        })
        if (live.ok) {
          location = { ...location, competitors: live.pois, competitorQueryOk: true, competitorError: undefined, competitorSource: 'overpass' }
        }
      }

      if (failed.includes('weather')) {
        try {
          const [w, wk] = await Promise.all([
            fetchWeather(location.lat, location.lng),
            fetchWeekTemps(location.lat, location.lng),
          ])
          weather = w
          week = wk
        } catch {
          weather = unavailableWeather()
        }
      }

      const nextFailed = collectFailedSources(location, weather, snap.weatherSkipped ?? false)
      const lok = computeLokScore({
        profile: snap.profile,
        location,
        weather,
        mandi: snap.mandi,
        plan: snap.plan,
      })
      const approval = await loadApproval()
      const svc = approval.service.createApprovalService()
      serviceRef.current = svc
      const frozenAt = Date.now()
      const applicationId = snap.approval.applicationId
      const view = svc.openApprovalCase({
        applicationId,
        applicantRef: snap.profile.name,
        villageId: location.id,
        schemeId: snap.plan.schemeId,
        projectCost: snap.plan.projectCost,
        loanAmount: snap.plan.loanAmount,
        lokScore: lok,
        frozenAt,
      })
      applicationIdRef.current = applicationId
      const next: AssessmentSnapshot = {
        ...snap,
        location,
        weather,
        week,
        score: lok,
        approval: { applicationId, frozenAt },
        failedSources: nextFailed,
      }
      snapshotRef.current = next
      cacheSnapshot(id, next)
      setLocation(location)
      setWeather(weather)
      setWeek(week)
      setScore(lok)
      setApprovalCase(view)
      setFailedSources(nextFailed)
    } finally {
      setRetryingSignals(false)
    }
  }, [])

  const analyzeCompetition = useCallback(async (radiusKm: number) => {
    if (!profile || !location) return
    setCompetition({ status: 'loading' })
    try {
      const result = await searchNearbyCompetition({
        latitude: location.lat,
        longitude: location.lng,
        businessType: profile.category,
        radiusKm,
      })
      const competitors: CompetitorPoi[] = result.competitors.map((item) => ({
        id: item.placeId,
        name: item.name,
        lat: item.latitude,
        lng: item.longitude,
        tags: {},
        address: item.address,
        rating: item.rating,
        ratingCount: item.ratingCount,
        distanceKm: item.distanceKm,
        source: 'google_places',
      }))
      const nextLocation: ResolvedLocation = {
        ...location,
        competitors,
        competitorQueryOk: true,
        competitorError: undefined,
        competitorDensity: {
          ...location.competitorDensity,
          [profile.category]: densityFromCount(result.competitorCount),
        },
      }
      setLocation(nextLocation)
      setCompetition({ status: 'success', result })
      void syncCompetitionAnalysis(profile, nextLocation, result)
      if (weather && plan) {
        const nextScore = computeLokScore({ profile, location: nextLocation, weather, mandi, plan })
        setScore(nextScore)
        if (snapshotRef.current && assessmentIdRef.current) {
          const nextSnapshot: AssessmentSnapshot = {
            ...snapshotRef.current,
            location: nextLocation,
            score: nextScore,
            competitionAnalysis: result,
            competitionError: undefined,
          }
          snapshotRef.current = nextSnapshot
          cacheSnapshot(assessmentIdRef.current, nextSnapshot)
        }
      }
    } catch (analysisError) {
      const message = analysisError instanceof Error
        ? analysisError.message
        : 'Google Places competition analysis failed.'
      setCompetition({ status: 'error', message })
    }
  }, [location, mandi, plan, profile, weather])

  const signAs = useCallback(async (reviewerId: string) => {
    const svc = serviceRef.current
    const applicationId = applicationIdRef.current
    const snap = snapshotRef.current
    if (!svc || !applicationId || !snap) return
    const status = dataStatusFromFailures(
      snap.failedSources ?? collectFailedSources(snap.location, snap.weather, snap.weatherSkipped ?? false),
    )
    if (!canSanction(status)) return
    setApprovalCase(await svc.submitSignature(applicationId, reviewerId))
  }, [])

  const releaseEscrow = useCallback(() => {
    const svc = serviceRef.current
    const applicationId = applicationIdRef.current
    if (!svc || !applicationId) return
    try {
      svc.authorizeDisbursement(applicationId)
      setEscrowReleased(true)
    } finally {
      setApprovalCase(svc.getApprovalCase(applicationId))
    }
  }, [])

  const reset = useCallback(() => {
    setProfile(null)
    setLocation(null)
    setWeather(null)
    setWeek([])
    setMandi(null)
    setPlan(null)
    setWorkingCapital(null)
    setScore(null)
    setApprovalCase(null)
    setEscrowReleased(false)
    setAssessmentId(null)
    setPersisted(false)
    setFailedSources([])
    setRetryingSignals(false)
    setCompetition({ status: 'idle' })
    setError(null)
    setErrorKn(null)
    serviceRef.current = null
    applicationIdRef.current = null
    assessmentIdRef.current = null
    snapshotRef.current = null
    readyRef.current = false
  }, [])

  const value: AppState = {
    profile,
    location,
    weather,
    week,
    mandi,
    plan,
    workingCapital,
    score,
    loading,
    error,
    errorKn,
    approvalCase,
    escrowReleased,
    assessmentId,
    persisted,
    failedSources,
    dataStatus: dataStatusFromFailures(failedSources),
    retryingSignals,
    competition,
    setProfileAndScan,
    hydrateFromSnapshot,
    hasAssessment,
    retryLiveSignals,
    analyzeCompetition,
    signAs,
    releaseEscrow,
    reset,
  }

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>
}
