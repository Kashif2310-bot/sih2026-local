/**
 * Shared application workflow.
 *
 * Citizen profile + selected scheme
 *   → schema → mapping → missing fields → documents → validation
 *   → generated packet → review/corrections → explicit consent
 *   → channel adapter → tracking id
 *
 * Government API, assisted, and guided all enter at the same function.
 */

import { getSchemeApplicationSpec } from './catalog'
import { submitOnChannel, consentTextFor, type ChannelConfig } from './channels'
import { mapProfileToFields, missingRequiredFields, fieldsToRecord } from './mapping'
import { canSubmit, validateDocuments, validateFields } from './validation'
import { buildSubmissionPackage, freezeSnapshot, newApplicationId, type ConversationPayload } from './application'
import type { UserProfile } from '../assistant/types'
import type {
  ConsentRecord,
  DocumentDeclaration,
  FilingChannel,
  GeneratedPacket,
  MappedDocument,
  PreparedApplication,
  TrackedApplication,
  WorkflowStep,
} from './types'
import { WORKFLOW_STEPS } from './types'

export interface PrepareInput {
  schemeId: string
  profile: UserProfile
  fieldOverrides?: Record<string, string | number | boolean | undefined>
  documentDeclarations?: Record<string, DocumentDeclaration>
  channel?: FilingChannel
}

export function prepareApplication(input: PrepareInput): PreparedApplication {
  const scheme = getSchemeApplicationSpec(input.schemeId)
  const mappedFields = mapProfileToFields(scheme.fields, input.profile, input.fieldOverrides)
  const missing = missingRequiredFields(mappedFields)
  const documents: MappedDocument[] = scheme.documents.map((d) => ({
    key: d.key,
    label: d.label,
    required: d.required,
    notes: d.notes,
    declaration: input.documentDeclarations?.[d.key] ?? 'missing',
  }))
  const issues = [...validateFields(scheme.fields, mappedFields), ...validateDocuments(documents)]
  const ready = canSubmit(issues)
  const channel = input.channel ?? scheme.channel.recommended

  const packet: GeneratedPacket | null = ready
    ? {
        schemeId: scheme.schemeId,
        schemeName: scheme.displayName,
        channel,
        fields: fieldsToRecord(mappedFields),
        documents: documents.map((d) => ({ key: d.key, label: d.label, declaration: d.declaration })),
        officialApplicationUrl: scheme.officialApplicationUrl,
        generatedAt: new Date().toISOString(),
      }
    : null

  const completed: WorkflowStep[] = [
    'profile_and_scheme',
    'application_schema',
    'field_mapping',
    'missing_fields',
    'document_requirements',
    'validation',
  ]
  if (packet) completed.push('generated_application')

  return {
    scheme,
    mappedFields,
    missingFields: missing,
    documents,
    issues,
    canPreparePacket: ready,
    packet,
    completedSteps: completed,
  }
}

export interface SubmitInput {
  prepared: PreparedApplication
  channel: FilingChannel
  consentAccepted: boolean
  simulate: boolean
  config?: ChannelConfig
  applicationId?: string
  conversation?: ConversationPayload
}

