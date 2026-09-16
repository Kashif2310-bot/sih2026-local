/**
 * Placeholder "backend" for the Application lifecycle: a localStorage-backed
 * store shared between the citizen wizard (src/citizen) and the admin app
 * (src/admin) so a submitted application can actually be tracked and
 * reviewed in the same browser for a demo. This stands in for Vamshi's real
 * routing/data API (see docs/PRERNA_HANDOFF.md) — every function here is a
 * synchronous read/write today but is written as if it already returns a
 * settled value, so callers can be pointed at a real async API later with a
 * minimal diff.
 *
 * Honesty note: this is NOT a real backend. Data lives only in this
 * browser's localStorage — it is not transmitted anywhere, not shared
 * across devices, and can be cleared by the browser at any time. Every
 * admin screen that reads from here must say so on screen.
 */
import { LOKSCORE_WEIGHTS } from '../lib/config'
import type { Application, ApplicationStatus, AuditEvent } from './types'

const STORAGE_KEY = 'lokpulse:admin:applications'
const SEED_FLAG_KEY = 'lokpulse:admin:seeded:v1'

function readAll(): Application[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    return JSON.parse(raw) as Application[]
  } catch {
    return []
  }
}

function writeAll(apps: Application[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(apps))
  } catch {
    // Storage blocked/full (private browsing, quota) — the write is lost on
    // reload but the in-memory call site still gets its updated object back.
  }
}

export function listApplications(): Application[] {
  return readAll().sort((a, b) => b.createdAt - a.createdAt)
}

export function getApplication(id: string): Application | undefined {
  return readAll().find((a) => a.id === id)
}

export function createApplication(app: Application): Application {
  const all = readAll()
  all.push(app)
  writeAll(all)
  return app
}

export function updateApplication(id: string, patch: Partial<Application>): Application | undefined {
  const all = readAll()
  const idx = all.findIndex((a) => a.id === id)
  if (idx === -1) return undefined
  all[idx] = { ...all[idx], ...patch, updatedAt: Date.now() }
  writeAll(all)
  return all[idx]
}

export function appendAudit(id: string, event: Omit<AuditEvent, 'id' | 'at'>): Application | undefined {
  const all = readAll()
  const idx = all.findIndex((a) => a.id === id)
  if (idx === -1) return undefined
  const entry: AuditEvent = {
    ...event,
    id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: Date.now(),
  }
  all[idx] = { ...all[idx], auditTrail: [...all[idx].auditTrail, entry], updatedAt: Date.now() }
  writeAll(all)
  return all[idx]
}

export function setStatus(
  id: string,
  status: ApplicationStatus,
  actor: string,
  detail?: string,
): Application | undefined {
  const all = readAll()
  const idx = all.findIndex((a) => a.id === id)
  if (idx === -1) return undefined
  all[idx] = { ...all[idx], status, updatedAt: Date.now() }
  writeAll(all)
  return appendAudit(id, { actor, action: `status_changed:${status}`, detail })
}

