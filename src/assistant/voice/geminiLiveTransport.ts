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
 * Decodes whatever a WebSocket MessageEvent's `data` actually is into the
 * UTF-8 text this protocol's JSON lives in.
 *
 * This exists because of a real, previously-shipped bug: this transport
 * used to accept only `typeof data === 'string'` and treat anything else as
 * an error. In production, Gemini Live sends its JSON control/content
 * messages (including `setupComplete` itself) as BINARY WebSocket frames,
 * not text frames — confirmed empirically both in Node (global `WebSocket`,
 * `event.data instanceof Blob`) and in a real Chrome browser, where the
 * error surfaced as "Received a non-text WebSocket frame..." followed by a
 * connect() timeout, since `setupComplete` itself was silently dropped.
 * Every browser (and Node's global WebSocket) delivers a binary frame as
 * `Blob` by default, or `ArrayBuffer` if `binaryType` is set that way — both
 * are handled here so this transport works regardless of that setting.
 */
async function decodeMessageData(data: unknown): Promise<string> {
  if (typeof data === 'string') return data
  if (data instanceof Blob) return await data.text()
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data)
  // Not a documented WebSocket MessageEvent.data type (spec only allows
  // string/Blob/ArrayBuffer, chosen by binaryType) — but decoding it is
  // just as well-defined as ArrayBuffer, so it is handled rather than
  // treated as an unrecoverable error on principle alone.
  if (ArrayBuffer.isView(data)) {
    return new TextDecoder().decode(data.buffer as ArrayBuffer, { stream: false })
  }
  throw new Error(`Unsupported WebSocket message data type: ${Object.prototype.toString.call(data)}`)
}

/**
 * The REAL transport — a native browser WebSocket carrying Gemini's JSON
 * protocol. See decodeMessageData() above for why this accepts binary
 * frames (Blob/ArrayBuffer) as well as text frames, not just text.
 */
export class WebSocketGeminiLiveTransport implements GeminiLiveTransport {
  private socket: WebSocket | null = null
  private readonly messageHandlers = new Set<(message: GeminiLiveServerMessage) => void>()
  private readonly errorHandlers = new Set<(error: VoiceSessionError) => void>()
  private readonly closeHandlers = new Set<(info: GeminiLiveTransportCloseInfo) => void>()
  /**
   * Every incoming frame is chained onto this promise rather than decoded
   * independently, so that frame order is preserved even though decoding a
   * Blob is asynchronous. Without this, a large audio-chunk frame could
   * still be mid-decode when a later, smaller frame (e.g. a turn-boundary
   * event) finishes decoding first, delivering messages to the adapter out
   * of the order Gemini actually sent them — which the turn/interruption
   * state machine in geminiLiveVoiceSession.ts depends on being correct.
   */
  private messageChain: Promise<void> = Promise.resolve()

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
        // Enqueued synchronously, in the exact order the socket delivered
        // frames — see messageChain's doc comment for why this matters.
        this.messageChain = this.messageChain.then(() => this.handleRawMessage(event.data))
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

  /**
   * Decodes, parses, and dispatches exactly one frame. Always runs from
   * within messageChain, so this never overlaps with the previous or next
   * frame's handling — that ordering guarantee is messageChain's job, not
   * this method's.
   *
   * A frame that cannot be decoded or parsed surfaces a clear, immediate
   * error (never a silent drop) but does not throw — one bad frame must not
   * break messageChain for every frame after it, and connect() is left to
   * time out on its own if the specific frame that was lost was
   * setupComplete, which is a clearer failure than this method guessing
   * that it was.
   */
  private async handleRawMessage(data: unknown): Promise<void> {
    let text: string
    try {
      text = await decodeMessageData(data)
    } catch (cause) {
      this.dispatchError({
        code: 'provider_error',
        message: 'Received a WebSocket frame that could not be decoded to text.',
        cause,
      })
      return
    }

    let raw: unknown
    try {
      raw = JSON.parse(text)
    } catch (cause) {
      this.dispatchError({ code: 'provider_error', message: 'Received malformed JSON from Gemini Live.', cause })
      return
    }

    const parsed = parseServerMessage(raw)
    // An unrecognized-but-valid message is silently dropped, never treated
    // as an error — forward compatibility with server message types this
    // adapter doesn't know about yet, same "don't let one unrecognized
    // record break everything else" discipline as liveRetrieval.ts's
    // validateLiveEvidenceItems.
    if (parsed) this.dispatchMessage(parsed)
  }

  private dispatchMessage(message: GeminiLiveServerMessage): void {
    for (const handler of this.messageHandlers) handler(message)
  }

  private dispatchError(error: VoiceSessionError): void {
    for (const handler of this.errorHandlers) handler(error)
  }
}
