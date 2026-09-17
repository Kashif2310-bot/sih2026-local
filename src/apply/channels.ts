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

export function consentTextFor(channel: FilingChannel, simulate: boolean): string {
  if (simulate) {
    return 'I understand this is a SIMULATION only. Nothing will be filed with any government office, bank, or portal.'
  }
  if (channel === 'government_api') {
    return 'I confirm the details are accurate and I consent to this application being sent to the configured government apply API. I understand a "submitted" result is shown only if that API accepts it.'
  }
  if (channel === 'assisted') {
    return 'I confirm the details are accurate and I consent to generating an assisted-filing packet for my bank / SCA / local agency. I understand this is NOT a government submission.'
  }
  return 'I confirm the details are accurate and I consent to generating a guided-filing packet. I understand I must submit it myself on the official portal — this app does not file it for me.'
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
      nextSteps: [
        'This was a simulation. No government office, bank, or portal received this packet.',
        'Turn simulation off and pick Guided or Assisted to prepare a real packet, or configure a government apply API for live filing.',
      ],
      honestLabel: 'Simulation only — nothing was filed',
      detail:
        'You opted into simulation. A local tracking id was created for demo purposes. It is not a government application id.',
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
        nextSteps: [
          'No government apply API is configured (VITE_GOV_APPLY_API_URL is empty).',
          'Use Guided submission to file on the official portal, or Assisted to prepare a packet for your SCA / bank.',
          `Official portal: ${packet.officialApplicationUrl}`,
        ],
        honestLabel: 'Government API not configured — not submitted',
        detail:
          'This prototype has no credentials-backed apply API for this scheme. It will not report a successful government filing.',
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
            `Government application id ${res.applicationId} was returned by the apply API.`,
            'Track status on the official portal as well as in this app.',
          ],
          honestLabel: 'Submitted to the configured government apply API',
          detail: res.message ?? 'The government apply API accepted the packet and returned an application id.',
        }
      }
      return {
        outcome: 'government_api_rejected',
        filedWithGovernment: false,
        simulation: false,
        trackingId: newLocalId('LP-API-REJECT', randomId),
        officialPortalUrl: packet.officialApplicationUrl,
        nextSteps: [
          'The government apply API did not accept this packet.',
          res.message ? `API message: ${res.message}` : `HTTP status ${res.status}.`,
          'Correct the packet or file on the official portal instead.',
        ],
        honestLabel: 'Government API rejected the packet — not submitted',
        detail: res.message ?? `The apply API responded with HTTP ${res.status} and no application id.`,
      }
    } catch (err) {
      return {
        outcome: 'government_api_unavailable',
        filedWithGovernment: false,
        simulation: false,
        trackingId: newLocalId('LP-API-ERROR', randomId),
        officialPortalUrl: packet.officialApplicationUrl,
        nextSteps: [
          'Could not reach the configured government apply API.',
          'Nothing was filed. Retry later or use Guided / Assisted.',
        ],
        honestLabel: 'Government API unreachable — not submitted',
        detail: err instanceof Error ? err.message : 'Network error calling the apply API.',
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
      nextSteps: [
        'Take this packet to your bank, SCA, or local implementing agency.',
        'They file on the official channel — this app did not.',
        `Official information: ${packet.officialApplicationUrl}`,
      ],
      honestLabel: 'Assisted packet ready — not filed with government',
      detail:
        'A local tracking id was issued so you can follow this packet. It is not a government application id.',
    }
  }

  return {
    outcome: 'guided_packet_ready',
    filedWithGovernment: false,
    simulation: false,
    trackingId: newLocalId('LP-GUIDED', randomId),
    officialPortalUrl: packet.officialApplicationUrl,
    nextSteps: [
      'Open the official application portal and submit there yourself.',
      'Use this packet to copy fields. This app does not submit the form for you.',
      `Official portal: ${packet.officialApplicationUrl}`,
    ],
    honestLabel: 'Guided packet ready — you still need to file on the official portal',
    detail:
      'A local tracking id was issued for the packet. The government application id will only exist after you submit on the official portal.',
  }
}
