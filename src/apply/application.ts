/**
 * Adita application domain — the artifact Jordan's approval service consumes.
 *
 * applicationId is issued when the wizard starts and never reused.
 * After explicit consent the mapped payload is frozen (hashed). Corrections
 * after freeze require withdrawing consent. A submission-ready package is
 * produced only for non-simulation, consented, frozen applications.
 */

export type ApplicationStatus =
  | 'draft'
  | 'mapping_complete'
  | 'awaiting_documents'
  | 'invalid'
  | 'generated'
  | 'under_review'
  | 'corrections_pending'
  | 'awaiting_consent'
  | 'snapshot_frozen'
  | 'submission_ready'
  | 'channel_dispatched'
  | 'blocked'
  | 'simulation_recorded'

export interface ConversationPayload {
  conversationId?: string
  source: 'advisory_chat' | 'scheme_match' | 'manual' | 'assistant'
  extractedProfile: Record<string, unknown>
  citedScheme?: string
  turns?: Array<{ role: string; content: string }>
}

export interface FrozenSnapshot {
  frozen: true
  frozenAt: string
  snapshotHash: string
  payload: Record<string, unknown>
}

export interface SubmissionPackage {
  applicationId: string
  application_id: string
  status: 'submission_ready' | 'channel_dispatched'
  readyForApproval: true
  filedWithGovernment: boolean
  simulation: false
  snapshotHash: string
  snapshot: FrozenSnapshot
  handoff: {
    fromService: 'application-automation'
    fromOwner: 'adita'
    nextService: 'approval-service'
    nextOwner: 'jordan'
    then: string[]
    note: string
  }
}

function canonical(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj)
  if (Array.isArray(obj)) return `[${obj.map(canonical).join(',')}]`
  const rec = obj as Record<string, unknown>
  const keys = Object.keys(rec).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(rec[k])}`).join(',')}}`
}

async function sha256Hex(text: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }
  // Node/vitest fallback — not cryptographic uniqueness, tests still assert freeze-on-consent.
  let hash = 0
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0
  return `fallback${Math.abs(hash).toString(16).padStart(8, '0')}`
}

export function newApplicationId(): string {
  const hex =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase()
      : Math.random().toString(16).slice(2, 10).toUpperCase() + Date.now().toString(16).toUpperCase().slice(-8)
  return `LP-APP-${hex}`
}

export function isApplicationId(value: string): boolean {
  return /^LP-APP-[A-F0-9]{16}$/i.test(value)
}

export async function freezeSnapshot(payload: Record<string, unknown>, frozenAt: string): Promise<FrozenSnapshot> {
  const sealed = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>
  const snapshotHash = `sha256:${await sha256Hex(canonical(sealed))}`
  return { frozen: true, frozenAt, snapshotHash, payload: sealed }
}

export async function verifySnapshot(snapshot: FrozenSnapshot): Promise<boolean> {
  const expected = `sha256:${await sha256Hex(canonical(snapshot.payload))}`
  return snapshot.frozen === true && snapshot.snapshotHash === expected
}

export function buildSubmissionPackage(input: {
  applicationId: string
  filedWithGovernment: boolean
  snapshot: FrozenSnapshot
  status?: 'submission_ready' | 'channel_dispatched'
}): SubmissionPackage {
  return {
    applicationId: input.applicationId,
    application_id: input.applicationId,
    status: input.status ?? 'submission_ready',
    readyForApproval: true,
    filedWithGovernment: input.filedWithGovernment,
    simulation: false,
    snapshotHash: input.snapshot.snapshotHash,
    snapshot: input.snapshot,
    handoff: {
      fromService: 'application-automation',
      fromOwner: 'adita',
      nextService: 'approval-service',
      nextOwner: 'jordan',
      then: ['admin (prerna)', 'multisig', 'audit', 'disbursement_authorization'],
      note: 'This package is submission-ready for approval. It is not an approval, not a government filing, and not a disbursement authorization.',
    },
  }
}
