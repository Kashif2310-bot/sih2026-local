import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import {
  ArrowLeft,
  BadgeCheck,
  Bus,
  MapPin,
  ShieldCheck,
  Users,
} from 'lucide-react'
import { BrandLogo } from '../components/BrandLogo'
import { VILLAGES } from '../data/villages'
import {
  SEED_JOBS,
  SKILLS,
  createPostedJob,
  distanceKm,
  inr,
  prepareJobs,
  skillLabel,
  villageById,
  wageOf,
  type JobOpening,
  type JobRail,
  type JobSort,
  type PreparedJob,
  type SkillId,
  type Wage,
  type Workplace,
} from '../jobs/model'
import { addInterest, loadStore, saveStore, type Interest, type JobsStore } from '../jobs/storage'

function tx(kn: boolean, en: string, knText: string) {
  return kn ? knText : en
}

function placeOf(job: JobOpening, kn: boolean) {
  const village = villageById(job.villageId)
  const villageName = village ? (kn ? village.nameKn : village.name) : ''
  const district = village ? (kn ? village.districtKn : village.district) : ''
  if (job.workplace === 'city') {
    const city = kn ? job.cityKn || job.city : job.city
    return tx(kn, `${city} · employer from ${villageName}`, `${city} · ${villageName}ನ ಉದ್ಯಮಿ`)
  }
  return district ? `${villageName}, ${district}` : villageName
}

function reachOf(job: JobOpening, km: number, kn: boolean) {
  if (job.workplace === 'city') {
    const city = kn ? job.cityKn || job.city : job.city
    return tx(kn, `Bus to ${city}`, `${city}ಗೆ ಬಸ್`)
  }
  if (km <= 1) return tx(kn, 'In your village', 'ನಿಮ್ಮ ಗ್ರಾಮದಲ್ಲೇ')
  return tx(kn, `About ${km} km from you`, `ನಿಮ್ಮಿಂದ ಸುಮಾರು ${km} ಕಿ.ಮೀ`)
}

function whenLabel(days: number, kn: boolean) {
  if (days <= 0) return tx(kn, 'Starts today', 'ಇಂದು ಆರಂಭ')
  if (days === 1) return tx(kn, 'Starts tomorrow', 'ನಾಳೆ ಆರಂಭ')
  return tx(kn, `Starts in ${days} days`, `${days} ದಿನದಲ್ಲಿ ಆರಂಭ`)
}

function spanLabel(days: number, kn: boolean) {
  if (days >= 24) return tx(kn, 'this month', 'ಈ ತಿಂಗಳು')
  return tx(kn, `these ${days} days`, `ಈ ${days} ದಿನಕ್ಕೆ`)
}

function textOf(job: JobOpening, kn: boolean, field: 'title' | 'work' | 'meet' | 'employer') {
  if (field === 'title') return kn ? job.titleKn : job.title
  if (field === 'work') return kn ? job.workKn : job.work
  if (field === 'meet') return kn ? job.meetKn : job.meet
  return kn ? job.employerKn : job.employer
}

