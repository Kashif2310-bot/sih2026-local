/**
 * Jordan approval persistence — stores Jordan runtime objects; does not redesign multisig.
 * Source of truth for approval logic: src/lib/approval/*
 */

import type {
  ApprovalCase,
  ApprovalSignature,
  AuditEvent,
  DisbursementAuthorization,
} from '../../lib/approval/contracts'
import type { LokPulseSupabaseClient } from '../supabase/client'
import { BackendError, toBackendError } from '../errors'

export interface ChainAnchorRecord {
  applicationId: string
  reportHash: string
  authorizationDigest?: string
  quorumRequired?: number
  mentorRequired: boolean
  txRef?: string
  chainId?: string
  /** Must remain true in prototype — never claim real on-chain PII anchoring. */
  simulated: true
  payload: Record<string, unknown>
  anchoredAt: string
}

export interface JordanApprovalPersistence {
  saveCase(approvalCase: ApprovalCase): Promise<ApprovalCase>
  getCase(applicationId: string): Promise<ApprovalCase | null>
  saveSignatures(applicationId: string, signatures: ApprovalSignature[]): Promise<void>
  appendAuditEvents(events: AuditEvent[]): Promise<void>
  listAuditEvents(applicationId: string, limit?: number): Promise<AuditEvent[]>
  saveChainAnchor(anchor: ChainAnchorRecord): Promise<ChainAnchorRecord>
  /** Persist authorization digest only — never PII. */
  saveAuthorizationAnchor(
    auth: DisbursementAuthorization,
    opts?: { txRef?: string; chainId?: string },
  ): Promise<ChainAnchorRecord>
}

export function createMemoryJordanApprovalPersistence(): JordanApprovalPersistence {
  const cases = new Map<string, ApprovalCase>()
  const audit = new Map<string, AuditEvent[]>()
  const anchors: ChainAnchorRecord[] = []

  return {
    async saveCase(approvalCase) {
      cases.set(approvalCase.applicationId, structuredClone(approvalCase))
      return structuredClone(approvalCase)
    },
    async getCase(applicationId) {
      const c = cases.get(applicationId)
      return c ? structuredClone(c) : null
    },
    async saveSignatures(applicationId, signatures) {
      const c = cases.get(applicationId)
      if (!c) throw new BackendError('NOT_FOUND', `Approval case not found: ${applicationId}`)
      c.signatures = [...signatures]
      cases.set(applicationId, c)
    },
    async appendAuditEvents(events) {
      for (const e of events) {
        const list = audit.get(e.applicationId) ?? []
        list.push(e)
        audit.set(e.applicationId, list)
      }
    },
    async listAuditEvents(applicationId, limit = 100) {
      return (audit.get(applicationId) ?? []).slice(-limit)
    },
    async saveChainAnchor(anchor) {
      if (!anchor.simulated) {
        throw new BackendError('VALIDATION', 'Chain anchors must be marked simulated; no PII on-chain')
      }
      anchors.push(anchor)
      return anchor
    },
    async saveAuthorizationAnchor(auth, opts) {
      return this.saveChainAnchor({
        applicationId: auth.applicationId,
        reportHash: auth.applicationHash,
        authorizationDigest: auth.authorizationDigest,
        quorumRequired: auth.quorumRequired,
        mentorRequired: auth.mentorRequired,
        txRef: opts?.txRef,
        chainId: opts?.chainId,
        simulated: true,
        payload: {
          acceptedSignerRefs: auth.acceptedSignerRefs,
          auditHeadHash: auth.auditHeadHash,
          authorizedAt: auth.authorizedAt,
        },
        anchoredAt: new Date().toISOString(),
      })
    },
  }
}

