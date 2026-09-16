/**
 * FakeGeminiLiveTransport — TEST-ONLY. Never import this from production
 * code (nothing under src/assistant/voice/*.ts outside this testing/
 * directory references it).
 *
 * Implements GeminiLiveTransport without any network — a test drives it
 * directly by calling simulateServerMessage()/simulateError()/simulateClose()
 * to script exactly what "Gemini" says and when, and reads `sentMessages`
 * to assert what the adapter actually sent. This is what makes
 * geminiLiveVoiceSession.test.ts a test of THIS ADAPTER'S PROTOCOL
 * TRANSLATION, not a test of Google's servers — see
 * docs/voice-session-architecture.md "Testing strategy" for the real vs.
 * fake distinction.
 */

import type {
  GeminiLiveConnectionTarget,
  GeminiLiveTransport,
  GeminiLiveTransportCloseInfo,
} from '../geminiLiveTransport'
import type { GeminiLiveClientMessage, GeminiLiveServerMessage } from '../geminiLiveProtocol'
import type { VoiceSessionError } from '../types'

export interface FakeGeminiLiveTransportOptions {
  /** When set, connect() rejects with this instead of succeeding. */
  failConnectWith?: Error
}

export class FakeGeminiLiveTransport implements GeminiLiveTransport {
  readonly sentMessages: GeminiLiveClientMessage[] = []
  readonly connectTargets: GeminiLiveConnectionTarget[] = []
  closeCalls: Array<{ code?: number; reason?: string }> = []
  connected = false

  private readonly messageHandlers = new Set<(message: GeminiLiveServerMessage) => void>()
  private readonly errorHandlers = new Set<(error: VoiceSessionError) => void>()
  private readonly closeHandlers = new Set<(info: GeminiLiveTransportCloseInfo) => void>()
  private readonly options: FakeGeminiLiveTransportOptions

  constructor(options: FakeGeminiLiveTransportOptions = {}) {
    this.options = options
  }

  connect(target: GeminiLiveConnectionTarget): Promise<void> {
    this.connectTargets.push(target)
    if (this.options.failConnectWith) {
      return Promise.reject(this.options.failConnectWith)
    }
    this.connected = true
    return Promise.resolve()
  }

  send(message: GeminiLiveClientMessage): void {
    this.sentMessages.push(message)
  }

  close(code?: number, reason?: string): void {
    this.closeCalls.push({ code, reason })
    this.connected = false
    // Mirrors a real socket eventually firing its own close event after
    // close() is called. geminiLiveVoiceSession.ts's teardownTransport()
    // unsubscribes BEFORE calling close(), so by the time this fires there
    // is normally no listener left — exactly matching real WebSocket
    // behavior once its handlers have been detached.
    for (const handler of this.closeHandlers) handler({ code, reason, wasClean: true })
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

  // -- test-driving API — not part of GeminiLiveTransport ------------------

  /** Delivers one server message exactly as the real transport would after parsing it — see the module doc comment for why this is pre-typed rather than raw JSON. */
  simulateServerMessage(message: GeminiLiveServerMessage): void {
    for (const handler of this.messageHandlers) handler(message)
  }

  /** Simulates a transport-level (not protocol-level) error, e.g. a WebSocket error event. */
  simulateError(error: VoiceSessionError): void {
    for (const handler of this.errorHandlers) handler(error)
  }

  /** Simulates an unexpected close (network drop) — distinct from close(), which is this adapter's OWN intentional teardown. */
  simulateClose(info: Partial<GeminiLiveTransportCloseInfo> = {}): void {
    this.connected = false
    for (const handler of this.closeHandlers) handler({ wasClean: false, ...info })
  }
}