function WageLock({
  kn,
  employer,
  title,
  dailyWage,
  days,
  inHand,
  agentWouldKeep,
  at,
}: {
  kn: boolean
  employer: string
  title: string
  dailyWage: number
  days: number
  inHand: number
  agentWouldKeep: number
  at?: string
}) {
  const when = at
    ? new Intl.DateTimeFormat(kn ? 'kn-IN' : 'en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      }).format(new Date(at))
    : null
  return (
    <div className="rounded-2xl bg-black p-4 text-white" data-testid="wage-lock">
      <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/50">
        {tx(kn, 'Ishara wage lock', 'ಇಶಾರಾ ಕೂಲಿ ಲಾಕ್')}
      </p>
      <p className="mt-2 font-display text-lg font-bold leading-snug">
        {title} · {employer}
      </p>
      <p className="mt-3 font-display text-3xl font-bold">{inr(inHand)}</p>
      <p className="text-sm text-white/70">
        {tx(kn, `${inr(dailyWage)} a day × ${days} days, in your hand`, `ದಿನಕ್ಕೆ ${inr(dailyWage)} × ${days} ದಿನ, ನಿಮ್ಮ ಕೈಯಲ್ಲಿ`)}
      </p>
      <p className="mt-2 text-sm text-white/70">
        {tx(
          kn,
          `An agent would have kept ${inr(agentWouldKeep)}. Joining fee ₹0.`,
          `ಏಜೆಂಟ್ ${inr(agentWouldKeep)} ಇಟ್ಟುಕೊಳ್ಳುತ್ತಿದ್ದರು. ಸೇರುವ ಶುಲ್ಕ ₹0.`,
        )}
      </p>
      {when && <p className="mt-3 text-xs text-white/45">{when}</p>}
      <p className="mt-3 border-t border-white/15 pt-3 text-xs leading-relaxed text-white/70">
        {tx(
          kn,
          'This is the wage you agreed. If someone asks you to pay them to keep this job, do not pay.',
          'ನೀವು ಒಪ್ಪಿದ ಕೂಲಿ ಇದು. ಈ ಕೆಲಸ ಉಳಿಸಿಕೊಳ್ಳಲು ಯಾರಾದರೂ ಹಣ ಕೇಳಿದರೆ, ಕೊಡಬೇಡಿ.',
        )}
      </p>
    </div>
  )
}

function Breakdown({ kn, job, pay }: { kn: boolean; job: JobOpening; pay: Wage }) {
  const lines: { label: string; value: number; minus?: boolean }[] = [
    { label: tx(kn, `${inr(job.dailyWage)} × ${job.days} days`, `${inr(job.dailyWage)} × ${job.days} ದಿನ`), value: pay.gross },
  ]
  if (pay.bus) lines.push({ label: tx(kn, 'Bus, both ways', 'ಬಸ್, ಹೋಗಿ ಬರಲು'), value: pay.bus, minus: true })
  if (pay.room) lines.push({ label: tx(kn, 'Room', 'ಕೋಣೆ'), value: pay.room, minus: true })
  if (pay.food) lines.push({ label: tx(kn, 'Food, if you buy it', 'ಊಟ, ನೀವೇ ತೆಗೆದುಕೊಂಡರೆ'), value: pay.food, minus: true })
  if (pay.localTravel) lines.push({ label: tx(kn, 'Auto to the worksite', 'ಕೆಲಸದ ಜಾಗಕ್ಕೆ ಆಟೋ'), value: pay.localTravel, minus: true })
  if (job.channel === 'agent') {
    lines.push({ label: tx(kn, 'Agent’s cut of the wage', 'ಕೂಲಿಯ ಮೇಲಿನ ಏಜೆಂಟ್ ಕಟ್'), value: pay.agentCut, minus: true })
    if (pay.joiningFee) lines.push({ label: tx(kn, 'Fee before you start', 'ಆರಂಭಕ್ಕೆ ಮುನ್ನ ಶುಲ್ಕ'), value: pay.joiningFee, minus: true })
  }
  return (
    <div className="rounded-2xl border border-black/10 bg-white">
      <ul className="divide-y divide-black/10 text-sm">
        {lines.map((line) => (
          <li key={line.label} className="flex items-baseline justify-between gap-3 px-3 py-2">
            <span className="text-ink/70">{line.label}</span>
            <span className={clsx('font-semibold tabular-nums', line.minus && 'text-ink/55')}>
              {line.minus ? `−${inr(line.value)}` : inr(line.value)}
            </span>
          </li>
        ))}
      </ul>
      <div className="flex items-baseline justify-between gap-3 border-t border-black px-3 py-3">
        <span className="text-sm font-semibold">{tx(kn, 'In your hand', 'ನಿಮ್ಮ ಕೈಯಲ್ಲಿ')}</span>
        <span className="font-display text-2xl font-bold tabular-nums">{inr(pay.inHand)}</span>
      </div>
    </div>
  )
}

function PayPath({ kn, job, pay }: { kn: boolean; job: JobOpening; pay: Wage }) {
  const direct = job.channel === 'direct'
  return (
    <div className="space-y-2 text-sm">
      <div className={clsx('flex items-center gap-2', !direct && 'opacity-40')}>
        <span className="rounded-xl border border-black/15 px-3 py-2">{textOf(job, kn, 'employer')}</span>
        <span className="text-ink/40" aria-hidden>
          →
        </span>
        <span className="rounded-xl bg-black px-3 py-2 font-semibold text-white">{tx(kn, 'You', 'ನೀವು')}</span>
        <span className="ml-auto font-semibold tabular-nums">{inr(pay.directHand)}</span>
      </div>
      <div className={clsx('flex items-center gap-2', direct && 'line-through decoration-ink/30 opacity-50')}>
        <span className="rounded-xl border border-black/15 px-3 py-2">{textOf(job, kn, 'employer')}</span>
        <span className="text-ink/40" aria-hidden>
          →
        </span>
        <span className="rounded-xl border border-dashed border-black/30 px-3 py-2">{tx(kn, 'Agent', 'ಏಜೆಂಟ್')}</span>
        <span className="text-ink/40" aria-hidden>
          →
        </span>
        <span className="rounded-xl border border-black/15 px-3 py-2">{tx(kn, 'You', 'ನೀವು')}</span>
        <span className="ml-auto font-semibold tabular-nums">{inr(pay.agentHand)}</span>
      </div>
      <p className="text-xs leading-relaxed text-ink/55">
        {direct
          ? tx(
              kn,
              `The second path is what usually happens. On this job it does not. The agent’s ${inr(pay.agentKeeps)} stays with you.`,
              `ಎರಡನೇ ದಾರಿ ಸಾಮಾನ್ಯವಾಗಿ ನಡೆಯುವುದು. ಈ ಕೆಲಸದಲ್ಲಿ ಅಲ್ಲ. ಏಜೆಂಟ್‌ನ ${inr(pay.agentKeeps)} ನಿಮ್ಮ ಬಳಿಯೇ ಉಳಿಯುತ್ತದೆ.`,
            )
          : tx(
              kn,
              'This listing is the second path. Ishara will not send you down it.',
              'ಈ ಪಟ್ಟಿ ಎರಡನೇ ದಾರಿ. ಇಶಾರಾ ನಿಮ್ಮನ್ನು ಆ ದಾರಿಯಲ್ಲಿ ಕಳುಹಿಸುವುದಿಲ್ಲ.',
            )}
      </p>
    </div>
  )
}

function JobDetail({
  kn,
  row,
  profileName,
  profilePhone,
  sent,
  onSend,
}: {
  kn: boolean
  row: PreparedJob
  profileName: string
  profilePhone: string
  sent: Interest | null
  onSend: (row: PreparedJob) => string | null
}) {
  const { job, pay } = row
  const direct = job.channel === 'direct'
  const [error, setError] = useState<string | null>(null)
  const languages = kn ? job.languagesKn : job.languages

  return (
    <div id="job-detail" className="rounded-[1.5rem] border border-black/10 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        {direct ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-black px-2.5 py-1 text-[11px] font-semibold text-white">
            <BadgeCheck className="h-3.5 w-3.5" />
            {tx(kn, 'Ishara entrepreneur', 'ಇಶಾರಾ ಉದ್ಯಮಿ')}
          </span>
        ) : (
          <span className="rounded-full border border-danger/40 px-2.5 py-1 text-[11px] font-semibold text-danger">
            {tx(kn, 'Agent listing', 'ಏಜೆಂಟ್ ಪಟ್ಟಿ')}
          </span>
        )}
        <span className="text-xs text-ink/50">{whenLabel(job.startsInDays, kn)}</span>
      </div>
      <h2 className="mt-3 font-display text-2xl font-bold tracking-tight">{textOf(job, kn, 'title')}</h2>
      <p className="mt-1 text-sm text-ink/70">
        {textOf(job, kn, 'employer')} · {placeOf(job, kn)}
      </p>

      <div className="mt-4">
        <Breakdown kn={kn} job={job} pay={pay} />
      </div>

      {pay.realDaily !== job.dailyWage && (
        <p className="mt-3 text-sm leading-relaxed text-ink/75">
          {tx(
            kn,
            `In your hand, a day of this is ${inr(pay.realDaily)}. The ${inr(job.dailyWage)} is the number before ${direct ? 'bus, room, or food' : 'the agent'}.`,
            `ನಿಮ್ಮ ಕೈಯಲ್ಲಿ ಈ ಕೆಲಸದ ಒಂದು ದಿನ ${inr(pay.realDaily)}. ${inr(job.dailyWage)} ಎಂಬುದು ${direct ? 'ಬಸ್, ಕೋಣೆ ಅಥವಾ ಊಟಕ್ಕೆ ಮುನ್ನ' : 'ಏಜೆಂಟ್‌ಗೆ ಮುನ್ನ'} ಅಂಕಿ.`,
          )}
        </p>
      )}

      <div className="mt-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-ink/45">
          {tx(kn, 'Where the money goes', 'ಹಣ ಎಲ್ಲಿಗೆ ಹೋಗುತ್ತದೆ')}
        </p>
        <PayPath kn={kn} job={job} pay={pay} />
      </div>

      <p className="mt-4 text-sm leading-relaxed text-ink/80">{textOf(job, kn, 'work')}</p>

      <div className="mt-4 space-y-2 rounded-2xl bg-mist/80 p-3 text-sm">
        <p className="flex gap-2">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{textOf(job, kn, 'meet')}</span>
        </p>
        {job.workplace === 'city' && (
          <p className="flex gap-2">
            <Bus className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              {job.stayIncluded
                ? tx(kn, 'Stay is on the site. No rent.', 'ತಂಗುವಿಕೆ ಕೆಲಸದ ಜಾಗದಲ್ಲೇ. ಬಾಡಿಗೆ ಇಲ್ಲ.')
                : tx(kn, `Room is ${inr(job.roomPerMonth)} if you arrange it.`, `ನೀವೇ ನೋಡಿಕೊಂಡರೆ ಕೋಣೆ ${inr(job.roomPerMonth)}.`)}
              {' '}
              {job.foodIncluded
                ? tx(kn, 'Meals are included.', 'ಊಟ ಸೇರಿದೆ.')
                : tx(kn, `Food is about ${inr(job.foodPerMonth)} if you buy it.`, `ನೀವೇ ತೆಗೆದುಕೊಂಡರೆ ಊಟ ಸುಮಾರು ${inr(job.foodPerMonth)}.`)}
            </span>
          </p>
        )}
        {job.foodIncluded && job.workplace === 'village' && (
          <p>{tx(kn, 'Meals are included.', 'ಊಟ ಸೇರಿದೆ.')}</p>
        )}
        {job.crew > 1 && (
          <p className="flex gap-2">
            <Users className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              {tx(
                kn,
                `Bring up to ${job.crew} people from your village on this one interest. None of you pay an agent.`,
                `ಈ ಒಂದೇ ಆಸಕ್ತಿಯಲ್ಲಿ ನಿಮ್ಮ ಗ್ರಾಮದಿಂದ ${job.crew} ಜನರವರೆಗೆ ಕರೆತನ್ನಿ. ಯಾರೂ ಏಜೆಂಟ್‌ಗೆ ಹಣ ಕೊಡುವುದಿಲ್ಲ.`,
              )}
            </span>
          </p>
        )}
        <p className="text-ink/70">
          {tx(kn, 'They speak', 'ಅವರು ಮಾತನಾಡುವುದು')}: {languages.join(', ')}
          {' · '}
          {job.cadence === 'daily'
            ? tx(kn, 'paid each day', 'ಪ್ರತಿ ದಿನ ಕೂಲಿ')
            : tx(kn, 'paid each week', 'ಪ್ರತಿ ವಾರ ಕೂಲಿ')}
          {' · '}
          {tx(
            kn,
            `${job.seats} ${job.seats === 1 ? 'seat' : 'seats'}`,
            `${job.seats} ಸ್ಥಾನ`,
          )}
          {job.womenWelcome ? tx(kn, ' · open to women', ' · ಮಹಿಳೆಯರಿಗೆ ತೆರೆದಿದೆ') : ''}
        </p>
        <p className="text-ink/70">
          {pay.belowUsual
            ? tx(
                kn,
                `This is under the usual pay for this work (${inr(job.usualDaily)} a day, with no agent).`,
                `ಈ ಕೆಲಸದ ಸಾಮಾನ್ಯ ಕೂಲಿಗಿಂತ ಇದು ಕಡಿಮೆ (ಏಜೆಂಟ್ ಇಲ್ಲದೆ ದಿನಕ್ಕೆ ${inr(job.usualDaily)}).`,
              )
            : tx(
                kn,
                `Usual pay for this work, with no agent: ${inr(job.usualDaily)} a day. This job meets it.`,
                `ಏಜೆಂಟ್ ಇಲ್ಲದೆ ಈ ಕೆಲಸದ ಸಾಮಾನ್ಯ ಕೂಲಿ: ದಿನಕ್ಕೆ ${inr(job.usualDaily)}. ಈ ಕೆಲಸ ಅದನ್ನು ತಲುಪುತ್ತದೆ.`,
              )}
        </p>
      </div>

      <div className="mt-4">
        {sent ? (
          <WageLock
            kn={kn}
            employer={sent.employer}
            title={sent.title}
            dailyWage={sent.dailyWage}
            days={sent.days}
            inHand={sent.inHand}
            agentWouldKeep={sent.agentWouldKeep}
            at={sent.at}
          />
        ) : direct ? (
          <div>
            <button
              type="button"
              data-testid="send-interest"
              onClick={() => setError(onSend(row))}
              className="inline-flex w-full items-center justify-center rounded-full bg-black px-5 py-3 text-sm font-bold text-white transition hover:bg-black/85"
            >
              {tx(kn, 'Send my name and number', 'ನನ್ನ ಹೆಸರು ಮತ್ತು ಸಂಖ್ಯೆ ಕಳುಹಿಸಿ')}
            </button>
            <p className="mt-2 text-xs leading-relaxed text-ink/50">
              {profileName.trim() && profilePhone.length === 10
                ? tx(
                    kn,
                    `${profileName.trim()} · ${profilePhone}. This goes to ${textOf(job, kn, 'employer')} — no one is paid to connect you.`,
                    `${profileName.trim()} · ${profilePhone}. ಇದು ${textOf(job, kn, 'employer')} ಅವರಿಗೆ ಹೋಗುತ್ತದೆ — ನಿಮ್ಮನ್ನು ಜೋಡಿಸಲು ಯಾರಿಗೂ ಹಣ ಸಿಗುವುದಿಲ್ಲ.`,
                  )
                : tx(
                    kn,
                    'Add your name and a 10-digit mobile above first. The employer calls you. An agent does not.',
                    'ಮೇಲೆ ಮೊದಲು ನಿಮ್ಮ ಹೆಸರು ಮತ್ತು 10 ಅಂಕಿಯ ಮೊಬೈಲ್ ಸೇರಿಸಿ. ಉದ್ಯಮಿ ನಿಮಗೆ ಕರೆ ಮಾಡುತ್ತಾರೆ. ಏಜೆಂಟ್ ಅಲ್ಲ.',
                  )}
            </p>
            {error && <p className="mt-2 text-sm text-danger">{error}</p>}
          </div>
        ) : (
          <p className="rounded-2xl border border-danger/30 bg-white px-3 py-3 text-sm leading-relaxed text-danger">
            {tx(
              kn,
              'Ishara does not send you to an agent. This card is only here so you can see what he keeps.',
              'ಇಶಾರಾ ನಿಮ್ಮನ್ನು ಏಜೆಂಟ್ ಬಳಿ ಕಳುಹಿಸುವುದಿಲ್ಲ. ಅವನು ಎಷ್ಟು ಇಟ್ಟುಕೊಳ್ಳುತ್ತಾನೆ ಎಂದು ನೋಡಲು ಮಾತ್ರ ಈ ಕಾರ್ಡ್ ಇಲ್ಲಿದೆ.',
            )}
          </p>
        )}
      </div>
    </div>
  )
}

