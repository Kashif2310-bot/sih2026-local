import { VILLAGES, type Village } from '../data/villages'

/**
 * Direct hire for low-wage work.
 *
 * An agent (thekedar / mestri / placement middleman) is paid out of the
 * worker's wage. Every number on a card is the wage after that cut is
 * removed — or, on an agent listing, the wage with the cut left visible
 * so the two can be compared.
 */

export const SKILLS = [
  { id: 'milking',   icon: '🐄', en: 'Milking',          kn: 'ಹಾಲು ಕರೆಯುವುದು' },
  { id: 'paneer',    icon: '🧀', en: 'Paneer & ghee',    kn: 'ಪನೀರ್ ಮತ್ತು ತುಪ್ಪ' },
  { id: 'cooking',   icon: '🍳', en: 'Cooking',          kn: 'ಅಡುಗೆ' },
  { id: 'stall',     icon: '🏪', en: 'Stall & serving',  kn: 'ಅಂಗಡಿ ಮತ್ತು ಬಡಿಸುವುದು' },
  { id: 'stitching', icon: '🧵', en: 'Stitching',        kn: 'ಹೊಲಿಗೆ' },
  { id: 'loading',   icon: '📦', en: 'Loading',          kn: 'ಸಾಮಾನು ಏರಿಸುವುದು' },
  { id: 'harvest',   icon: '🌾', en: 'Harvest',          kn: 'ಕೊಯ್ಲು' },
  { id: 'masonry',   icon: '🧱', en: 'Masonry helper',   kn: 'ಕಲ್ಲುಗೆಲಸ ಸಹಾಯ' },
  { id: 'poultry',   icon: '🐔', en: 'Poultry',          kn: 'ಕೋಳಿ ಸಾಕಾಣಿಕೆ' },
  { id: 'packing',   icon: '🛍️', en: 'Packing',          kn: 'ಪ್ಯಾಕಿಂಗ್' },
] as const

export type SkillId = (typeof SKILLS)[number]['id']

export type Workplace = 'village' | 'city'
export type Channel = 'direct' | 'agent'
export type PayCadence = 'daily' | 'weekly'
export type JobRail = 'all' | 'near' | 'city'
export type JobSort = 'pay' | 'near' | 'soon'

/** What an agent typically keeps, used only as the counterfactual on direct jobs. */
const AGENT_CUT: Record<SkillId, number> = {
  milking: 0.2,
  paneer: 0.2,
  cooking: 0.2,
  stall: 0.2,
  stitching: 0.15,
  loading: 0.25,
  harvest: 0.2,
  masonry: 0.3,
  poultry: 0.15,
  packing: 0.15,
}

/** Upfront placement fee agents charge before the worker starts. */
const AGENT_FEE: Record<SkillId, number> = {
  milking: 2000,
  paneer: 2000,
  cooking: 2500,
  stall: 2000,
  stitching: 1500,
  loading: 3000,
  harvest: 1500,
  masonry: 4000,
  poultry: 1000,
  packing: 1500,
}

/** Usual daily pay for this work when nobody stands in the middle. Demo benchmark, not a government rate. */
const USUAL_DAILY: Record<SkillId, number> = {
  milking: 600,
  paneer: 650,
  cooking: 700,
  stall: 650,
  stitching: 500,
  loading: 750,
  harvest: 700,
  masonry: 800,
  poultry: 500,
  packing: 600,
}

export interface JobOpening {
  id: string
  channel: Channel
  verified: boolean
  employer: string
  employerKn: string
  title: string
  titleKn: string
  work: string
  workKn: string
  meet: string
  meetKn: string
  villageId: string
  workplace: Workplace
  city: string
  cityKn: string
  /** Kilometres from the employer's village to the worksite. Ignored for city jobs. */
  distanceKm: number
  skill: SkillId
  alsoSkills: SkillId[]
  dailyWage: number
  /** Share of gross an agent keeps. On a direct job this is the cut the worker does NOT pay. */
  agentCutRate: number
  joiningFee: number
  usualDaily: number
  days: number
  cadence: PayCadence
  seats: number
  /** How many people from the same village can go on one interest. */
  crew: number
  startsInDays: number
  stayIncluded: boolean
  foodIncluded: boolean
  busFare: number
  roomPerMonth: number
  foodPerMonth: number
  womenWelcome: boolean
  languages: string[]
  languagesKn: string[]
}

