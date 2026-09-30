import { VILLAGES } from '../data/villages'
import {
  SEED_JOBS,
  isSkillId,
  type JobOpening,
  type SkillId,
} from './model'

const KEY = 'ishara.jobs.v1'

export interface WorkerProfile {
  name: string
  phone: string
  villageId: string
  skills: SkillId[]
}

export interface Interest {
  id: string
  jobId: string
  employer: string
  title: string
  dailyWage: number
  days: number
  inHand: number
  agentWouldKeep: number
  channel: 'direct' | 'agent'
  name: string
  phone: string
  villageId: string
  at: string
}

export interface JobsStore {
  profile: WorkerProfile
  interests: Interest[]
  posted: JobOpening[]
}

export function defaultProfile(): WorkerProfile {
  return {
    name: '',
    phone: '',
    villageId: 'dinka-mandya',
    skills: [],
  }
}

function newId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `id-${Date.now()}`
}

function asProfile(value: unknown): WorkerProfile {
  const base = defaultProfile()
  if (!value || typeof value !== 'object') return base
  const raw = value as Partial<WorkerProfile>
  const villageId =
    typeof raw.villageId === 'string' && VILLAGES.some((v) => v.id === raw.villageId)
      ? raw.villageId
      : base.villageId
  const skills = Array.isArray(raw.skills) ? raw.skills.filter((s): s is SkillId => typeof s === 'string' && isSkillId(s)) : []
  return {
    name: typeof raw.name === 'string' ? raw.name.slice(0, 80) : '',
    phone: typeof raw.phone === 'string' ? raw.phone.replace(/\D/g, '').slice(0, 10) : '',
    villageId,
    skills,
  }
}

function asInterest(value: unknown): Interest | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<Interest>
  if (typeof raw.id !== 'string' || typeof raw.jobId !== 'string') return null
  if (typeof raw.employer !== 'string' || typeof raw.name !== 'string') return null
  if (typeof raw.inHand !== 'number' || typeof raw.dailyWage !== 'number') return null
  return {
    id: raw.id,
    jobId: raw.jobId,
    employer: raw.employer,
    title: typeof raw.title === 'string' ? raw.title : '',
    dailyWage: raw.dailyWage,
    days: typeof raw.days === 'number' ? raw.days : 0,
    inHand: raw.inHand,
    agentWouldKeep: typeof raw.agentWouldKeep === 'number' ? raw.agentWouldKeep : 0,
    channel: raw.channel === 'agent' ? 'agent' : 'direct',
    name: raw.name,
    phone: typeof raw.phone === 'string' ? raw.phone : '',
    villageId: typeof raw.villageId === 'string' ? raw.villageId : '',
    at: typeof raw.at === 'string' ? raw.at : new Date(0).toISOString(),
  }
}

function asPosted(value: unknown): JobOpening | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<JobOpening>
  if (typeof raw.id !== 'string' || !raw.id.startsWith('local-')) return null
  if (typeof raw.employer !== 'string' || typeof raw.dailyWage !== 'number') return null
  if (typeof raw.skill !== 'string' || !isSkillId(raw.skill)) return null
  if (typeof raw.villageId !== 'string' || !VILLAGES.some((v) => v.id === raw.villageId)) return null
  if (raw.channel !== 'direct') return null
  const known = SEED_JOBS[0]
  return {
    ...known,
    ...raw,
    id: raw.id,
    channel: 'direct',
    verified: true,
    skill: raw.skill,
    villageId: raw.villageId,
    employer: raw.employer,
    alsoSkills: Array.isArray(raw.alsoSkills) ? raw.alsoSkills.filter((s): s is SkillId => typeof s === 'string' && isSkillId(s)) : [],
    workplace: raw.workplace === 'city' ? 'city' : 'village',
    womenWelcome: Boolean(raw.womenWelcome),
    stayIncluded: Boolean(raw.stayIncluded),
    foodIncluded: Boolean(raw.foodIncluded),
  }
}

export function emptyStore(): JobsStore {
  return { profile: defaultProfile(), interests: [], posted: [] }
}

export function loadStore(): JobsStore {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return emptyStore()
    const parsed = JSON.parse(raw) as Partial<JobsStore>
    return {
      profile: asProfile(parsed.profile),
      interests: Array.isArray(parsed.interests)
        ? parsed.interests.map(asInterest).filter((row): row is Interest => row !== null)
        : [],
      posted: Array.isArray(parsed.posted)
        ? parsed.posted.map(asPosted).filter((row): row is JobOpening => row !== null)
        : [],
    }
  } catch {
    return emptyStore()
  }
}

export function saveStore(store: JobsStore) {
  localStorage.setItem(KEY, JSON.stringify(store))
}

export function addInterest(store: JobsStore, interest: Omit<Interest, 'id' | 'at'>): JobsStore {
  const next: Interest = { ...interest, id: newId(), at: new Date().toISOString() }
  return { ...store, interests: [next, ...store.interests] }
}
