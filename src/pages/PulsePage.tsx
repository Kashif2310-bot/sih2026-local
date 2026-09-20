import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  Area,
  AreaChart,
  CartesianGrid,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { CloudRain, Store, Users, ArrowRight } from 'lucide-react'
import { useApp } from '../state/useApp'
import { BUSINESS_META } from '../data/villages'
import { getUpcomingEvents } from '../data/festivals'
import { VillageMap } from '../components/VillageMap'
import { IncompleteSignalsBanner } from '../components/IncompleteSignalsBanner'
import { format } from 'date-fns'

export function PulsePage() {
  const { t, i18n } = useTranslation()
  const kn = i18n.language === 'kn'
  const { profile, location, weather, week, mandi, score, assessmentId, dataStatus } = useApp()

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [])

  if (!profile || !weather || !score || !location) return null

  const events = location.hasCuratedSignals ? getUpcomingEvents(location.id) : []
  const placeName = kn ? location.nameKn : location.name
  const placeDistrict = kn ? location.districtKn : location.district
  const weatherUnavailable = weather.source === 'unavailable'
  const chartData = week.map((d) => ({
    day: format(new Date(d.date), 'EEE'),
    max: d.max,
    rain: d.rain,
  }))

  const componentDefs = [
    {
      key: 'demand',
      label: kn ? 'ಬೇಡಿಕೆ' : 'Demand',
      value: score.demand,
      reason: kn ? score.rationaleKn[0] : score.rationale[0],
    },
    {
      key: 'competitionGap',
      label: kn ? 'ಸ್ಪರ್ಧಾ ಅಂತರ' : 'Comp. gap',
      value: score.competitionGap,
      reason: kn ? score.rationaleKn[1] : score.rationale[1],
    },
    {
      key: 'weatherFit',
      label: kn ? 'ಹವಾಮಾನ' : 'Weather',
      value: score.weatherFit,
      reason: kn ? score.rationaleKn[2] : score.rationale[2],
    },
    {
      key: 'financialFit',
      label: kn ? 'ಹಣಕಾಸು' : 'Finance',
      value: score.financialFit,
      reason: kn ? score.rationaleKn[3] : score.rationale[3],
    },
    {
      key: 'eligibility',
      label: kn ? 'ಅರ್ಹತೆ' : 'Eligibility',
      value: score.eligibility,
      reason: kn ? score.rationaleKn[4] : score.rationale[4],
    },
  ] as const
  const NEAR_MAX_THRESHOLD = 85

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-sky">
            {placeName} · {placeDistrict}
          </p>
          <h1 className="font-display text-3xl font-bold text-forest">{t('pulse.title')}</h1>
          <p className="mt-1 text-sm text-ink/60">
            {kn ? BUSINESS_META[profile.category].labelKn : BUSINESS_META[profile.category].label} ·{' '}
            {profile.name}
          </p>
        </div>
        <LokScoreRing
          total={score.total}
          grade={score.grade}
          label={t('pulse.score')}
          provisional={dataStatus === 'incomplete'}
          provisionalLabel={t('pulse.provisional')}
        />
      </div>

      <IncompleteSignalsBanner />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="glass rounded-2xl p-5 lg:col-span-2">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-forest">
            <Users className="h-4 w-4" /> {t('pulse.radius')}
          </div>
          <div className="h-64 overflow-hidden rounded-xl">
            <VillageMap
              lat={location.lat}
              lng={location.lng}
              name={placeName}
              radiusKm={location.radiusKm}
              competitors={location.competitors}
            />
          </div>
          <p className="mt-3 text-sm text-ink/70">
            {kn ? location.notesKn : location.notes}
            {location.households != null && location.population != null
              ? ` · ~${(location.households * 1.8 + location.population * 0.35).toFixed(0)} ${
                  kn ? 'ಗ್ರಾಹಕ ವ್ಯಾಪ್ತಿ' : 'est. consumers in ring'
                }`
              : ''}
          </p>
        </div>

        <div className="space-y-4">
          <div className="glass rounded-2xl p-5">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-forest">
              <CloudRain className="h-4 w-4" /> {t('pulse.weather')}
            </div>
            {weatherUnavailable ? (
              <>
                <p className="text-lg font-bold text-ink">{kn ? weather.summaryKn : weather.summary}</p>
                <p className="mt-1 text-sm text-ink/65">{t('pulse.weatherUnavailable')}</p>
              </>
            ) : (
              <>
                <p className="text-2xl font-bold text-ink">
                  {Math.round(weather.tempMax)}° / {Math.round(weather.tempMin)}°
                </p>
                <p className="text-sm text-ink/65">{kn ? weather.summaryKn : weather.summary}</p>
                <p className="mt-1 text-xs text-sky">
                  {kn ? 'ಮಳೆ ಸಂಭವ' : 'Rain chance'} {weather.precipProb}% · {weather.precipMm} mm
                </p>
              </>
            )}
            {chartData.length > 0 && !weatherUnavailable && (
              <div className="mt-4 h-28">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#0b3d2e15" />
                    <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                    <YAxis hide />
                    <Tooltip />
                    <Area type="monotone" dataKey="max" stroke="#0b3d2e" fill="#1f6b4f33" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          <div className="glass rounded-2xl p-5">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-forest">
              <Store className="h-4 w-4" /> {t('pulse.mandi')}
            </div>
            {mandi ? (
              <>
                <p className="text-lg font-bold">
                  {mandi.commodity} · {mandi.modalPrice} {mandi.unit}
                </p>
                <p className="text-xs text-ink/55">{mandi.market}</p>
                <p
                  className={`mt-2 text-sm font-semibold ${
                    mandi.trend === 'up' ? 'text-leaf' : mandi.trend === 'down' ? 'text-danger' : 'text-ink/60'
                  }`}
                >
                  {mandi.trend === 'up' ? '▲' : mandi.trend === 'down' ? '▼' : '●'} {mandi.changePct}%
                </p>
              </>
            ) : (
              <p className="text-sm text-ink/65">{t('pulse.mandiUnavailable')}</p>
            )}
          </div>
        </div>
      </div>

      <div className="glass rounded-2xl p-5">
        <h2 className="font-display text-xl font-bold text-forest">{t('pulse.events')}</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {events.map((e) => (
            <div key={e.id} className="rounded-2xl border border-forest/10 bg-white/70 p-4">
              <div className="flex items-start justify-between gap-2">
                <p className="font-semibold text-ink">{kn ? e.nameKn : e.name}</p>
                <span className="shrink-0 rounded-full bg-gold/30 px-2 py-0.5 text-xs font-bold text-ink">
                  {format(e.start, 'dd MMM')}
                </span>
              </div>
              <p className="mt-2 text-sm text-ink/70">{kn ? e.insightKn : e.insight}</p>
              <p className="mt-2 rounded-xl bg-mist px-3 py-2 text-sm font-medium text-forest">
                → {kn ? e.actionKn : e.action}
              </p>
              {e.demandLift[profile.category] != null && (
                <p className="mt-2 text-xs font-semibold text-clay">
                  {kn ? 'ನಿಮ್ಮ ವರ್ಗದ ಬೇಡಿಕೆ ಏರಿಕೆ' : 'Demand lift for your category'}: +
                  {Math.round(e.demandLift[profile.category] * 100)}%
                </p>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="glass rounded-2xl p-5">
        <h3 className="font-semibold text-forest">{t('pulse.breakdown')}</h3>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart
                data={componentDefs}
                outerRadius="62%"
                margin={{ top: 16, right: 28, bottom: 16, left: 28 }}
              >
                <PolarGrid stroke="#0b3d2e22" />
                <PolarAngleAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: '#0b3d2ecc' }}
                />
                <PolarRadiusAxis domain={[0, 100]} tick={{ fontSize: 9 }} axisLine={false} />
                <Radar
                  name={t('pulse.breakdown')}
                  dataKey="value"
                  stroke="#0b3d2e"
                  fill="#1f6b4f"
                  fillOpacity={0.35}
                />
                <Tooltip />
              </RadarChart>
            </ResponsiveContainer>
          </div>
          <div className="grid grid-cols-2 gap-2 content-start sm:grid-cols-3 md:grid-cols-2">
            {componentDefs.map((c) => (
              <div key={c.key} className="rounded-xl bg-mist/70 px-3 py-3 text-center">
                <p className="text-xs text-ink/55">{c.label}</p>
                <p className="text-xl font-bold text-forest">{c.value}</p>
              </div>
            ))}
          </div>
        </div>
        <ul className="mt-4 space-y-1 text-sm text-ink/70">
          {componentDefs
            .filter((c) => c.value < NEAR_MAX_THRESHOLD)
            .map((c) => (
              <li key={c.key}>• {c.reason}</li>
            ))}
        </ul>
        <p className="mt-3 text-sm font-semibold text-sky">
          {kn ? 'ಅನುಮೋದನಾ ಕೋರಂ' : 'Sanction quorum'}: {score.quorumRequired}/{score.quorumPool}
          {score.mentorRequired ? (kn ? ' + ಮಾರ್ಗದರ್ಶಕ ಕಡ್ಡಾಯ' : ' + mentor required') : ''}
        </p>
      </div>

      <Link
        to={`/report/${assessmentId}`}
        className="inline-flex items-center gap-2 rounded-full bg-forest px-5 py-3 text-sm font-bold text-white"
      >
        {t('pulse.continue')} <ArrowRight className="h-4 w-4" />
      </Link>
    </div>
  )
}

function LokScoreRing({
  total,
  grade,
  label,
  provisional,
  provisionalLabel,
}: {
  total: number
  grade: string
  label: string
  provisional?: boolean
  provisionalLabel?: string
}) {
  const r = 36
  const c = 2 * Math.PI * r
  const offset = c - (total / 100) * c
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-forest/10 bg-white/80 px-4 py-3">
      <svg width="88" height="88" className="-rotate-90">
        <circle cx="44" cy="44" r={r} stroke="#e7f2ec" strokeWidth="8" fill="none" />
        <circle
          cx="44"
          cy="44"
          r={r}
          stroke="#0b3d2e"
          strokeWidth="8"
          fill="none"
          strokeDasharray={c}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      <div>
        <p className="text-xs uppercase tracking-wider text-ink/50">{label}</p>
        <p className="font-display text-3xl font-bold text-forest">
          {total}
          <span className="ml-1 text-base text-gold">/{grade}</span>
        </p>
        {provisional && (
          <p className="mt-0.5 text-[10px] font-bold uppercase tracking-wide text-clay">{provisionalLabel}</p>
        )}
      </div>
    </div>
  )
}