export function newApplicationId(): string {
  return `APP-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
}

function fixtureBreakdown(total: number, quorumRequired: number, quorumPool: number, mentorRequired: boolean) {
  return {
    demand: 70,
    competitionGap: 60,
    weatherFit: 65,
    financialFit: 68,
    eligibility: 80,
    total,
    grade: (total >= 80 ? 'A' : total >= 65 ? 'B' : total >= 50 ? 'C' : 'D') as 'A' | 'B' | 'C' | 'D',
    quorumRequired,
    quorumPool,
    mentorRequired,
    rationale: ['Seeded demo application — figures are fixture data, not a live scan.'],
    rationaleKn: ['ಸೀಡೆಡ್ ಡೆಮೊ ಅರ್ಜಿ — ಅಂಕಿಅಂಶಗಳು ಫಿಕ್ಚರ್ ಡೇಟಾ, ಲೈವ್ ಸ್ಕ್ಯಾನ್ ಅಲ್ಲ.'],
    weights: LOKSCORE_WEIGHTS,
  }
}

function fixtureApplication(input: {
  id: string
  createdAt: number
  name: string
  category: Application['applicant']['category']
  gender: Application['applicant']['gender']
  community: Application['applicant']['community']
  leadMinistryId: Application['leadMinistryId']
  supportingMinistryIds: Application['supportingMinistryIds']
  schemeId: Application['schemeId']
  schemeName: string
  projectCost: number
  loanAmount: number
  lokScore: number
  quorumRequired: number
  quorumPool: number
  mentorRequired: boolean
  status: ApplicationStatus
  signaturesCount: number
}): Application {
  const auditTrail: AuditEvent[] = [
    {
      id: `${input.id}-evt-1`,
      at: input.createdAt,
      actor: input.name,
      action: 'submitted',
      detail: `Application submitted via citizen portal. Routed to ${input.leadMinistryId}.`,
    },
  ]
  if (input.status !== 'submitted') {
    auditTrail.push({
      id: `${input.id}-evt-2`,
      at: input.createdAt + 1000 * 60 * 60,
      actor: 'System',
      action: 'status_changed:under_review',
      detail: 'Assigned to a reviewer pool based on LokScore quorum.',
    })
  }
  if (input.status === 'approved' || input.status === 'disbursed') {
    auditTrail.push({
      id: `${input.id}-evt-3`,
      at: input.createdAt + 1000 * 60 * 60 * 2,
      actor: 'System',
      action: 'status_changed:approved',
      detail: 'Signing quorum met.',
    })
  }

  return {
    id: input.id,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    isDemoSeed: true,
    applicant: {
      name: input.name,
      age: 29,
      gender: input.gender,
      community: input.community,
      phone: '9900000000',
      address: 'Demo address, seeded for the prototype',
      villageOrTown: 'Dinka',
      district: 'Mandya',
      state: 'Karnataka',
      bankAccountNumber: 'XXXXXXXX1234',
      bankIfsc: 'SBIN0001234',
      category: input.category,
      businessDescription: `Seeded demo ${input.category} application — not a real applicant.`,
    },
    leadMinistryId: input.leadMinistryId,
    supportingMinistryIds: input.supportingMinistryIds,
    schemeId: input.schemeId,
    schemeName: input.schemeName,
    projectCost: input.projectCost,
    loanAmount: input.loanAmount,
    lokScore: input.lokScore,
    lokScoreBreakdown: fixtureBreakdown(input.lokScore, input.quorumRequired, input.quorumPool, input.mentorRequired),
    quorumRequired: input.quorumRequired,
    quorumPool: input.quorumPool,
    mentorRequired: input.mentorRequired,
    documents: [
      { id: 'doc-0', labelEn: 'Aadhaar card (identity + address proof)', labelKn: 'ಆಧಾರ್ ಕಾರ್ಡ್', status: 'uploaded', fileName: 'aadhaar.pdf', sizeBytes: 210_000, uploadedAt: input.createdAt },
      { id: 'doc-1', labelEn: 'Caste certificate (SC/ST/OBC as applicable)', labelKn: 'ಜಾತಿ ಪ್ರಮಾಣಪತ್ರ', status: 'uploaded', fileName: 'caste_certificate.pdf', sizeBytes: 180_000, uploadedAt: input.createdAt },
      { id: 'doc-2', labelEn: 'Project report / cost estimate for the proposed business', labelKn: 'ಯೋಜನಾ ವರದಿ', status: 'missing' },
    ],
    signatures: Array.from({ length: input.signaturesCount }).map((_, i) => ({
      reviewerId: `sca-${i + 1}`,
      address: `0xDEMO${i}`,
      signature: `0xseed-signature-${i}`,
      signedAt: input.createdAt + 1000 * 60 * (i + 1),
    })),
    status: input.status,
    consentGiven: true,
    consentAt: input.createdAt,
    auditTrail,
  }
}

/** Seed a handful of fixture applications once, so /admin isn't empty on first load. */
export function seedDemoApplicationsOnce() {
  try {
    if (localStorage.getItem(SEED_FLAG_KEY)) return
  } catch {
    return
  }
  const now = Date.now()
  const seeds: Application[] = [
    fixtureApplication({
      id: 'APP-DEMO-0001',
      createdAt: now - 1000 * 60 * 60 * 6,
      name: 'Lakshmi S.',
      category: 'dairy',
      gender: 'female',
      community: 'sc',
      leadMinistryId: 'animal_husbandry',
      supportingMinistryIds: ['finance', 'social_justice', 'women_child'],
      schemeId: 'term_loan',
      schemeName: 'NSFDC Term Loan Scheme',
      projectCost: 1_000_000,
      loanAmount: 900_000,
      lokScore: 84,
      quorumRequired: 2,
      quorumPool: 3,
      mentorRequired: false,
      status: 'submitted',
      signaturesCount: 0,
    }),
    fixtureApplication({
      id: 'APP-DEMO-0002',
      createdAt: now - 1000 * 60 * 60 * 30,
      name: 'Manjunath R.',
      category: 'poultry',
      gender: 'male',
      community: 'obc',
      leadMinistryId: 'animal_husbandry',
      supportingMinistryIds: ['finance', 'social_justice'],
      schemeId: 'term_loan',
      schemeName: 'NSFDC Term Loan Scheme',
      projectCost: 2_400_000,
      loanAmount: 2_160_000,
      lokScore: 66,
      quorumRequired: 3,
      quorumPool: 5,
      mentorRequired: false,
      status: 'reviewer_assigned',
      signaturesCount: 1,
    }),
    fixtureApplication({
      id: 'APP-DEMO-0003',
      createdAt: now - 1000 * 60 * 60 * 72,
      name: 'Fatima B.',
      category: 'textiles',
      gender: 'female',
      community: 'st',
      leadMinistryId: 'rural_development',
      supportingMinistryIds: ['finance', 'social_justice', 'women_child'],
      schemeId: 'micro_finance',
      schemeName: 'NSFDC Micro Finance Scheme',
      projectCost: 130_000,
      loanAmount: 117_000,
      lokScore: 91,
      quorumRequired: 2,
      quorumPool: 3,
      mentorRequired: false,
      status: 'approved',
      signaturesCount: 2,
    }),
  ]
  writeAll([...readAll(), ...seeds])
  try {
    localStorage.setItem(SEED_FLAG_KEY, '1')
  } catch {
    // ignore — worst case seeds get re-added next load, harmless for a demo
  }
}
