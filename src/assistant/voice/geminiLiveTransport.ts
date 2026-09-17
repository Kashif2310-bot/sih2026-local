/**
 * GeminiLiveTransport — a thin boundary around "however we actually open a
 * bidirectional message channel to Gemini Live". geminiLiveVoiceSession.ts
 * (the VoiceSession adapter) depends only on this interface, never on
 * `WebSocket` directly, for two reasons:
 *
 *   1. Testability — a real Gemini connection should never be required for
 *      unit tests. geminiLiveVoiceSession.test.ts drives the adapter with a
 *      deterministic FakeGeminiLiveTransport (testing/fakeGeminiLiveTransport.ts)
 *      instead, and verifies protocol TRANSLATION, not Google's servers.
 *   2. Connection-mechanism independence — WebSocketGeminiLiveTransport below
 *      is today's real implementation, but if the eventual backend contract
 *      turns out to need something other than a raw WebSocket (e.g. a
 *      wrapped relay), only this file changes, not the adapter's turn/event
 *      logic.
 *
 * This transport operates at the level of already-typed Gemini protocol
 * messages (GeminiLiveClientMessage in, GeminiLiveServerMessage out) — JSON
 * serialization is this file's concern, not the adapter's.
 */

import {
  parseServerMessage,
  type GeminiLiveClientMessage,
  type GeminiLiveServerMessage,
} from './geminiLiveProtocol'
import type { VoiceSessionError } from './types'

/**
 * Where to connect and how. `url` must never embed a long-lived API key —
 * see geminiLiveConfig.ts for the two supported patterns (a developer-run
 * relay/proxy, or Google's own endpoint used with a short-lived ephemeral
 * token). This type says nothing about which pattern is in use; it is
 * produced by whatever GeminiLiveConnectionResolver the caller supplies.
 */
export interface GeminiLiveConnectionTarget {
  url: string
  protocols?: string[]
}

/**
 * Resolves the actual connection target at connect() time. MUST be cheap
 * and side-effect-free when the provider isn't configured (throw/reject
 * quickly, no network call) — see GeminiLiveVoiceSessionDeps.isConfigured
 * in geminiLiveVoiceSession.ts, which is the separate, even-cheaper
 * synchronous check used for isSupported(). A resolver that itself needs a
 * network round-trip (e.g. minting an ephemeral token from a backend) is
 * expected to do that work only here, lazily, not from isConfigured().
 */
export type GeminiLiveConnectionResolver = () => Promise<GeminiLiveConnectionTarget>

export interface GeminiLiveTransportCloseInfo {
  code?: number
  reason?: string
  wasClean: boolean
}

export interface GeminiLiveTransport {
  connect(target: GeminiLiveConnectionTarget): Promise<void>
  send(message: GeminiLiveClientMessage): void
  close(code?: number, reason?: string): void
  onMessage(handler: (message: GeminiLiveServerMessage) => void): () => void
  onError(handler: (error: VoiceSessionError) => void): () => void
  onClose(handler: (info: GeminiLiveTransportCloseInfo) => void): () => void
}

/**
 * The REAL transport — a native browser WebSocket carrying Gemini's JSON
 * text-frame protocol. Every message observed in Google's Live API
 * reference is JSON text with audio embedded as base64 inside it (never a
 * separate binary WebSocket frame) — this implementation does not handle
 * binary frames, and treats one arriving as a provider_error, since nothing
 * in the reference this was built against describes that case.
 */
export class WebSocketGeminiLiveTransport implements GeminiLiveTransport {
  private socket: WebSocket | null = null
  private readonly messageHandlers = new Set<(message: GeminiLiveServerMessage) => void>()
  private readonly errorHandlers = new Set<(error: VoiceSessionError) => void>()
  private readonly closeHandlers = new Set<(info: GeminiLiveTransportCloseInfo) => void>()

  connect(target: GeminiLiveConnectionTarget): Promise<void> {
    if (typeof WebSocket === 'undefined') {
      return Promise.reject(
        new Error('WebSocketGeminiLiveTransport: no global WebSocket implementation is available in this runtime.'),
      )
    }

    return new Promise((resolve, reject) => {
      let settled = false
      const socket = target.protocols ? new WebSocket(target.url, target.protocols) : new WebSocket(target.url)
      this.socket = socket

      const handleOpen = () => {
        settled = true
        resolve()
      }
      const handleOpenFailure = (event: Event) => {
        if (settled) return
        settled = true
        reject(new Error(`WebSocketGeminiLiveTransport: connection failed before opening (${String(event.type)}).`))
      }

      socket.addEventListener('open', handleOpen, { once: true })
      socket.addEventListener('error', handleOpenFailure, { once: true })

      socket.addEventListener('message', (event: MessageEvent) => {
        if (typeof event.data !== 'string') {
          this.dispatchError({ code: 'provider_error', message: 'Received a non-text WebSocket frame; this transport only handles Gemini\'s JSON text-frame protocol.' })
          return
        }
        let raw: unknown
        try {
          raw = JSON.parse(event.data)
        } catch (cause) {
          this.dispatchError({ code: 'provider_error', message: 'Received malformed JSON from Gemini Live.', cause })
          return
        }
        const parsed = parseServerMessage(raw)
        // An unrecognized-but-valid message is silently dropped, never
        // treated as an error — forward compatibility with server message
        // types this adapter doesn't know about yet, same "don't let one
        // unrecognized record break everything else" discipline as
        // liveRetrieval.ts's validateLiveEvidenceItems.
        if (parsed) this.dispatchMessage(parsed)
      })

      socket.addEventListener('error', () => {
        if (!settled) return // already routed through handleOpenFailure above
        this.dispatchError({ code: 'network_lost', message: 'Gemini Live WebSocket reported an error after connecting.' })
      })

      socket.addEventListener('close', (event: CloseEvent) => {
        for (const handler of this.closeHandlers) {
          handler({ code: event.code, reason: event.reason, wasClean: event.wasClean })
        }
      })
    })
  }

  send(message: GeminiLiveClientMessage): void {
    if (!this.socket) throw new Error('WebSocketGeminiLiveTransport: send() called before connect() resolved.')
    this.socket.send(JSON.stringify(message))
  }

  close(code?: number, reason?: string): void {
    this.socket?.close(code, reason)
  }

  onMessage(handler: (message: GeminiLiveServerMessage) => void): () => void {
    this.messageHandlers.add(handler)
    return () => this.messageHandlers.delete(handler)
  }

  onError(handler: (error: VoiceSessionError) => void): () => void {
    this.errorHandlers.add(handler)
    return () => this.errorHandlers.delete(handler)
  }

  onClose(handler: (info: GeminiLiveTransportCloseInfo) => void): () => void {
    this.closeHandlers.add(handler)
    return () => this.closeHandlers.delete(handler)
  }

  private dispatchMessage(message: GeminiLiveServerMessage): void {
    for (const handler of this.messageHandlers) handler(message)
  }

  private dispatchError(error: VoiceSessionError): void {
    for (const handler of this.errorHandlers) handler(error)
  }
}