export function createSupabaseJordanApprovalPersistence(
  client: LokPulseSupabaseClient,
): JordanApprovalPersistence {
  return {
    async saveCase(approvalCase) {
      try {
        const { error } = await client.from('approval_cases').upsert(
          {
            application_id: approvalCase.applicationId,
            case_json: approvalCase,
            status: approvalCase.status,
            snapshot_digest: approvalCase.snapshotDigest,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'application_id' },
        )
        if (error) throw toBackendError(error)

        if (approvalCase.signatures.length) {
          await this.saveSignatures(approvalCase.applicationId, approvalCase.signatures)
        }
        return approvalCase
      } catch (err) {
        throw toBackendError(err)
      }
    },

    async getCase(applicationId) {
      try {
        const { data, error } = await client
          .from('approval_cases')
          .select('case_json')
          .eq('application_id', applicationId)
          .maybeSingle()
        if (error) throw toBackendError(error)
        return data ? (data.case_json as ApprovalCase) : null
      } catch (err) {
        throw toBackendError(err)
      }
    },

    async saveSignatures(applicationId, signatures) {
      try {
        // Replace-set: delete then insert (service-role / privileged client expected for writes)
        const { error: delErr } = await client
          .from('approval_signatures')
          .delete()
          .eq('application_id', applicationId)
        if (delErr) throw toBackendError(delErr)

        if (!signatures.length) return
        const rows = signatures.map((s) => ({
          application_id: applicationId,
          reviewer_id: s.reviewerId,
          address: s.address,
          signature: s.signature,
          signed_at: new Date(s.signedAt).toISOString(),
        }))
        const { error } = await client.from('approval_signatures').insert(rows)
        if (error) throw toBackendError(error)
      } catch (err) {
        throw toBackendError(err)
      }
    },

    async appendAuditEvents(events) {
      if (!events.length) return
      try {
        const rows = events.map((e) => ({
          event_id: e.eventId,
          application_id: e.applicationId,
          event_type: e.eventType,
          event_timestamp: e.timestamp,
          actor_ref: e.actorRef ?? null,
          data_ref: e.dataRef ?? null,
          prev_event_hash: e.prevEventHash,
          event_hash: e.eventHash,
          event_json: e,
        }))
        const { error } = await client.from('approval_audit_events').upsert(rows, {
          onConflict: 'event_id',
        })
        if (error) throw toBackendError(error)
      } catch (err) {
        throw toBackendError(err)
      }
    },

    async listAuditEvents(applicationId, limit = 100) {
      try {
        const { data, error } = await client
          .from('approval_audit_events')
          .select('event_json')
          .eq('application_id', applicationId)
          .order('event_timestamp', { ascending: true })
          .limit(limit)
        if (error) throw toBackendError(error)
        return ((data ?? []) as Array<{ event_json: AuditEvent }>).map((r) => r.event_json)
      } catch (err) {
        throw toBackendError(err)
      }
    },

    async saveChainAnchor(anchor) {
      if (!anchor.simulated) {
        throw new BackendError('VALIDATION', 'Chain anchors must be marked simulated; no PII on-chain')
      }
      try {
        const { error } = await client.from('chain_anchors').insert({
          application_id: anchor.applicationId,
          report_hash: anchor.reportHash,
          authorization_digest: anchor.authorizationDigest ?? null,
          quorum_required: anchor.quorumRequired ?? null,
          mentor_required: anchor.mentorRequired,
          tx_ref: anchor.txRef ?? null,
          chain_id: anchor.chainId ?? null,
          simulated: true,
          payload: anchor.payload,
          anchored_at: anchor.anchoredAt,
        })
        if (error) throw toBackendError(error)
        return anchor
      } catch (err) {
        throw toBackendError(err)
      }
    },

    async saveAuthorizationAnchor(auth, opts) {
      return this.saveChainAnchor({
        applicationId: auth.applicationId,
        reportHash: auth.applicationHash,
        authorizationDigest: auth.authorizationDigest,
        quorumRequired: auth.quorumRequired,
        mentorRequired: auth.mentorRequired,
        txRef: opts?.txRef,
        chainId: opts?.chainId,
        simulated: true,
        payload: {
          acceptedSignerRefs: auth.acceptedSignerRefs,
          auditHeadHash: auth.auditHeadHash,
          authorizedAt: auth.authorizedAt,
        },
        anchoredAt: new Date().toISOString(),
      })
    },
  }
}
