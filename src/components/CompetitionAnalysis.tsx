import { AdvancedMarker, Map, Pin } from '@vis.gl/react-google-maps'
import { AlertTriangle, Loader2, MapPin, Star } from 'lucide-react'
import { useEffect, useState } from 'react'
import { COMPETITION_RADIUS_KM } from '../maps/businessTypeConfig'
import { narrateCompetition, type CompetitionNarration } from '../maps/competitionNarrator'
import type { CompetitionLookupState } from '../maps/types'
import { useMapsStatus } from '../maps/mapsContext'

interface CompetitionAnalysisProps {
  state: CompetitionLookupState
  latitude: number
  longitude: number
  locationName: string
  onAnalyze: (radiusKm: number) => Promise<void>
}

const threatStyle = {
  low: 'bg-leaf/15 text-forest',
  moderate: 'bg-gold/25 text-ink',
  high: 'bg-[#ffece8] text-danger',
} as const

export function CompetitionAnalysis({
  state,
  latitude,
  longitude,
  locationName,
  onAnalyze,
}: CompetitionAnalysisProps) {
  const currentRadius = state.status === 'success' ? state.result.radiusKm : COMPETITION_RADIUS_KM.default
  const [radiusKm, setRadiusKm] = useState(currentRadius)
  const [narration, setNarration] = useState<CompetitionNarration>()
  const mapsStatus = useMapsStatus()

  useEffect(() => {
    if (state.status !== 'success') return
    let active = true
    void narrateCompetition(state.result).then((next) => {
      if (active) setNarration(next)
    })
    return () => { active = false }
  }, [state])

  if (state.status === 'loading') {
    return <p className="flex items-center gap-2 rounded-xl bg-mist px-4 py-3 text-sm text-ink/65"><Loader2 className="h-4 w-4 animate-spin" /> Checking nearby businesses with Google Places…</p>
  }

  if (state.status === 'error') {
    return (
      <div role="alert" className="rounded-2xl border border-danger/20 bg-[#ffece8] p-4 text-sm text-danger">
        <p className="font-semibold">Competition data is unavailable.</p>
        <p className="mt-1">{state.message}</p>
        <p className="mt-2 text-xs">This is an API or quota failure—not evidence that there are no competitors.</p>
      </div>
    )
  }

  if (state.status !== 'success') {
    return <p className="rounded-xl bg-mist px-4 py-3 text-sm text-ink/65">Confirm a live location to run local competition analysis.</p>
  }

  const { result } = state
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="min-w-56 flex-1 text-sm font-medium text-ink/70">
          Competition radius: <strong className="text-forest">{radiusKm} km</strong>
          <input
            type="range"
            min={COMPETITION_RADIUS_KM.min}
            max={COMPETITION_RADIUS_KM.max}
            step={0.5}
            value={radiusKm}
            onChange={(event) => setRadiusKm(Number(event.target.value))}
            className="mt-2 block w-full accent-forest"
          />
        </label>
        <button
          type="button"
          onClick={() => void onAnalyze(radiusKm)}
          className="rounded-full bg-forest px-4 py-2 text-xs font-bold text-white hover:bg-leaf"
        >
          Recheck area
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-[1.35fr_1fr]">
        <div className="h-80 overflow-hidden rounded-xl border border-forest/10">
          {mapsStatus.status === 'ready' ? <Map mapId="DEMO_MAP_ID" defaultCenter={{ lat: latitude, lng: longitude }} defaultZoom={13}>
            <AdvancedMarker position={{ lat: latitude, lng: longitude }} title={locationName}>
              <Pin background="#174c3c" borderColor="#ffffff" glyphColor="#ffffff" />
            </AdvancedMarker>
            {result.competitors.map((competitor) => (
              <AdvancedMarker
                key={competitor.placeId}
                position={{ lat: competitor.latitude, lng: competitor.longitude }}
                title={competitor.name}
              >
                <Pin background="#b45309" borderColor="#ffffff" glyphColor="#ffffff" scale={0.75} />
              </AdvancedMarker>
            ))}
          </Map> : <div className="flex h-full items-center justify-center bg-mist px-6 text-center text-sm text-ink/60">Map unavailable. The returned list and score remain visible.</div>}
        </div>

        <div className="rounded-2xl border border-forest/10 bg-white p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-ink/45">Competition threat</p>
              <p className="mt-1 font-display text-3xl font-bold text-forest">{result.score}/100</p>
            </div>
            <span className={`rounded-full px-3 py-1 text-xs font-bold capitalize ${threatStyle[result.threatLevel]}`}>
              {result.threatLevel}
            </span>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div><dt className="text-ink/50">Listings</dt><dd className="font-semibold">{result.competitorCount}</dd></div>
            <div><dt className="text-ink/50">Average distance</dt><dd className="font-semibold">{result.averageDistanceKm == null ? 'Unavailable' : `${result.averageDistanceKm} km`}</dd></div>
            <div><dt className="text-ink/50">Average rating</dt><dd className="font-semibold">{result.averageRating == null ? 'Unavailable' : `${result.averageRating}/5`}</dd></div>
            <div><dt className="text-ink/50">Rating evidence</dt><dd className="font-semibold">{result.totalRatingCount}</dd></div>
          </dl>
          <div className="mt-4 border-t border-forest/10 pt-3 text-xs text-ink/55">
            Count {result.breakdown.countScore}/50 · proximity {result.breakdown.proximityScore}/30 · rating strength {result.breakdown.ratingStrengthScore}/20
          </div>
        </div>
      </div>

      {(result.dataQuality === 'no_results' || result.dataQuality === 'sparse') && (
        <p className="flex items-start gap-2 rounded-xl bg-gold/15 px-3 py-2 text-sm text-ink/75">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-clay" />
          {result.dataQuality === 'no_results'
            ? 'No matching Google listings were returned. Rural or informal businesses may be unlisted, so this does not prove there is no competition.'
            : 'The returned data is sparse or lacks ratings. Treat this as a directional signal and verify locally.'}
        </p>
      )}

      {narration && (
        <div className="rounded-xl bg-mist/70 px-4 py-3 text-sm text-ink/75">
          <p>{narration.text}</p>
          <p className="mt-2 text-[10px] uppercase tracking-wide text-ink/40">
            {narration.source === 'local_ai' ? 'AI explanation of deterministic evidence' : 'Deterministic explanation'}
          </p>
        </div>
      )}

      <div className="max-h-80 space-y-2 overflow-auto">
        {result.competitors.map((competitor) => (
          <article key={competitor.placeId} className="rounded-xl border border-forest/10 bg-white p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold text-forest">{competitor.name}</h3>
                {competitor.address && <p className="mt-1 text-xs text-ink/55">{competitor.address}</p>}
              </div>
              <span className="whitespace-nowrap text-xs font-semibold text-ink/65">{competitor.distanceKm} km</span>
            </div>
            <p className="mt-2 flex items-center gap-1 text-xs text-ink/60">
              {competitor.rating == null ? 'Rating unavailable' : <><Star className="h-3.5 w-3.5 fill-gold text-gold" /> {competitor.rating}/5 ({competitor.ratingCount ?? 0})</>}
            </p>
          </article>
        ))}
        {result.competitors.length === 0 && <p className="flex items-center gap-2 text-sm text-ink/60"><MapPin className="h-4 w-4" /> No returned listings to display.</p>}
      </div>
    </div>
  )
}
