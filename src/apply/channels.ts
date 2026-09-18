/**
 * Last-mile adapters. The workflow above this file is identical for every
 * channel; only this module decides what "submit" means.
 *
 * Hard rule: never return outcome `submitted_to_government` unless a live
 * government endpoint actually accepted the packet. Assisted, guided, and
 * simulation must not use that label.
 */

import type { ChannelSubmitResult, FilingChannel, GeneratedPacket } from './types'

export interface ChannelTransport {
  postJson: (url: string, body: unknown) => Promise<{ ok: boolean; status: number; applicationId?: string; message?: string }>
}

export interface ChannelConfig {
  governmentApiUrl?: string
  now?: () => Date
  randomId?: () => string
  transport?: ChannelTransport
}

const DEFAULT_TRANSPORT: ChannelTransport = {
  async postJson(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    let applicationId: string | undefined
    let message: string | undefined
    try {
      const json = (await res.json()) as { applicationId?: string; application_id?: string; message?: string }
      applicationId = json.applicationId ?? json.application_id
      message = json.message
    } catch {
      message = `HTTP ${res.status}`
    }
    return { ok: res.ok, status: res.status, applicationId, message }
  },
}

function newLocalId(prefix: string, randomId: () => string): string {
  return `${prefix}-${randomId()}`
}

function defaultRandomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().slice(0, 8).toUpperCase()
  }
  return Math.random().toString(36).slice(2, 10).toUpperCase()
}

const WORKFLOW_NEXT_STEPS = [
  'Application package prepared',
  'Application routed for review',
  'Review / approval workflow',
  'Application tracking',
]

export function consentTextFor(channel: FilingChannel, simulate: boolean): string {
  if (simulate) {
    return 'I understand this is a labelled SIMULATION. The application package is recorded for this session and is not sent on an external filing channel.'
  }
  if (channel === 'government_api') {
    return 'I confirm the details are accurate and I consent to sending this application package to the connected government apply API when one is configured.'
  }
  if (channel === 'assisted') {
    return 'I confirm the details are accurate and I consent to preparing this application package for agency filing and routing it through the LokPulse review workflow.'
  }
  return 'I confirm the details are accurate and I consent to preparing this application package and routing it through the LokPulse review workflow.'
}

export async function submitOnChannel(
  channel: FilingChannel,
  packet: GeneratedPacket,
  options: { simulate: boolean; config?: ChannelConfig },
): Promise<ChannelSubmitResult> {
  const cfg = options.config ?? {}
  const randomId = cfg.randomId ?? defaultRandomId
  const transport = cfg.transport ?? DEFAULT_TRANSPORT
  const govUrl = (cfg.governmentApiUrl ?? import.meta.env.VITE_GOV_APPLY_API_URL ?? '').trim()

  if (options.simulate) {
    return {
      outcome: 'simulation_recorded',
      filedWithGovernment: false,
      simulation: true,
      trackingId: newLocalId('LP-SIM', randomId),
      officialPortalUrl: packet.officialApplicationUrl,
      nextSteps: WORKFLOW_NEXT_STEPS,
      honestLabel: 'Simulation recorded',
      detail: 'A labelled simulation tracking id was created for this session.',
    }
  }

  if (channel === 'government_api') {
    if (!govUrl) {
      return {
        outcome: 'government_api_unavailable',
        filedWithGovernment: false,
        simulation: false,
        trackingId: newLocalId('LP-API-UNAVAIL', randomId),
        officialPortalUrl: packet.officialApplicationUrl,
        nextSteps: WORKFLOW_NEXT_STEPS,
        honestLabel: 'Application package prepared',
        detail: 'The external government filing channel is not connected for this scheme.',
      }
    }

    try {
      const res = await transport.postJson(govUrl, packet)
      if (res.ok && res.applicationId) {
        return {
          outcome: 'submitted_to_government',
          filedWithGovernment: true,
          simulation: false,
          trackingId: res.applicationId,
          governmentApplicationId: res.applicationId,
          officialPortalUrl: packet.officialApplicationUrl,
          nextSteps: [
            `Government application id ${res.applicationId} was returned by the connected apply API.`,
            ...WORKFLOW_NEXT_STEPS,
          ],
          honestLabel: 'Application package prepared and accepted by the connected apply API',
          detail: res.message ?? 'The connected government apply API accepted the packet and returned an application id.',
        }
      }
      return {
        outcome: 'government_api_rejected',
        filedWithGovernment: false,
        simulation: false,
        trackingId: newLocalId('LP-API-REJECT', randomId),
        officialPortalUrl: packet.officialApplicationUrl,
        nextSteps: WORKFLOW_NEXT_STEPS,
        honestLabel: 'Application package prepared',
        detail: res.message ?? `The connected apply API responded with HTTP ${res.status} and no application id.`,
      }
    } catch (err) {
      return {
        outcome: 'government_api_unavailable',
        filedWithGovernment: false,
        simulation: false,
        trackingId: newLocalId('LP-API-ERROR', randomId),
        officialPortalUrl: packet.officialApplicationUrl,
        nextSteps: WORKFLOW_NEXT_STEPS,
        honestLabel: 'Application package prepared',
        detail: err instanceof Error ? err.message : 'The connected apply API could not be reached.',
      }
    }
  }

  if (channel === 'assisted') {
    return {
      outcome: 'assisted_packet_ready',
      filedWithGovernment: false,
      simulation: false,
      trackingId: newLocalId('LP-ASSIST', randomId),
      officialPortalUrl: packet.officialApplicationUrl,
      nextSteps: WORKFLOW_NEXT_STEPS,
      honestLabel: 'Application package prepared',
      detail: 'Your application has been prepared and routed through the LokPulse review workflow.',
    }
  }

  return {
    outcome: 'guided_packet_ready',
    filedWithGovernment: false,
    simulation: false,
    trackingId: newLocalId('LP-GUIDED', randomId),
    officialPortalUrl: packet.officialApplicationUrl,
    nextSteps: WORKFLOW_NEXT_STEPS,
    honestLabel: 'Application package prepared',
    detail: 'Your application has been prepared and routed through the LokPulse review workflow.',
  }
}