export async function submitApplication(input: SubmitInput): Promise<TrackedApplication> {
  const now = input.config?.now?.() ?? new Date()
  const iso = now.toISOString()
  const history: TrackedApplication['statusHistory'] = []

  const mark = (step: WorkflowStep, note: string) => {
    history.push({ at: iso, step, note })
  }

  for (const step of input.prepared.completedSteps) {
    mark(step, 'Completed during packet preparation.')
  }
  mark('user_review', 'Applicant reviewed the generated packet.')
  mark('corrections', 'Applicant field overrides (if any) already applied before submit.')

  const consent: ConsentRecord = {
    accepted: input.consentAccepted,
    acceptedAt: input.consentAccepted ? iso : undefined,
    text: consentTextFor(input.channel, input.simulate),
    channel: input.channel,
    simulate: input.simulate,
  }

  const applicationId = input.applicationId ?? newApplicationId()

  if (!input.consentAccepted) {
    mark('explicit_consent', 'Consent was not given — submission blocked.')
    return {
      applicationId,
      trackingId: `LP-BLOCKED-${(input.config?.randomId ?? (() => 'CONSENT'))()}`,
      schemeId: input.prepared.scheme.schemeId,
      schemeName: input.prepared.scheme.displayName,
      channel: input.channel,
      outcome: 'consent_required',
      filedWithGovernment: false,
      simulation: input.simulate,
      honestLabel: 'Explicit consent required — nothing was filed',
      detail: 'Submission is blocked until you tick the consent box. No packet was sent anywhere.',
      nextSteps: ['Read the consent statement and tick the box if you agree.'],
      packet: input.prepared.packet ?? {
        schemeId: input.prepared.scheme.schemeId,
        schemeName: input.prepared.scheme.displayName,
        channel: input.channel,
        fields: {},
        documents: [],
        officialApplicationUrl: input.prepared.scheme.officialApplicationUrl,
        generatedAt: iso,
      },
      consent,
      statusHistory: history,
      createdAt: iso,
      updatedAt: iso,
    }
  }
  mark('explicit_consent', `Consent recorded for ${input.channel}${input.simulate ? ' (simulation)' : ''}.`)

  if (!input.prepared.packet || !input.prepared.canPreparePacket) {
    mark('submission', 'Blocked by validation — channel adapter was not called.')
    return {
      applicationId,
      trackingId: `LP-BLOCKED-${(input.config?.randomId ?? (() => 'VALID'))()}`,
      schemeId: input.prepared.scheme.schemeId,
      schemeName: input.prepared.scheme.displayName,
      channel: input.channel,
      outcome: 'blocked_by_validation',
      filedWithGovernment: false,
      simulation: false,
      honestLabel: 'Validation blocked submission — nothing was filed',
      detail: input.prepared.issues
        .filter((i) => i.blocking)
        .map((i) => i.message)
        .join(' '),
      nextSteps: ['Fix the blocking issues, then consent and submit again.'],
      packet: input.prepared.packet ?? {
        schemeId: input.prepared.scheme.schemeId,
        schemeName: input.prepared.scheme.displayName,
        channel: input.channel,
        fields: {},
        documents: [],
        officialApplicationUrl: input.prepared.scheme.officialApplicationUrl,
        generatedAt: iso,
      },
      consent,
      statusHistory: history,
      createdAt: iso,
      updatedAt: iso,
    }
  }

  const packet: GeneratedPacket = { ...input.prepared.packet, channel: input.channel }
  const result = await submitOnChannel(input.channel, packet, {
    simulate: input.simulate,
    config: input.config,
  })

  mark('submission', result.honestLabel)
  mark('application_id', `Application id ${applicationId} · tracking ${result.trackingId}${result.governmentApplicationId ? ` · government id ${result.governmentApplicationId}` : ''}`)
  mark('status_tracking', result.detail)

  const snapshotPayload = {
    applicationId,
    schemeId: packet.schemeId,
    schemeName: packet.schemeName,
    channel: input.channel,
    conversation: input.conversation ?? null,
    fields: packet.fields,
    documents: packet.documents,
    consentText: consent.text,
    simulate: input.simulate,
    officialApplicationUrl: packet.officialApplicationUrl,
  }
  const snapshot = await freezeSnapshot(snapshotPayload, iso)
  const submissionPackage =
    input.consentAccepted && !input.simulate && result.outcome !== 'blocked_by_validation'
      ? buildSubmissionPackage({
          applicationId,
          filedWithGovernment: result.filedWithGovernment,
          snapshot,
          status: result.filedWithGovernment ? 'channel_dispatched' : 'submission_ready',
        })
      : undefined

  return {
    applicationId,
    trackingId: result.trackingId,
    schemeId: packet.schemeId,
    schemeName: packet.schemeName,
    channel: input.channel,
    outcome: result.outcome,
    filedWithGovernment: result.filedWithGovernment,
    simulation: result.simulation,
    governmentApplicationId: result.governmentApplicationId,
    officialPortalUrl: result.officialPortalUrl,
    honestLabel: result.honestLabel,
    detail: result.detail,
    nextSteps: result.nextSteps,
    packet,
    consent,
    conversation: input.conversation,
    snapshot,
    package: submissionPackage,
    statusHistory: history,
    createdAt: iso,
    updatedAt: iso,
  }
}

export function stepStatus(
  step: WorkflowStep,
  prepared: PreparedApplication,
  submitted?: TrackedApplication,
): 'done' | 'current' | 'blocked' | 'pending' {
  if (submitted) {
    const reached = submitted.statusHistory.some((h) => h.step === step)
    if (reached) return 'done'
    return 'pending'
  }
  if (prepared.completedSteps.includes(step)) return 'done'
  const idx = WORKFLOW_STEPS.indexOf(step)
  const lastDone = prepared.completedSteps[prepared.completedSteps.length - 1]
  const lastIdx = lastDone ? WORKFLOW_STEPS.indexOf(lastDone) : -1
  if (idx === lastIdx + 1) {
    if (step === 'generated_application' && !prepared.canPreparePacket) return 'blocked'
    return 'current'
  }
  return 'pending'
}