function JobCard({
  kn,
  row,
  selected,
  compared,
  onSelect,
  onCompare,
}: {
  kn: boolean
  row: PreparedJob
  selected: boolean
  compared: boolean
  onSelect: () => void
  onCompare: () => void
}) {
  const { job, pay, km, match } = row
  const direct = job.channel === 'direct'
  return (
    <article
      data-testid="job-card"
      data-job-id={job.id}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
      className={clsx(
        'cursor-pointer rounded-[1.5rem] border bg-white p-4 text-left shadow-sm transition sm:p-5',
        direct ? 'border-black/10' : 'border-dashed border-danger/40',
        selected && 'ring-2 ring-black',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink/45">
            {direct ? tx(kn, 'Direct · no agent', 'ನೇರ · ಏಜೆಂಟ್ ಇಲ್ಲ') : tx(kn, 'Agent · do not apply', 'ಏಜೆಂಟ್ · ಅರ್ಜಿ ಬೇಡ')}
          </p>
          <h3 className="mt-1 font-display text-xl font-bold tracking-tight">{textOf(job, kn, 'title')}</h3>
          <p className="mt-0.5 text-sm text-ink/65">
            {textOf(job, kn, 'employer')} · {placeOf(job, kn)}
          </p>
        </div>
        {match !== null && (
          <span className="shrink-0 rounded-full bg-mist px-2.5 py-1 text-xs font-bold text-ink">
            {tx(kn, `${match}% fit`, `${match}% ಹೊಂದಾಣಿಕೆ`)}
          </span>
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div>
          <p className="font-display text-3xl font-bold tabular-nums tracking-tight" data-testid="wage-in-hand">
            {inr(pay.inHand)}
          </p>
          <p className="text-xs text-ink/55">
            {direct
              ? tx(kn, `in your hand ${spanLabel(job.days, kn)}`, `${spanLabel(job.days, kn)} ನಿಮ್ಮ ಕೈಯಲ್ಲಿ`)
              : tx(kn, `left after the agent, ${spanLabel(job.days, kn)}`, `${spanLabel(job.days, kn)} ಏಜೆಂಟ್ ನಂತರ ಉಳಿಯುವುದು`)}
          </p>
        </div>
        <div className="border-l border-black/10 pl-3">
          <p className="font-display text-2xl font-bold tabular-nums text-ink/35">{inr(pay.agentKeeps)}</p>
          <p className="text-xs text-ink/45">
            {direct ? tx(kn, 'an agent would keep', 'ಏಜೆಂಟ್ ಇಟ್ಟುಕೊಳ್ಳುತ್ತಿದ್ದದ್ದು') : tx(kn, 'the agent keeps', 'ಏಜೆಂಟ್ ಇಟ್ಟುಕೊಳ್ಳುವುದು')}
          </p>
        </div>
      </div>

      {pay.realDaily !== job.dailyWage && (
        <p className="mt-3 text-sm text-ink/70">
          {tx(
            kn,
            `Advertised ${inr(job.dailyWage)} a day. A day in your hand is ${inr(pay.realDaily)}.`,
            `ಜಾಹೀರಾತು ದಿನಕ್ಕೆ ${inr(job.dailyWage)}. ನಿಮ್ಮ ಕೈಯಲ್ಲಿ ಒಂದು ದಿನ ${inr(pay.realDaily)}.`,
          )}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-1.5">
        <span className="inline-flex items-center gap-1 rounded-full bg-mist px-2.5 py-1 text-[11px] font-semibold">
          <MapPin className="h-3 w-3" /> {reachOf(job, km, kn)}
        </span>
        {direct && (
          <span className="inline-flex items-center gap-1 rounded-full bg-mist px-2.5 py-1 text-[11px] font-semibold">
            <ShieldCheck className="h-3 w-3" /> {tx(kn, '₹0 to join', 'ಸೇರಲು ₹0')}
          </span>
        )}
        <span className="rounded-full bg-mist px-2.5 py-1 text-[11px] font-semibold">{whenLabel(job.startsInDays, kn)}</span>
        {job.crew > 1 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-mist px-2.5 py-1 text-[11px] font-semibold">
            <Users className="h-3 w-3" /> {tx(kn, `Crew of ${job.crew}`, `${job.crew} ಜನರ ತಂಡ`)}
          </span>
        )}
        {job.stayIncluded && (
          <span className="rounded-full bg-mist px-2.5 py-1 text-[11px] font-semibold">{tx(kn, 'Stay included', 'ತಂಗುವಿಕೆ ಸೇರಿದೆ')}</span>
        )}
      </div>

      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onCompare()
          }}
          className={clsx(
            'rounded-full border px-3 py-1.5 text-xs font-bold transition',
            compared ? 'border-black bg-black text-white' : 'border-black/15 text-ink hover:border-black',
          )}
        >
          {compared ? tx(kn, 'In compare', 'ಹೋಲಿಕೆಯಲ್ಲಿ') : tx(kn, 'Compare', 'ಹೋಲಿಸಿ')}
        </button>
      </div>
    </article>
  )
}

function HireDesk({
  kn,
  store,
  onPublish,
}: {
  kn: boolean
  store: JobsStore
  onPublish: (job: JobOpening) => void
}) {
  const [employer, setEmployer] = useState('')
  const [villageId, setVillageId] = useState(store.profile.villageId)
  const [skill, setSkill] = useState<SkillId>('paneer')
  const [dailyWage, setDailyWage] = useState(650)
  const [seats, setSeats] = useState(1)
  const [days, setDays] = useState(26)
  const [workplace, setWorkplace] = useState<Workplace>('village')
  const [city, setCity] = useState('')
  const [busFare, setBusFare] = useState(200)
  const [stayIncluded, setStayIncluded] = useState(false)
  const [foodIncluded, setFoodIncluded] = useState(false)
  const [womenWelcome, setWomenWelcome] = useState(true)
  const [crew, setCrew] = useState(1)
  const [work, setWork] = useState('')
  const [error, setError] = useState<string | null>(null)

  const field = 'mt-1 w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm outline-none ring-black/20 focus:ring-2'

  const publish = (e: FormEvent) => {
    e.preventDefault()
    if (employer.trim().length < 2) {
      setError(tx(kn, 'Put the employer’s name.', 'ಉದ್ಯಮಿಯ ಹೆಸರು ಹಾಕಿ.'))
      return
    }
    if (!Number.isFinite(dailyWage) || dailyWage < 200 || dailyWage > 5000) {
      setError(tx(kn, 'Daily wage should be between ₹200 and ₹5,000.', 'ದಿನದ ಕೂಲಿ ₹200 ಮತ್ತು ₹5,000 ನಡುವೆ ಇರಬೇಕು.'))
      return
    }
    if (workplace === 'city' && city.trim().length < 2) {
      setError(tx(kn, 'Name the city.', 'ನಗರದ ಹೆಸರು ಹಾಕಿ.'))
      return
    }
    if (work.trim().length < 8) {
      setError(tx(kn, 'Say what the person will actually do.', 'ಆ ವ್ಯಕ್ತಿ ನಿಜವಾಗಿ ಏನು ಮಾಡುತ್ತಾನೆ ಎಂದು ಬರೆಯಿರಿ.'))
      return
    }
    setError(null)
    onPublish(
      createPostedJob({
        employer,
        villageId,
        skill,
        dailyWage: Math.round(dailyWage),
        seats: Math.min(20, Math.max(1, Math.round(seats))),
        days: Math.min(31, Math.max(1, Math.round(days))),
        workplace,
        city,
        busFare: Math.max(0, Math.round(busFare)),
        stayIncluded,
        foodIncluded,
        work,
        womenWelcome,
        crew: Math.min(12, Math.max(1, Math.round(crew))),
      }),
    )
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <form onSubmit={publish} className="rounded-[1.5rem] border border-black/10 bg-white p-5 shadow-sm">
        <h2 className="font-display text-xl font-bold">{tx(kn, 'Open a role', 'ಒಂದು ಕೆಲಸ ತೆರೆಯಿರಿ')}</h2>
        <p className="mt-1 text-sm leading-relaxed text-ink/60">
          {tx(
            kn,
            'It goes straight into search. The wage you type is the wage the worker keeps. Ishara does not add a cut.',
            'ಅದು ನೇರವಾಗಿ ಹುಡುಕಾಟಕ್ಕೆ ಹೋಗುತ್ತದೆ. ನೀವು ಬರೆಯುವ ಕೂಲಿಯನ್ನೇ ಕೆಲಸಗಾರ ಇಟ್ಟುಕೊಳ್ಳುತ್ತಾನೆ. ಇಶಾರಾ ಕಟ್ ಸೇರಿಸುವುದಿಲ್ಲ.',
          )}
        </p>
        <label className="mt-4 block text-sm font-semibold">
          {tx(kn, 'Your name', 'ನಿಮ್ಮ ಹೆಸರು')}
          <input className={field} value={employer} onChange={(e) => setEmployer(e.target.value)} />
        </label>
        <label className="mt-3 block text-sm font-semibold">
          {tx(kn, 'Your village', 'ನಿಮ್ಮ ಗ್ರಾಮ')}
          <select className={field} value={villageId} onChange={(e) => setVillageId(e.target.value)}>
            {VILLAGES.map((v) => (
              <option key={v.id} value={v.id}>
                {kn ? `${v.nameKn}, ${v.districtKn}` : `${v.name}, ${v.district}`}
              </option>
            ))}
          </select>
        </label>
        <label className="mt-3 block text-sm font-semibold">
          {tx(kn, 'The work', 'ಕೆಲಸ')}
          <select className={field} value={skill} onChange={(e) => setSkill(e.target.value as SkillId)}>
            {SKILLS.map((s) => (
              <option key={s.id} value={s.id}>
                {kn ? s.kn : s.en}
              </option>
            ))}
          </select>
        </label>
        <label className="mt-3 block text-sm font-semibold">
          {tx(kn, 'What they will do', 'ಅವರು ಏನು ಮಾಡುತ್ತಾರೆ')}
          <textarea className={field} rows={3} value={work} onChange={(e) => setWork(e.target.value)} />
        </label>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <label className="text-sm font-semibold">
            {tx(kn, '₹ / day', '₹ / ದಿನ')}
            <input className={field} type="number" min={200} max={5000} value={dailyWage} onChange={(e) => setDailyWage(Number(e.target.value))} />
          </label>
          <label className="text-sm font-semibold">
            {tx(kn, 'Days', 'ದಿನ')}
            <input className={field} type="number" min={1} max={31} value={days} onChange={(e) => setDays(Number(e.target.value))} />
          </label>
          <label className="text-sm font-semibold">
            {tx(kn, 'People', 'ಜನ')}
            <input className={field} type="number" min={1} max={20} value={seats} onChange={(e) => setSeats(Number(e.target.value))} />
          </label>
        </div>
        <fieldset className="mt-4">
          <legend className="text-sm font-semibold">{tx(kn, 'Where', 'ಎಲ್ಲಿ')}</legend>
          <div className="mt-2 flex gap-2">
            {(['village', 'city'] as const).map((place) => (
              <button
                key={place}
                type="button"
                onClick={() => setWorkplace(place)}
                className={clsx(
                  'rounded-full px-3 py-1.5 text-sm font-semibold',
                  workplace === place ? 'bg-black text-white' : 'bg-mist text-ink',
                )}
              >
                {place === 'village' ? tx(kn, 'Near my village', 'ನನ್ನ ಗ್ರಾಮದ ಹತ್ತಿರ') : tx(kn, 'A city', 'ಒಂದು ನಗರ')}
              </button>
            ))}
          </div>
        </fieldset>
        {workplace === 'city' && (
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <label className="text-sm font-semibold">
              {tx(kn, 'City', 'ನಗರ')}
              <input className={field} value={city} onChange={(e) => setCity(e.target.value)} />
            </label>
            <label className="text-sm font-semibold">
              {tx(kn, 'Bus fare, one way', 'ಬಸ್ ದರ, ಒಂದು ದಾರಿ')}
              <input className={field} type="number" min={0} value={busFare} onChange={(e) => setBusFare(Number(e.target.value))} />
            </label>
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-3 text-sm">
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={womenWelcome} onChange={(e) => setWomenWelcome(e.target.checked)} />
            {tx(kn, 'Open to women', 'ಮಹಿಳೆಯರಿಗೆ ತೆರೆದಿದೆ')}
          </label>
          {workplace === 'city' && (
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={stayIncluded} onChange={(e) => setStayIncluded(e.target.checked)} />
              {tx(kn, 'Stay included', 'ತಂಗುವಿಕೆ ಸೇರಿದೆ')}
            </label>
          )}
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={foodIncluded} onChange={(e) => setFoodIncluded(e.target.checked)} />
            {tx(kn, 'Meals included', 'ಊಟ ಸೇರಿದೆ')}
          </label>
          <label className="inline-flex items-center gap-2">
            {tx(kn, 'Crew size', 'ತಂಡದ ಗಾತ್ರ')}
            <input
              className="w-16 rounded-lg border border-black/15 px-2 py-1"
              type="number"
              min={1}
              max={12}
              value={crew}
              onChange={(e) => setCrew(Number(e.target.value))}
            />
          </label>
        </div>
        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
        <button type="submit" className="mt-4 inline-flex rounded-full bg-black px-5 py-3 text-sm font-bold text-white">
          {tx(kn, 'Put this job in search', 'ಈ ಕೆಲಸವನ್ನು ಹುಡುಕಾಟಕ್ಕೆ ಹಾಕಿ')}
        </button>
      </form>

      <div className="space-y-3">
        <h2 className="font-display text-xl font-bold">{tx(kn, 'People who sent interest', 'ಆಸಕ್ತಿ ಕಳುಹಿಸಿದವರು')}</h2>
        {store.interests.length === 0 ? (
          <p className="rounded-2xl border border-black/10 bg-white p-4 text-sm leading-relaxed text-ink/65">
            {tx(
              kn,
              'No one yet. When a worker sends their name, it lands here with the wage already locked — not with an agent.',
              'ಇನ್ನೂ ಯಾರೂ ಇಲ್ಲ. ಕೆಲಸಗಾರ ಹೆಸರು ಕಳುಹಿಸಿದಾಗ, ಕೂಲಿ ಈಗಾಗಲೇ ಲಾಕ್ ಆಗಿ ಅದು ಇಲ್ಲಿಗೆ ಬರುತ್ತದೆ — ಏಜೆಂಟ್ ಬಳಿಗಲ್ಲ.',
            )}
          </p>
        ) : (
          store.interests.map((interest) => (
            <div key={interest.id} className="space-y-2 rounded-2xl border border-black/10 bg-white p-4">
              <p className="text-sm font-semibold">
                {interest.name} · {interest.phone}
              </p>
              <p className="text-xs text-ink/55">
                {tx(kn, 'Asked for', 'ಕೇಳಿದ ಕೆಲಸ')}: {interest.title} · {interest.employer}
              </p>
              <WageLock
                kn={kn}
                employer={interest.employer}
                title={interest.title}
                dailyWage={interest.dailyWage}
                days={interest.days}
                inHand={interest.inHand}
                agentWouldKeep={interest.agentWouldKeep}
                at={interest.at}
              />
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export function JobsPage() {
  const { i18n } = useTranslation()
  const kn = i18n.language === 'kn'
  const [store, setStore] = useState<JobsStore>(() => loadStore())
  const [mode, setMode] = useState<'work' | 'hire'>('work')
  const [rail, setRail] = useState<JobRail>('near')
  const [sort, setSort] = useState<JobSort>('pay')
  const [womenOnly, setWomenOnly] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>('paneer-dinka')
  const [compare, setCompare] = useState<string[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [wide, setWide] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(min-width: 1024px)').matches : false,
  )

  useEffect(() => {
    saveStore(store)
  }, [store])

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    const apply = () => setWide(mq.matches)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])

  const jobs = useMemo(() => [...store.posted, ...SEED_JOBS], [store.posted])
  const rows = useMemo(
    () =>
      prepareJobs(jobs, {
        skills: store.profile.skills,
        rail,
        villageId: store.profile.villageId,
        sort,
        womenOnly,
      }),
    [jobs, store.profile.skills, store.profile.villageId, rail, sort, womenOnly],
  )
  const selected = rows.find((row) => row.job.id === selectedId) ?? rows[0] ?? null
  const protectedSum = rows
    .filter((row) => row.job.channel === 'direct')
    .reduce((sum, row) => sum + row.pay.protectedRupees, 0)
  const best = rows.filter((row) => row.job.channel === 'direct').reduce<PreparedJob | null>((top, row) => {
    if (!top || row.pay.inHand > top.pay.inHand) return row
    return top
  }, null)

  const compared = compare
    .map((id) => jobs.find((job) => job.id === id))
    .filter((job): job is JobOpening => Boolean(job))
    .map((job) => ({ job, pay: wageOf(job), km: distanceKm(job, store.profile.villageId) }))

  const toggleSkill = (id: SkillId) => {
    setStore((current) => {
      const has = current.profile.skills.includes(id)
      const skills = has ? current.profile.skills.filter((skill) => skill !== id) : [...current.profile.skills, id]
      return { ...current, profile: { ...current.profile, skills } }
    })
  }

  const send = (row: PreparedJob) => {
    const name = store.profile.name.trim()
    const phone = store.profile.phone
    if (name.length < 2) return tx(kn, 'Add your name above.', 'ಮೇಲೆ ನಿಮ್ಮ ಹೆಸರು ಸೇರಿಸಿ.')
    if (!/^\d{10}$/.test(phone)) return tx(kn, 'Add a 10-digit mobile above.', 'ಮೇಲೆ 10 ಅಂಕಿಯ ಮೊಬೈಲ್ ಸೇರಿಸಿ.')
    if (store.interests.some((item) => item.jobId === row.job.id && item.phone === phone)) {
      return tx(kn, 'You already sent interest for this job.', 'ಈ ಕೆಲಸಕ್ಕೆ ನೀವು ಈಗಾಗಲೇ ಆಸಕ್ತಿ ಕಳುಹಿಸಿದ್ದೀರಿ.')
    }
    setStore((current) =>
      addInterest(current, {
        jobId: row.job.id,
        employer: textOf(row.job, kn, 'employer'),
        title: textOf(row.job, kn, 'title'),
        dailyWage: row.job.dailyWage,
        days: row.job.days,
        inHand: row.pay.inHand,
        agentWouldKeep: row.pay.agentKeeps,
        channel: row.job.channel,
        name,
        phone,
        villageId: current.profile.villageId,
      }),
    )
    setNotice(
      tx(
        kn,
        `${textOf(row.job, kn, 'employer')} has your number. The wage stays ${inr(row.job.dailyWage)} a day.`,
        `${textOf(row.job, kn, 'employer')} ಅವರ ಬಳಿ ನಿಮ್ಮ ಸಂಖ್ಯೆ ಇದೆ. ಕೂಲಿ ದಿನಕ್ಕೆ ${inr(row.job.dailyWage)} ಆಗಿಯೇ ಉಳಿಯುತ್ತದೆ.`,
      ),
    )
    return null
  }

  const sentFor = (jobId: string) =>
    store.interests.find((item) => item.jobId === jobId && item.phone === store.profile.phone && store.profile.phone.length === 10) ??
    null

  const toggleCompare = (id: string) => {
    setCompare((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id)
      if (current.length >= 2) return [current[1], id]
      return [...current, id]
    })
  }

  const chip = (on: boolean) =>
    clsx(
      'rounded-full px-3 py-2 text-sm font-semibold transition',
      on ? 'bg-black text-white' : 'bg-white text-ink ring-1 ring-black/10 hover:ring-black/30',
    )

  return (
    <div className={clsx('min-h-screen', kn && 'kn')}>
      <header className="sticky top-0 z-40 border-b border-white/10 bg-black/90 text-white backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <Link to="/" className="flex items-center gap-2" aria-label={tx(kn, 'Ishara home', 'ಇಶಾರಾ ಮುಖಪುಟ')}>
            <ArrowLeft className="h-4 w-4 text-white/70" />
            <BrandLogo variant="white" className="h-8 w-auto" alt={tx(kn, 'Ishara', 'ಇಶಾರಾ')} />
          </Link>
          <p className="hidden text-sm font-semibold text-white/80 sm:block">{tx(kn, 'Search for jobs', 'ಕೆಲಸ ಹುಡುಕಿ')}</p>
          <button
            type="button"
            onClick={() => void i18n.changeLanguage(kn ? 'en' : 'kn')}
            className="rounded-full border border-white/25 px-3 py-1.5 text-sm font-semibold"
          >
            {kn ? 'English' : 'ಕನ್ನಡ'}
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:py-10">
        <section className="overflow-hidden rounded-[2rem] bg-black px-6 py-8 text-white sm:px-10 sm:py-10">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-white/50">
            {tx(kn, 'Direct hire · no agent', 'ನೇರ ನೇಮಕ · ಏಜೆಂಟ್ ಇಲ್ಲ')}
          </p>
          <h1 className="mt-3 max-w-3xl font-display text-4xl font-bold tracking-tight sm:text-5xl" data-testid="jobs-title">
            {tx(kn, 'Search for jobs', 'ಕೆಲಸ ಹುಡುಕಿ')}
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-white/75 sm:text-lg">
            {tx(
              kn,
              'The person who finds you a job often keeps part of your pay. These openings are from entrepreneurs already on Ishara. You talk to them. The wage is written down. Nothing is cut.',
              'ನಿಮಗೆ ಕೆಲಸ ಸಿಕ್ಕಿಸುವವರು ಹೆಚ್ಚಾಗಿ ನಿಮ್ಮ ಕೂಲಿಯ ಒಂದು ಭಾಗ ಇಟ್ಟುಕೊಳ್ಳುತ್ತಾರೆ. ಈ ಕೆಲಸಗಳು ಈಗಾಗಲೇ ಇಶಾರಾದಲ್ಲಿರುವ ಉದ್ಯಮಿಗಳಿಂದ. ನೀವು ಅವರೊಂದಿಗೆ ಮಾತನಾಡುತ್ತೀರಿ. ಕೂಲಿ ಬರೆದಿದೆ. ಏನೂ ಕಟ್ ಆಗುವುದಿಲ್ಲ.',
            )}
          </p>
          <div className="mt-8 grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-white/15 bg-white/5 px-4 py-3">
              <p className="font-display text-2xl font-bold">{rows.length}</p>
              <p className="text-xs text-white/60">{tx(kn, 'openings in this list', 'ಈ ಪಟ್ಟಿಯಲ್ಲಿ ತೆರೆದ ಕೆಲಸ')}</p>
            </div>
            <div className="rounded-2xl border border-white/15 bg-white/5 px-4 py-3">
              <p className="font-display text-2xl font-bold">₹0</p>
              <p className="text-xs text-white/60">{tx(kn, 'to join a direct job', 'ನೇರ ಕೆಲಸಕ್ಕೆ ಸೇರಲು')}</p>
            </div>
            <div className="rounded-2xl border border-white/15 bg-white/5 px-4 py-3">
              <p className="font-display text-2xl font-bold">{inr(protectedSum)}</p>
              <p className="text-xs text-white/60">{tx(kn, 'agents would have kept, on this list', 'ಈ ಪಟ್ಟಿಯಲ್ಲಿ ಏಜೆಂಟರು ಇಟ್ಟುಕೊಳ್ಳುತ್ತಿದ್ದದ್ದು')}</p>
            </div>
          </div>
          <p className="mt-4 max-w-3xl text-xs leading-relaxed text-white/40">
            {tx(
              kn,
              'The agent share is the usual cut a middleman keeps for that kind of work, shown so you can see the gap. Ishara does not take it. “Usual pay” is the going daily rate for that work with no one in the middle — not a government figure.',
              'ಏಜೆಂಟ್ ಪಾಲು ಆ ರೀತಿಯ ಕೆಲಸದಲ್ಲಿ ನಡುವಿನವರು ಸಾಮಾನ್ಯವಾಗಿ ಇಟ್ಟುಕೊಳ್ಳುವ ಕಟ್. ಅಂತರ ಕಾಣಲು ಇದೆ. ಇಶಾರಾ ಅದನ್ನು ತೆಗೆದುಕೊಳ್ಳುವುದಿಲ್ಲ. “ಸಾಮಾನ್ಯ ಕೂಲಿ” ನಡುವೆ ಯಾರೂ ಇಲ್ಲದೆ ಆ ಕೆಲಸದ ದಿನದ ದರ — ಸರ್ಕಾರಿ ಅಂಕಿ ಅಲ್ಲ.',
            )}
          </p>
        </section>

        <div className="mt-6 flex flex-wrap gap-2" role="tablist" aria-label={tx(kn, 'Who you are', 'ನೀವು ಯಾರು')}>
          <button type="button" role="tab" aria-selected={mode === 'work'} className={chip(mode === 'work')} onClick={() => setMode('work')}>
            {tx(kn, 'I am looking for work', 'ನಾನು ಕೆಲಸ ಹುಡುಕುತ್ತಿದ್ದೇನೆ')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'hire'}
            data-testid="hiring-toggle"
            className={chip(mode === 'hire')}
            onClick={() => setMode('hire')}
          >
            {tx(kn, 'I am hiring', 'ನಾನು ಕೆಲಸಕ್ಕೆ ತೆಗೆದುಕೊಳ್ಳುತ್ತಿದ್ದೇನೆ')}
          </button>
        </div>

        {notice && (
          <p className="mt-4 rounded-2xl bg-black px-4 py-3 text-sm text-white" aria-live="polite">
            {notice}
          </p>
        )}

        {mode === 'hire' ? (
          <div className="mt-6">
            <HireDesk
              kn={kn}
              store={store}
              onPublish={(job) => {
                setStore((current) => ({
                  ...current,
                  posted: [job, ...current.posted],
                  profile: { ...current.profile, skills: [] },
                }))
                setWomenOnly(false)
                setRail('all')
                setSort('pay')
                setSelectedId(job.id)
                setMode('work')
                setNotice(
                  tx(
                    kn,
                    'Your opening is in search. The wage you wrote is the wage they keep.',
                    'ನಿಮ್ಮ ಕೆಲಸ ಹುಡುಕಾಟದಲ್ಲಿದೆ. ನೀವು ಬರೆದ ಕೂಲಿಯನ್ನೇ ಅವರು ಇಟ್ಟುಕೊಳ್ಳುತ್ತಾರೆ.',
                  ),
                )
              }}
            />
          </div>
        ) : (
          <>
            <section className="glass mt-6 rounded-[1.5rem] p-4 sm:p-5">
              <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
                <label className="text-sm font-semibold">
                  {tx(kn, 'I live in', 'ನಾನು ಇಲ್ಲಿ ವಾಸ')}
                  <select
                    className="mt-1 w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm"
                    value={store.profile.villageId}
                    onChange={(e) =>
                      setStore((current) => ({ ...current, profile: { ...current.profile, villageId: e.target.value } }))
                    }
                  >
                    {VILLAGES.map((v) => (
                      <option key={v.id} value={v.id}>
                        {kn ? `${v.nameKn}, ${v.districtKn}` : `${v.name}, ${v.district}`}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm font-semibold">
                  {tx(kn, 'My name', 'ನನ್ನ ಹೆಸರು')}
                  <input
                    className="mt-1 w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm"
                    value={store.profile.name}
                    onChange={(e) =>
                      setStore((current) => ({ ...current, profile: { ...current.profile, name: e.target.value } }))
                    }
                  />
                </label>
                <label className="text-sm font-semibold">
                  {tx(kn, 'Mobile', 'ಮೊಬೈಲ್')}
                  <input
                    inputMode="numeric"
                    className="mt-1 w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm sm:w-40"
                    value={store.profile.phone}
                    onChange={(e) =>
                      setStore((current) => ({
                        ...current,
                        profile: { ...current.profile, phone: e.target.value.replace(/\D/g, '').slice(0, 10) },
                      }))
                    }
                  />
                </label>
              </div>
              <p className="mt-4 text-sm font-semibold">{tx(kn, 'What I can do', 'ನಾನು ಮಾಡಬಲ್ಲದ್ದು')}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {SKILLS.map((skill) => {
                  const on = store.profile.skills.includes(skill.id)
                  return (
                    <button
                      key={skill.id}
                      type="button"
                      aria-pressed={on}
                      className={chip(on)}
                      onClick={() => toggleSkill(skill.id)}
                    >
                      {skillLabel(skill.id, kn)}
                    </button>
                  )
                })}
              </div>
              <p className="mt-2 text-xs text-ink/50">
                {store.profile.skills.length === 0
                  ? tx(kn, 'Leave this empty to see every opening. Tap a skill to narrow it.', 'ಎಲ್ಲ ಕೆಲಸ ನೋಡಲು ಇದನ್ನು ಖಾಲಿ ಬಿಡಿ. ಕಿರಿದಾಗಿಸಲು ಒಂದು ಕೌಶಲ್ಯ ಒತ್ತಿ.')
                  : tx(kn, 'Showing work that fits what you tapped.', 'ನೀವು ಒತ್ತಿದ್ದಕ್ಕೆ ಹೊಂದುವ ಕೆಲಸ ತೋರಿಸುತ್ತಿದೆ.')}
              </p>
            </section>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              {(
                [
                  ['near', tx(kn, 'Near my village', 'ನನ್ನ ಗ್ರಾಮದ ಹತ್ತಿರ')],
                  ['city', tx(kn, 'City work', 'ನಗರದ ಕೆಲಸ')],
                  ['all', tx(kn, 'All', 'ಎಲ್ಲ')],
                ] as const
              ).map(([id, label]) => (
                <button key={id} type="button" className={chip(rail === id)} onClick={() => setRail(id)}>
                  {label}
                </button>
              ))}
              <button type="button" aria-pressed={womenOnly} className={chip(womenOnly)} onClick={() => setWomenOnly((v) => !v)}>
                {tx(kn, 'Open to women', 'ಮಹಿಳೆಯರಿಗೆ ತೆರೆದಿದೆ')}
              </button>
              <label className="ml-auto flex items-center gap-2 text-sm font-semibold">
                {tx(kn, 'Sort', 'ಜೋಡಣೆ')}
                <select
                  className="rounded-full border border-black/15 bg-white px-3 py-2 text-sm"
                  value={sort}
                  onChange={(e) => setSort(e.target.value as JobSort)}
                >
                  <option value="pay">{tx(kn, 'Money I keep', 'ನಾನು ಇಟ್ಟುಕೊಳ್ಳುವ ಹಣ')}</option>
                  <option value="near">{tx(kn, 'Closest', 'ಹತ್ತಿರದ್ದು')}</option>
                  <option value="soon">{tx(kn, 'Starts soonest', 'ಬೇಗ ಆರಂಭ')}</option>
                </select>
              </label>
            </div>

            <p className="mt-4 text-sm text-ink/70" aria-live="polite">
              {best
                ? tx(
                    kn,
                    `${rows.length} jobs. The best direct one leaves ${inr(best.pay.inHand)} in your hand.`,
                    `${rows.length} ಕೆಲಸ. ಅತ್ಯುತ್ತಮ ನೇರ ಕೆಲಸ ನಿಮ್ಮ ಕೈಯಲ್ಲಿ ${inr(best.pay.inHand)} ಬಿಡುತ್ತದೆ.`,
                  )
                : tx(kn, 'Nothing in this list.', 'ಈ ಪಟ್ಟಿಯಲ್ಲಿ ಏನೂ ಇಲ್ಲ.')}
            </p>

            {rows.some((row) => row.job.channel === 'agent') && (
              <p className="mt-2 text-sm leading-relaxed text-ink/60">
                {tx(
                  kn,
                  'One card is dashed. That is an agent near you. It is on the page so the cut is visible. You cannot apply to it.',
                  'ಒಂದು ಕಾರ್ಡ್ ಗೆರೆಗೆರೆಯದು. ಅದು ನಿಮ್ಮ ಹತ್ತಿರದ ಏಜೆಂಟ್. ಕಟ್ ಕಾಣಲು ಅದು ಈ ಪುಟದಲ್ಲಿದೆ. ಅದಕ್ಕೆ ಅರ್ಜಿ ಹಾಕಲು ಆಗುವುದಿಲ್ಲ.',
                )}
              </p>
            )}

            {compared.length > 0 && (
              <section className="mt-4 rounded-[1.5rem] border border-black/10 bg-white p-4">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="font-display text-lg font-bold">
                    {compared.length < 2
                      ? tx(kn, 'Pick one more job to compare', 'ಹೋಲಿಸಲು ಇನ್ನೊಂದು ಕೆಲಸ ಆಯ್ಕೆಮಾಡಿ')
                      : tx(kn, 'Side by side', 'ಪಕ್ಕಪಕ್ಕ')}
                  </h2>
                  <button type="button" className="text-xs font-semibold text-ink/50 underline" onClick={() => setCompare([])}>
                    {tx(kn, 'Clear', 'ಅಳಿಸಿ')}
                  </button>
                </div>
                {compared.length === 2 && (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    {compared.map((item) => {
                      const higher = item.pay.inHand === Math.max(compared[0].pay.inHand, compared[1].pay.inHand)
                      return (
                        <div key={item.job.id} className={clsx('rounded-2xl border p-3', higher ? 'border-black' : 'border-black/10')}>
                          <p className="text-sm font-semibold">{textOf(item.job, kn, 'title')}</p>
                          <p className="text-xs text-ink/55">{textOf(item.job, kn, 'employer')}</p>
                          <p className="mt-2 font-display text-2xl font-bold">{inr(item.pay.inHand)}</p>
                          <p className="text-xs text-ink/55">{tx(kn, 'in your hand', 'ನಿಮ್ಮ ಕೈಯಲ್ಲಿ')}</p>
                          <ul className="mt-2 space-y-1 text-xs text-ink/70">
                            <li>
                              {tx(kn, 'A day in hand', 'ಕೈಯಲ್ಲಿ ಒಂದು ದಿನ')}: {inr(item.pay.realDaily)}
                            </li>
                            <li>
                              {item.job.channel === 'direct'
                                ? tx(kn, 'Agent would keep', 'ಏಜೆಂಟ್ ಇಟ್ಟುಕೊಳ್ಳುತ್ತಿದ್ದದ್ದು')
                                : tx(kn, 'Agent keeps', 'ಏಜೆಂಟ್ ಇಟ್ಟುಕೊಳ್ಳುವುದು')}
                              : {inr(item.pay.agentKeeps)}
                            </li>
                            <li>{reachOf(item.job, item.km, kn)}</li>
                            <li>{whenLabel(item.job.startsInDays, kn)}</li>
                            <li>
                              {item.job.stayIncluded
                                ? tx(kn, 'Stay included', 'ತಂಗುವಿಕೆ ಸೇರಿದೆ')
                                : tx(kn, 'Stay not included', 'ತಂಗುವಿಕೆ ಸೇರಿಲ್ಲ')}
                            </li>
                          </ul>
                        </div>
                      )
                    })}
                  </div>
                )}
              </section>
            )}

            <div className={clsx('mt-4', wide && 'grid grid-cols-[minmax(0,1fr)_22rem] items-start gap-5')}>
              <div className="space-y-3">
                {rows.length === 0 && (
                  <p className="rounded-2xl border border-black/10 bg-white p-5 text-sm leading-relaxed text-ink/70">
                    {tx(
                      kn,
                      'Nothing matches. Try “All”, or clear a skill. City work is listed on its own so the bus fare is not a surprise.',
                      'ಏನೂ ಹೊಂದುತ್ತಿಲ್ಲ. “ಎಲ್ಲ” ಪ್ರಯತ್ನಿಸಿ, ಅಥವಾ ಒಂದು ಕೌಶಲ್ಯ ತೆಗೆಯಿರಿ. ಬಸ್ ದರ ಆಶ್ಚರ್ಯವಾಗದಂತೆ ನಗರದ ಕೆಲಸ ಪ್ರತ್ಯೇಕವಾಗಿದೆ.',
                    )}
                  </p>
                )}
                {rows.map((row) => (
                  <div key={row.job.id}>
                    <JobCard
                      kn={kn}
                      row={row}
                      selected={selected?.job.id === row.job.id}
                      compared={compare.includes(row.job.id)}
                      onSelect={() => setSelectedId(row.job.id)}
                      onCompare={() => toggleCompare(row.job.id)}
                    />
                    {!wide && selected?.job.id === row.job.id && (
                      <div className="mt-3">
                        <JobDetail
                          kn={kn}
                          row={row}
                          profileName={store.profile.name}
                          profilePhone={store.profile.phone}
                          sent={sentFor(row.job.id)}
                          onSend={send}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {wide && selected && (
                <aside className="sticky top-24 max-h-[calc(100vh-7rem)] overflow-auto">
                  <JobDetail
                    key={selected.job.id}
                    kn={kn}
                    row={selected}
                    profileName={store.profile.name}
                    profilePhone={store.profile.phone}
                    sent={sentFor(selected.job.id)}
                    onSend={send}
                  />
                </aside>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  )
}
