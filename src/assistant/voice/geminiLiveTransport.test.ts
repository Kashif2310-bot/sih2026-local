import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebSocketGeminiLiveTransport, type GeminiLiveConnectionTarget } from './geminiLiveTransport'
import { GeminiLiveVoiceSession, type GeminiLiveVoiceSessionDeps } from './geminiLiveVoiceSession'
import type { GeminiLiveServerMessage } from './geminiLiveProtocol'
import type { VoiceSessionError } from './types'

/**
 * WebSocketGeminiLiveTransport had NO test coverage before this file —
 * geminiLiveVoiceSession.test.ts deliberately drives the adapter through
 * FakeGeminiLiveTransport instead (see that file's own header comment),
 * which fakes the already-PARSED message interface and never touches a
 * real `WebSocket` or a `MessageEvent` at all. That left exactly the layer
 * where a real, previously-shipped bug lived — this transport accepted only
 * `typeof event.data === 'string'` and treated Gemini's actual binary
 * frames (delivered as `Blob` by every browser, and by Node's global
 * WebSocket) as an unrecoverable error, so `setupComplete` itself was
 * silently dropped and every real connection timed out. Confirmed in a
 * real Chrome browser and empirically reproduced against the real deployed
 * gemini-live-token function from Node before being fixed.
 *
 * FakeWebSocket below fakes the RAW `WebSocket` surface this transport
 * actually uses (addEventListener/send/close), not the already-parsed
 * GeminiLiveTransport interface — so these tests exercise the exact code
 * that was broken.
 */

class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  readonly url: string
  readonly protocols?: string[]
  readonly sent: string[] = []
  private readonly listeners = new Map<string, Set<(event: unknown) => void>>()

  constructor(url: string, protocols?: string[]) {
    this.url = url
    this.protocols = protocols
    FakeWebSocket.instances.push(this)
  }

  addEventListener(type: string, handler: (event: unknown) => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type)!.add(handler)
  }

  removeEventListener(type: string, handler: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(handler)
  }

  send(data: string): void {
    this.sent.push(data)
  }

  close(): void {
    this.dispatch('close', { code: 1000, reason: '', wasClean: true })
  }

  // -- test-driving helpers, not part of the real WebSocket surface -------

  simulateOpen(): void {
    this.dispatch('open', {})
  }

  /** `data` is whatever type a real MessageEvent.data would be — string, Blob, or ArrayBuffer. */
  simulateMessage(data: unknown): void {
    this.dispatch('message', { data })
  }

  simulateClose(info: { code?: number; reason?: string; wasClean?: boolean } = {}): void {
    this.dispatch('close', { code: 1000, reason: '', wasClean: true, ...info })
  }

  private dispatch(type: string, event: unknown): void {
    for (const handler of this.listeners.get(type) ?? []) handler(event)
  }
}

const TARGET: GeminiLiveConnectionTarget = { url: 'wss://fake.test/gemini-live' }

/** Connects a fresh transport and returns its FakeWebSocket, past the open handshake. */
async function connectedHarness() {
  vi.stubGlobal('WebSocket', FakeWebSocket)
  const transport = new WebSocketGeminiLiveTransport()
  const messages: GeminiLiveServerMessage[] = []
  const errors: VoiceSessionError[] = []
  transport.onMessage((m) => messages.push(m))
  transport.onError((e) => errors.push(e))

  const connectPromise = transport.connect(TARGET)
  const socket = FakeWebSocket.instances.at(-1)!
  socket.simulateOpen()
  await connectPromise

  return { transport, socket, messages, errors }
}

afterEach(() => {
  FakeWebSocket.instances = []
  vi.unstubAllGlobals()
})

describe('WebSocketGeminiLiveTransport — message decoding', () => {
  it('decodes a plain string frame (the always-worked case)', async () => {
    const { socket, messages } = await connectedHarness()
    socket.simulateMessage(JSON.stringify({ setupComplete: {} }))
    await vi.waitFor(() => expect(messages).toHaveLength(1))
    expect(messages[0]).toEqual({ setupComplete: {} })
  })

  it('decodes a Blob frame — this is the real bug: Gemini sends binary frames, and every browser delivers those as Blob by default', async () => {
    const { socket, messages, errors } = await connectedHarness()
    const blob = new Blob([JSON.stringify({ setupComplete: {} })])
    socket.simulateMessage(blob)
    await vi.waitFor(() => expect(messages).toHaveLength(1))
    expect(messages[0]).toEqual({ setupComplete: {} })
    expect(errors).toHaveLength(0)
  })

  it('decodes an ArrayBuffer frame (binaryType: "arraybuffer")', async () => {
    const { socket, messages } = await connectedHarness()
    const buffer = new TextEncoder().encode(JSON.stringify({ setupComplete: {} })).buffer
    socket.simulateMessage(buffer)
    await vi.waitFor(() => expect(messages).toHaveLength(1))
    expect(messages[0]).toEqual({ setupComplete: {} })
  })

  it('surfaces a clear, specific error for a frame that cannot be decoded to text at all', async () => {
    const { socket, messages, errors } = await connectedHarness()
    socket.simulateMessage(12345) // not string/Blob/ArrayBuffer/ArrayBufferView
    await vi.waitFor(() => expect(errors).toHaveLength(1))
    expect(errors[0]).toMatchObject({ code: 'provider_error' })
    expect(errors[0].message).toMatch(/could not be decoded/i)
    expect(messages).toHaveLength(0)
  })

  it('surfaces a clear, specific error for a decoded frame that is not valid JSON — not a silent hang', async () => {
    const { socket, messages, errors } = await connectedHarness()
    socket.simulateMessage(new Blob(['this is not JSON']))
    await vi.waitFor(() => expect(errors).toHaveLength(1))
    expect(errors[0]).toMatchObject({ code: 'provider_error' })
    expect(errors[0].message).toMatch(/malformed json/i)
    expect(messages).toHaveLength(0)
  })

  it('one undecodable/malformed frame does not break processing of frames after it', async () => {
    const { socket, messages, errors } = await connectedHarness()
    socket.simulateMessage(new Blob(['not json']))
    socket.simulateMessage(JSON.stringify({ setupComplete: {} }))
    await vi.waitFor(() => expect(messages).toHaveLength(1))
    expect(errors).toHaveLength(1)
    expect(messages[0]).toEqual({ setupComplete: {} })
  })
})