export interface Wage {
  gross: number
  costs: number
  bus: number
  room: number
  food: number
  localTravel: number
  agentCut: number
  joiningFee: number
  agentKeeps: number
  directHand: number
  agentHand: number
  /** What this listing actually leaves with the worker. */
  inHand: number
  /** Rupees an agent would have kept. Zero on an agent listing — the cut is already inside inHand. */
  protectedRupees: number
  realDaily: number
  belowUsual: boolean
}

export interface PreparedJob {
  job: JobOpening
  km: number
  match: number | null
  pay: Wage
}

export interface JobFilters {
  skills: SkillId[]
  rail: JobRail
  villageId: string
  sort: JobSort
  womenOnly: boolean
}

export function skillLabel(id: SkillId, kn: boolean) {
  const row = SKILLS.find((s) => s.id === id)
  if (!row) return id
  return kn ? row.kn : row.en
}

export function skillIcon(id: SkillId) {
  return SKILLS.find((s) => s.id === id)?.icon ?? '🛠️'
}

export function isSkillId(value: string): value is SkillId {
  return SKILLS.some((s) => s.id === value)
}

export function inr(n: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(Math.round(n))
}

export function haversineKm(a: Pick<Village, 'lat' | 'lng'>, b: Pick<Village, 'lat' | 'lng'>) {
  const R = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const lat1 = (a.lat * Math.PI) / 180
  const lat2 = (b.lat * Math.PI) / 180
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Village auto, both ways: ₹2 per km each way, only once the worksite is past 4 km. */
function localTravel(job: JobOpening) {
  if (job.workplace !== 'village' || job.distanceKm <= 4) return 0
  return job.distanceKm * 4 * job.days
}

export function wageOf(job: JobOpening): Wage {
  const gross = job.dailyWage * job.days
  const bus = job.workplace === 'city' ? job.busFare * 2 : 0
  const room = job.workplace === 'city' && !job.stayIncluded ? job.roomPerMonth : 0
  const food = job.workplace === 'city' && !job.foodIncluded ? job.foodPerMonth : 0
  const travel = localTravel(job)
  const costs = bus + room + food + travel
  const agentCut = Math.round(gross * job.agentCutRate)
  const agentKeeps = agentCut + job.joiningFee
  const directHand = gross - costs
  const agentHand = directHand - agentKeeps
  const inHand = job.channel === 'direct' ? directHand : agentHand
  return {
    gross,
    costs,
    bus,
    room,
    food,
    localTravel: travel,
    agentCut,
    joiningFee: job.joiningFee,
    agentKeeps,
    directHand,
    agentHand,
    inHand,
    protectedRupees: job.channel === 'direct' ? agentKeeps : 0,
    realDaily: Math.round(inHand / Math.max(1, job.days)),
    belowUsual: job.dailyWage < job.usualDaily,
  }
}

export function distanceKm(job: JobOpening, villageId: string) {
  if (job.workplace === 'city') return Number.POSITIVE_INFINITY
  const from = VILLAGES.find((v) => v.id === villageId)
  const to = VILLAGES.find((v) => v.id === job.villageId)
  if (!from || !to) return job.distanceKm
  if (from.id === to.id) return job.distanceKm
  return Math.round(haversineKm(from, to))
}

export function matchScore(job: JobOpening, skills: SkillId[]): number | null {
  if (skills.length === 0) return null
  const hits = skills.filter((s) => s === job.skill || job.alsoSkills.includes(s)).length
  if (hits === 0) return 18
  return Math.min(99, 62 + hits * 18)
}

const NEAR_KM = 30

export function prepareJobs(jobs: JobOpening[], filters: JobFilters): PreparedJob[] {
  const prepared = jobs.map((job) => ({
    job,
    km: distanceKm(job, filters.villageId),
    match: matchScore(job, filters.skills),
    pay: wageOf(job),
  }))

  const filtered = prepared.filter((row) => {
    if (filters.womenOnly && !row.job.womenWelcome) return false
    if (filters.skills.length > 0 && row.match !== null && row.match < 50) return false
    if (filters.rail === 'city') return row.job.workplace === 'city'
    if (filters.rail === 'near') return row.job.workplace === 'village' && row.km <= NEAR_KM
    return true
  })

  const ranked = [...filtered]
  ranked.sort((a, b) => {
    if (filters.sort === 'near') return a.km - b.km
    if (filters.sort === 'soon') return a.job.startsInDays - b.job.startsInDays || b.pay.inHand - a.pay.inHand
    return b.pay.inHand - a.pay.inHand
  })
  return ranked
}

export function villageById(id: string) {
  return VILLAGES.find((v) => v.id === id) ?? null
}

export interface PostedJobInput {
  employer: string
  villageId: string
  skill: SkillId
  dailyWage: number
  seats: number
  days: number
  workplace: Workplace
  city: string
  busFare: number
  stayIncluded: boolean
  foodIncluded: boolean
  work: string
  womenWelcome: boolean
  crew: number
}

export function createPostedJob(input: PostedJobInput): JobOpening {
  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? `local-${crypto.randomUUID()}`
      : `local-${Date.now()}`
  const skillName = skillLabel(input.skill, false)
  return {
    id,
    channel: 'direct',
    verified: true,
    employer: input.employer.trim(),
    employerKn: input.employer.trim(),
    title: skillName,
    titleKn: skillLabel(input.skill, true),
    work: input.work.trim(),
    workKn: input.work.trim(),
    meet: 'They will call the number you send.',
    meetKn: 'ನೀವು ಕಳುಹಿಸುವ ಸಂಖ್ಯೆಗೆ ಅವರೇ ಕರೆ ಮಾಡುತ್ತಾರೆ.',
    villageId: input.villageId,
    workplace: input.workplace,
    city: input.workplace === 'city' ? input.city.trim() : '',
    cityKn: input.workplace === 'city' ? input.city.trim() : '',
    distanceKm: input.workplace === 'village' ? 1 : 0,
    skill: input.skill,
    alsoSkills: [],
    dailyWage: input.dailyWage,
    agentCutRate: AGENT_CUT[input.skill],
    joiningFee: AGENT_FEE[input.skill],
    usualDaily: USUAL_DAILY[input.skill],
    days: input.days,
    cadence: 'weekly',
    seats: input.seats,
    crew: Math.max(1, input.crew),
    startsInDays: 2,
    stayIncluded: input.workplace === 'city' && input.stayIncluded,
    foodIncluded: input.foodIncluded,
    busFare: input.workplace === 'city' ? input.busFare : 0,
    roomPerMonth: input.workplace === 'city' && !input.stayIncluded ? 3500 : 0,
    foodPerMonth: input.foodIncluded ? 0 : input.workplace === 'city' ? 2500 : 0,
    womenWelcome: input.womenWelcome,
    languages: ['Kannada'],
    languagesKn: ['ಕನ್ನಡ'],
  }
}

function job(
  partial: Pick<
    JobOpening,
    | 'id'
    | 'channel'
    | 'employer'
    | 'employerKn'
    | 'title'
    | 'titleKn'
    | 'work'
    | 'workKn'
    | 'meet'
    | 'meetKn'
    | 'villageId'
    | 'workplace'
    | 'skill'
    | 'dailyWage'
    | 'days'
    | 'cadence'
    | 'seats'
    | 'crew'
    | 'startsInDays'
    | 'womenWelcome'
  > &
    Partial<JobOpening>,
): JobOpening {
  const skill = partial.skill
  return {
    verified: partial.channel === 'direct',
    city: '',
    cityKn: '',
    distanceKm: 0,
    alsoSkills: [],
    agentCutRate: AGENT_CUT[skill],
    joiningFee: AGENT_FEE[skill],
    usualDaily: USUAL_DAILY[skill],
    stayIncluded: false,
    foodIncluded: false,
    busFare: 0,
    roomPerMonth: 0,
    foodPerMonth: 0,
    languages: ['Kannada'],
    languagesKn: ['ಕನ್ನಡ'],
    ...partial,
  }
}

export const SEED_JOBS: JobOpening[] = [
  job({
    id: 'paneer-dinka',
    channel: 'direct',
    employer: 'Lakshmi S.',
    employerKn: 'ಲಕ್ಷ್ಮಿ ಎಸ್.',
    title: 'Paneer & ghee helper',
    titleKn: 'ಪನೀರ್ ಮತ್ತು ತುಪ್ಪ ಸಹಾಯ',
    work: 'Set the milk, cut paneer, and pack ghee in Lakshmi’s dairy room. You work for her, not for someone who found you the job.',
    workKn:
      'ಲಕ್ಷ್ಮಿ ಅವರ ಡೈರಿ ಕೋಣೆಯಲ್ಲಿ ಹಾಲು ಹೆಪ್ಪುಗಟ್ಟಿಸಿ, ಪನೀರ್ ಕತ್ತರಿಸಿ, ತುಪ್ಪ ಪ್ಯಾಕ್ ಮಾಡುವ ಕೆಲಸ. ಕೆಲಸ ಸಿಕ್ಕಿಸಿದವರ ಬಳಿ ಅಲ್ಲ — ಅವರ ಬಳಿಯೇ.',
    meet: 'Ask for Lakshmi at the milk room in Dinka. Morning start, 6:30.',
    meetKn: 'ಡಿಂಕಾ ಹಾಲು ಕೋಣೆಯಲ್ಲಿ ಲಕ್ಷ್ಮಿ ಅವರನ್ನು ಕೇಳಿ. ಬೆಳಿಗ್ಗೆ 6:30ಕ್ಕೆ ಆರಂಭ.',
    villageId: 'dinka-mandya',
    workplace: 'village',
    distanceKm: 1,
    skill: 'paneer',
    alsoSkills: ['milking'],
    dailyWage: 650,
    days: 26,
    cadence: 'weekly',
    seats: 2,
    crew: 1,
    startsInDays: 1,
    womenWelcome: true,
  }),
  job({
    id: 'milk-dinka',
    channel: 'direct',
    employer: 'Lakshmi S.',
    employerKn: 'ಲಕ್ಷ್ಮಿ ಎಸ್.',
    title: 'Dawn milking round',
    titleKn: 'ಬೆಳಗಿನ ಹಾಲು ಸುತ್ತು',
    work: 'Two hours at dawn on the village milk route, then you are done. Pay is handed over every evening — not at the end of the month by someone else.',
    workKn:
      'ಗ್ರಾಮದ ಹಾಲು ದಾರಿಯಲ್ಲಿ ಮುಂಜಾನೆ ಎರಡು ಗಂಟೆ, ಆಮೇಲೆ ಕೆಲಸ ಮುಗಿಯುತ್ತದೆ. ಕೂಲಿ ಪ್ರತಿ ಸಂಜೆ ನಿಮ್ಮ ಕೈಗೆ — ತಿಂಗಳ ಕೊನೆಯಲ್ಲಿ ಬೇರೆಯವರ ಮೂಲಕ ಅಲ್ಲ.',
    meet: 'Lakshmi’s collection point, Dinka bus stop.',
    meetKn: 'ಲಕ್ಷ್ಮಿ ಅವರ ಸಂಗ್ರಹ ಜಾಗ, ಡಿಂಕಾ ಬಸ್ ನಿಲ್ದಾಣ.',
    villageId: 'dinka-mandya',
    workplace: 'village',
    distanceKm: 0,
    skill: 'milking',
    dailyWage: 600,
    days: 26,
    cadence: 'daily',
    seats: 1,
    crew: 1,
    startsInDays: 0,
    womenWelcome: true,
  }),
  job({
    id: 'agent-mandya',
    channel: 'agent',
    verified: false,
    employer: 'Ramesh Mestri',
    employerKn: 'ರಮೇಶ್ ಮೇಸ್ತ್ರಿ',
    title: 'Masonry helper',
    titleKn: 'ಕಲ್ಲುಗೆಲಸ ಸಹಾಯ',
    work: 'A contractor in Mandya is offering this. He asks ₹3,000 before you start, then keeps part of every day’s pay. Ishara will not send you to him.',
    workKn:
      'ಮಂಡ್ಯದ ಗುತ್ತಿಗೆದಾರ ಇದನ್ನು ನೀಡುತ್ತಿದ್ದಾರೆ. ಆರಂಭಕ್ಕೆ ಮುನ್ನ ₹3,000 ಕೇಳುತ್ತಾರೆ, ಆಮೇಲೆ ಪ್ರತಿ ದಿನದ ಕೂಲಿಯ ಒಂದು ಭಾಗ ಇಟ್ಟುಕೊಳ್ಳುತ್ತಾರೆ. ಇಶಾರಾ ನಿಮ್ಮನ್ನು ಅವರ ಬಳಿ ಕಳುಹಿಸುವುದಿಲ್ಲ.',
    meet: 'He tells you the site only after the fee is paid.',
    meetKn: 'ಶುಲ್ಕ ತೆತ್ತ ನಂತರವೇ ಅವರು ಕೆಲಸದ ಜಾಗ ಹೇಳುತ್ತಾರೆ.',
    villageId: 'dinka-mandya',
    workplace: 'village',
    distanceKm: 14,
    skill: 'masonry',
    joiningFee: 3000,
    dailyWage: 700,
    days: 26,
    cadence: 'daily',
    seats: 8,
    crew: 1,
    startsInDays: 1,
    womenWelcome: false,
    languages: ['Kannada', 'Hindi'],
    languagesKn: ['ಕನ್ನಡ', 'ಹಿಂದಿ'],
  }),
  job({
    id: 'jatra-kabbenur',
    channel: 'direct',
    employer: 'Renuka Patil',
    employerKn: 'ರೇಣುಕಾ ಪಾಟೀಲ್',
    title: 'Jatra kitchen',
    titleKn: 'ಜಾತ್ರೆ ಅಡುಗೆಮನೆ',
    work: 'Eight days of cooking and serving at the Kabbenur jatra stall. Bring up to three people from your village — one interest covers the crew, and nobody pays an agent.',
    workKn:
      'ಕಬ್ಬೇನೂರು ಜಾತ್ರೆ ಅಂಗಡಿಯಲ್ಲಿ ಎಂಟು ದಿನ ಅಡುಗೆ ಮತ್ತು ಬಡಿಸುವ ಕೆಲಸ. ನಿಮ್ಮ ಗ್ರಾಮದಿಂದ ಮೂವರನ್ನು ಕರೆತನ್ನಿ — ಒಂದೇ ಆಸಕ್ತಿ ತಂಡಕ್ಕೆ ಸಾಕು, ಯಾರೂ ಏಜೆಂಟ್‌ಗೆ ಹಣ ಕೊಡುವುದಿಲ್ಲ.',
    meet: 'Renuka’s stall, two lanes in from the temple gate. She meets you there.',
    meetKn: 'ದೇವಾಲಯ ಬಾಗಿಲಿನಿಂದ ಎರಡು ರಸ್ತೆ ಒಳಗೆ ರೇಣುಕಾ ಅವರ ಅಂಗಡಿ. ಅವರೇ ಅಲ್ಲಿ ಭೇಟಿಯಾಗುತ್ತಾರೆ.',
    villageId: 'kabbenur-dharwad',
    workplace: 'village',
    distanceKm: 1,
    skill: 'cooking',
    alsoSkills: ['stall'],
    dailyWage: 750,
    days: 8,
    cadence: 'daily',
    seats: 6,
    crew: 4,
    startsInDays: 4,
    foodIncluded: true,
    womenWelcome: true,
  }),
  job({
    id: 'stitch-sulebhavi',
    channel: 'direct',
    employer: 'Asha Mane',
    employerKn: 'ಆಶಾ ಮಾನೆ',
    title: 'Stitching',
    titleKn: 'ಹೊಲಿಗೆ',
    work: 'Blouse and uniform stitching at Asha’s unit. She pays every Saturday into your account. Women are already working here.',
    workKn:
      'ಆಶಾ ಅವರ ಘಟಕದಲ್ಲಿ ರವಿಕೆ ಮತ್ತು ಸಮವಸ್ತ್ರ ಹೊಲಿಗೆ. ಪ್ರತಿ ಶನಿವಾರ ಕೂಲಿ ನಿಮ್ಮ ಖಾತೆಗೆ. ಇಲ್ಲಿ ಮಹಿಳೆಯರೇ ಕೆಲಸ ಮಾಡುತ್ತಿದ್ದಾರೆ.',
    meet: 'Asha’s house, the blue door past the Sulebhavi school.',
    meetKn: 'ಸುಳೆಭಾವಿ ಶಾಲೆ ದಾಟಿ ನೀಲಿ ಬಾಗಿಲು — ಆಶಾ ಅವರ ಮನೆ.',
    villageId: 'sulebhavi-belagavi',
    workplace: 'village',
    distanceKm: 0,
    skill: 'stitching',
    dailyWage: 520,
    days: 26,
    cadence: 'weekly',
    seats: 3,
    crew: 1,
    startsInDays: 3,
    womenWelcome: true,
  }),
  job({
    id: 'poultry-kabbenur',
    channel: 'direct',
    employer: 'Mahadev G.',
    employerKn: 'ಮಹಾದೇವ ಜಿ.',
    title: 'Poultry shed',
    titleKn: 'ಕೋಳಿ ಶೆಡ್',
    work: 'Feed, water, and collect eggs at Mahadev’s shed. The wage is the same number every week — he does not revise it after you arrive.',
    workKn:
      'ಮಹಾದೇವ ಅವರ ಶೆಡ್‌ನಲ್ಲಿ ಮೇವು, ನೀರು, ಮೊಟ್ಟೆ ಸಂಗ್ರಹ. ಪ್ರತಿ ವಾರ ಅದೇ ಕೂಲಿ — ನೀವು ಬಂದ ಮೇಲೆ ಅವರು ಅದನ್ನು ಬದಲಾಯಿಸುವುದಿಲ್ಲ.',
    meet: 'The shed is behind the Kabbenur milk dairy. Ask for Mahadev.',
    meetKn: 'ಕಬ್ಬೇನೂರು ಹಾಲು ಡೈರಿ ಹಿಂದೆ ಶೆಡ್. ಮಹಾದೇವ ಅವರನ್ನು ಕೇಳಿ.',
    villageId: 'kabbenur-dharwad',
    workplace: 'village',
    distanceKm: 2,
    skill: 'poultry',
    dailyWage: 500,
    days: 26,
    cadence: 'weekly',
    seats: 2,
    crew: 1,
    startsInDays: 2,
    womenWelcome: true,
  }),
  job({
    id: 'load-kunigal',
    channel: 'direct',
    employer: 'Syed Imran',
    employerKn: 'ಸಯ್ಯದ್ ಇಮ್ರಾನ್',
    title: 'Ragi loading',
    titleKn: 'ರಾಗಿ ಏರಿಸುವಿಕೆ',
    work: 'Load and stack ragi sacks at Imran’s processing shed, 9 km from Kunigal. The auto fare is shown separately — it is not an agent’s cut.',
    workKn:
      'ಕುಣಿಗಲ್‌ನಿಂದ 9 ಕಿ.ಮೀ ದೂರ ಇಮ್ರಾನ್ ಅವರ ಸಂಸ್ಕರಣಾ ಶೆಡ್‌ನಲ್ಲಿ ರಾಗಿ ಚೀಲ ಏರಿಸಿ ಜೋಡಿಸುವ ಕೆಲಸ. ಆಟೋ ದರ ಪ್ರತ್ಯೇಕ — ಅದು ಏಜೆಂಟ್ ಕಟ್ ಅಲ್ಲ.',
    meet: 'Imran sends a tempo from the Kunigal old bus stand at 7am.',
    meetKn: 'ಬೆಳಿಗ್ಗೆ 7ಕ್ಕೆ ಕುಣಿಗಲ್ ಹಳೇ ಬಸ್ ನಿಲ್ದಾಣದಿಂದ ಇಮ್ರಾನ್ ಟೆಂಪೊ ಕಳುಹಿಸುತ್ತಾರೆ.',
    villageId: 'kunigal-tumakuru',
    workplace: 'village',
    distanceKm: 9,
    skill: 'loading',
    dailyWage: 780,
    days: 26,
    cadence: 'daily',
    seats: 4,
    crew: 2,
    startsInDays: 1,
    womenWelcome: true,
  }),
  job({
    id: 'pack-sakleshpur',
    channel: 'direct',
    employer: 'Poornima H.',
    employerKn: 'ಪೂರ್ಣಿಮಾ ಹೆಚ್.',
    title: 'Coffee packing',
    titleKn: 'ಕಾಫಿ ಪ್ಯಾಕಿಂಗ್',
    work: 'Weigh, seal, and label coffee packs for Poornima’s unit. Sit-down work. She is an Ishara entrepreneur — the wage was written when she opened the role.',
    workKn:
      'ಪೂರ್ಣಿಮಾ ಅವರ ಘಟಕಕ್ಕೆ ಕಾಫಿ ತೂಕ, ಸೀಲ್, ಲೇಬಲ್. ಕುಳಿತು ಮಾಡುವ ಕೆಲಸ. ಅವರು ಇಶಾರಾ ಉದ್ಯಮಿ — ಕೆಲಸ ತೆರೆದಾಗಲೇ ಕೂಲಿ ಬರೆದಿಡಲಾಗಿದೆ.',
    meet: 'Poornima’s unit, the white godown on the Hassan road in Sakleshpur.',
    meetKn: 'ಸಕಲೇಶಪುರ ಹಾಸನ ರಸ್ತೆಯ ಬಿಳಿ ಗೋದಾಮು — ಪೂರ್ಣಿಮಾ ಅವರ ಘಟಕ.',
    villageId: 'sakleshpur-hassan',
    workplace: 'village',
    distanceKm: 2,
    skill: 'packing',
    dailyWage: 640,
    days: 26,
    cadence: 'weekly',
    seats: 4,
    crew: 1,
    startsInDays: 5,
    womenWelcome: true,
  }),
  job({
    id: 'city-tiff',
    channel: 'direct',
    employer: 'Geetha N.',
    employerKn: 'ಗೀತಾ ಎನ್.',
    title: 'Tiffin kitchen',
    titleKn: 'ತಿಫಿನ್ ಅಡುಗೆಮನೆ',
    work: 'Cook morning tiffin at Geetha’s Bengaluru kitchen. The daily figure looks high. Bus, room, and food come off it before you compare it with work at home.',
    workKn:
      'ಗೀತಾ ಅವರ ಬೆಂಗಳೂರು ಅಡುಗೆಮನೆಯಲ್ಲಿ ಬೆಳಗಿನ ತಿಫಿನ್. ದಿನದ ಅಂಕಿ ದೊಡ್ಡದಾಗಿ ಕಾಣುತ್ತದೆ. ಮನೆಯ ಕೆಲಸದೊಂದಿಗೆ ಹೋಲಿಸುವ ಮುನ್ನ ಬಸ್, ಕೋಣೆ, ಊಟ ಇದರಿಂದ ಇಳಿಯುತ್ತದೆ.',
    meet: 'Geetha meets the overnight bus at Majestic, platform side, 6:40am. She holds a white card with your name.',
    meetKn: 'ರಾತ್ರಿ ಬಸ್ ಇಳಿಯುವಾಗ ಮೆಜೆಸ್ಟಿಕ್‌ನಲ್ಲಿ, ಪ್ಲಾಟ್‌ಫಾರ್ಮ್ ಬದಿಯಲ್ಲಿ, ಬೆಳಿಗ್ಗೆ 6:40ಕ್ಕೆ ಗೀತಾ ಭೇಟಿಯಾಗುತ್ತಾರೆ. ನಿಮ್ಮ ಹೆಸರಿನ ಬಿಳಿ ಕಾರ್ಡ್ ಅವರ ಕೈಯಲ್ಲಿ.',
    villageId: 'dinka-mandya',
    workplace: 'city',
    city: 'Bengaluru',
    cityKn: 'ಬೆಂಗಳೂರು',
    skill: 'cooking',
    alsoSkills: ['stall'],
    dailyWage: 950,
    days: 26,
    cadence: 'weekly',
    seats: 2,
    crew: 1,
    startsInDays: 6,
    stayIncluded: false,
    foodIncluded: false,
    busFare: 320,
    roomPerMonth: 4500,
    foodPerMonth: 2800,
    womenWelcome: true,
    languages: ['Kannada', 'Hindi'],
    languagesKn: ['ಕನ್ನಡ', 'ಹಿಂದಿ'],
  }),
  job({
    id: 'city-mason',
    channel: 'direct',
    employer: 'Nagaraj',
    employerKn: 'ನಾಗರಾಜ್',
    title: 'Dairy-shed build',
    titleKn: 'ಡೈರಿ ಶೆಡ್ ಕಟ್ಟಡ',
    work: 'Help Nagaraj raise a dairy shed in Mysuru. He is building it for his own unit. Stay and meals are in the shed compound, so the city wage is actually a city wage.',
    workKn:
      'ಮೈಸೂರಿನಲ್ಲಿ ನಾಗರಾಜ್ ಅವರ ಸ್ವಂತ ಡೈರಿ ಶೆಡ್ ಕಟ್ಟಲು ಸಹಾಯ. ತಂಗುವಿಕೆ ಮತ್ತು ಊಟ ಶೆಡ್ ಆವರಣದಲ್ಲೇ — ಆದ್ದರಿಂದ ನಗರದ ಕೂಲಿ ನಿಜಕ್ಕೂ ನಗರದ ಕೂಲಿ.',
    meet: 'Nagaraj meets the 7:10am bus at Mysuru bus stand, gate 2. Room is on the site. No rent.',
    meetKn: 'ಮೈಸೂರು ಬಸ್ ನಿಲ್ದಾಣದ 2ನೇ ಗೇಟ್‌ನಲ್ಲಿ ಬೆಳಿಗ್ಗೆ 7:10ರ ಬಸ್‌ಗೆ ನಾಗರಾಜ್ ಭೇಟಿ. ಕೋಣೆ ಕೆಲಸದ ಜಾಗದಲ್ಲೇ. ಬಾಡಿಗೆ ಇಲ್ಲ.',
    villageId: 'kunigal-tumakuru',
    workplace: 'city',
    city: 'Mysuru',
    cityKn: 'ಮೈಸೂರು',
    skill: 'masonry',
    alsoSkills: ['loading'],
    dailyWage: 850,
    agentCutRate: 0.3,
    joiningFee: 4000,
    days: 26,
    cadence: 'daily',
    seats: 5,
    crew: 3,
    startsInDays: 3,
    stayIncluded: true,
    foodIncluded: true,
    busFare: 190,
    womenWelcome: false,
    languages: ['Kannada'],
    languagesKn: ['ಕನ್ನಡ'],
  }),
]