describe('WebSocketGeminiLiveTransport — message ordering under async Blob decode', () => {
  it('dispatches messages in the order Gemini sent them, even when an earlier Blob decodes slower than a later one', async () => {
    const { socket, messages } = await connectedHarness()

    // The FIRST message is a large-audio-chunk stand-in whose .text() is
    // deliberately slow; the SECOND is a small control message that would
    // resolve first if messages were decoded independently instead of
    // through the sequential queue. If ordering were broken, "second"
    // would appear in `messages` before "first".
    const textSpy = vi.spyOn(Blob.prototype, 'text')
    textSpy.mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(() => resolve(JSON.stringify({ toolCall: { functionCalls: [{ id: 'first', name: 'a', args: {} }] } })), 30)),
    )
    textSpy.mockImplementationOnce(() => Promise.resolve(JSON.stringify({ toolCallCancellation: { ids: ['second'] } })))

    socket.simulateMessage(new Blob(['placeholder-first']))
    socket.simulateMessage(new Blob(['placeholder-second']))

    await vi.waitFor(() => expect(messages).toHaveLength(2))
    expect(messages[0]).toMatchObject({ toolCall: { functionCalls: [{ id: 'first' }] } })
    expect(messages[1]).toMatchObject({ toolCallCancellation: { ids: ['second'] } })

    textSpy.mockRestore()
  })

  it('keeps ordering across a mix of string, Blob, and ArrayBuffer frames', async () => {
    const { socket, messages } = await connectedHarness()
    socket.simulateMessage(JSON.stringify({ toolCallCancellation: { ids: ['1'] } }))
    socket.simulateMessage(new Blob([JSON.stringify({ toolCallCancellation: { ids: ['2'] } })]))
    socket.simulateMessage(new TextEncoder().encode(JSON.stringify({ toolCallCancellation: { ids: ['3'] } })).buffer)

    await vi.waitFor(() => expect(messages).toHaveLength(3))
    expect(messages.map((m) => (m as { toolCallCancellation: { ids: string[] } }).toolCallCancellation.ids[0])).toEqual([
      '1',
      '2',
      '3',
    ])
  })
})

describe('GeminiLiveVoiceSession + the REAL transport — full vertical slice', () => {
  it('reaches "listening" when setupComplete arrives as a Blob, exactly matching the real Chrome bug this fixes', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const deps: GeminiLiveVoiceSessionDeps = {
      createTransport: () => new WebSocketGeminiLiveTransport(),
      resolveConnection: () => Promise.resolve(TARGET),
      isConfigured: () => true,
      model: 'models/test-model',
    }
    const session = new GeminiLiveVoiceSession({ language: { primary: 'en' } }, deps)

    const connectPromise = session.connect()
    await vi.waitFor(() => expect(FakeWebSocket.instances.length).toBeGreaterThan(0))
    const socket = FakeWebSocket.instances.at(-1)!
    socket.simulateOpen()

    // connect() sends the setup message immediately once the socket opens —
    // wait for that real send before replying, exactly as a real server would.
    await vi.waitFor(() => expect(socket.sent.length).toBeGreaterThan(0))
    socket.simulateMessage(new Blob([JSON.stringify({ setupComplete: {} })]))

    await connectPromise
    expect(session.status).toBe('listening')
  })

  it('fails clearly (not a silent hang) when the connection closes before a decodable setupComplete arrives', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const deps: GeminiLiveVoiceSessionDeps = {
      createTransport: () => new WebSocketGeminiLiveTransport(),
      resolveConnection: () => Promise.resolve(TARGET),
      isConfigured: () => true,
      model: 'models/test-model',
    }
    const session = new GeminiLiveVoiceSession({ language: { primary: 'en' } }, deps)

    const connectPromise = session.connect()
    await vi.waitFor(() => expect(FakeWebSocket.instances.length).toBeGreaterThan(0))
    const socket = FakeWebSocket.instances.at(-1)!
    socket.simulateOpen()
    await vi.waitFor(() => expect(socket.sent.length).toBeGreaterThan(0))

    socket.simulateClose({ code: 1008, reason: 'Method doesn\'t allow unregistered callers' })

    await expect(connectPromise).rejects.toThrow(/closed before setup completed/)
    expect(session.status).toBe('error')
  })
})
