import {
  buildAudioMessage,
  buildAudioStreamEndMessage,
  buildTextMessage,
  buildToolResponseMessage,
  MalformedMessageError,
  parseServerMessage,
  type LiveServerEvent,
  type ToolResponse,
} from './geminiProtocol'

export const SETUP_TIMEOUT_MS = 8000

/** The subset of the browser WebSocket this session relies on. */
export interface SocketLike {
  readonly readyState: number
  binaryType: string
  send(data: string): void
  close(code?: number, reason?: string): void
  onopen: ((event: unknown) => void) | null
  onmessage: ((event: { data: unknown }) => void) | null
  onerror: ((event: unknown) => void) | null
  onclose: ((event: { code: number; reason: string }) => void) | null
}

export type SocketFactory = (url: string) => SocketLike

export type LiveSessionErrorKind = 'socket' | 'setup_timeout' | 'closed' | 'server_error'

export class LiveSessionError extends Error {
  readonly kind: LiveSessionErrorKind
  readonly code?: number
  /** The close reason Gemini sent, e.g. "Internal error encountered." */
  readonly reason?: string

  constructor(kind: LiveSessionErrorKind, message: string, code?: number, reason?: string) {
    super(message)
    this.name = 'LiveSessionError'
    this.kind = kind
    this.code = code
    this.reason = reason || undefined
  }
}

export interface LiveSessionHandlers {
  onEvent: (event: LiveServerEvent) => void
  /** Fires once for a close the client did not ask for. */
  onClose: (info: { code: number; reason: string }) => void
  onMalformed: (error: MalformedMessageError) => void
}

const OPEN = 1
const decoder = new TextDecoder()

function frameToText(data: unknown): string | null {
  if (typeof data === 'string') return data
  if (data instanceof ArrayBuffer) return decoder.decode(data)
  if (ArrayBuffer.isView(data)) return decoder.decode(data)
  return null
}

export class LiveSession {
  private socket: SocketLike | null = null
  private closedByClient = false
  private readonly createSocket: SocketFactory

  constructor(createSocket: SocketFactory = (url) => new WebSocket(url) as unknown as SocketLike) {
    this.createSocket = createSocket
  }

  get isOpen() {
    return this.socket !== null && this.socket.readyState === OPEN
  }

  /** Opens the socket, sends setup and resolves once the server confirms `setupComplete`. */
  connect(url: string, setup: object, handlers: LiveSessionHandlers, timeoutMs = SETUP_TIMEOUT_MS): Promise<void> {
    return new Promise((resolve, reject) => {
      let ready = false
      let settled = false
      const socket = this.createSocket(url)
      socket.binaryType = 'arraybuffer'
      this.socket = socket

      const failSetup = (error: LiveSessionError) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.closedByClient = true
        socket.close()
        this.socket = null
        reject(error)
      }

      const timer = setTimeout(
        () => failSetup(new LiveSessionError('setup_timeout', 'Gemini Live did not confirm the session in time.')),
        timeoutMs,
      )

      socket.onopen = () => socket.send(JSON.stringify(setup))

      socket.onmessage = (event) => {
        const text = frameToText(event.data)
        if (text === null) return
        let events: LiveServerEvent[]
        try {
          events = parseServerMessage(text)
        } catch (error) {
          if (error instanceof MalformedMessageError) handlers.onMalformed(error)
          return
        }
        for (const serverEvent of events) {
          if (!ready) {
            if (serverEvent.type === 'setupComplete') {
              ready = true
              settled = true
              clearTimeout(timer)
              resolve()
            } else if (serverEvent.type === 'error') {
              failSetup(new LiveSessionError('server_error', serverEvent.message))
              return
            }
            continue
          }
          handlers.onEvent(serverEvent)
        }
      }

      socket.onerror = () => {
        if (!ready) failSetup(new LiveSessionError('socket', 'Could not open the Gemini Live connection.'))
      }

      socket.onclose = (event) => {
        if (this.socket === socket) this.socket = null
        if (!ready) {
          failSetup(
            new LiveSessionError(
              'closed',
              `Gemini Live closed the connection (code ${event.code}${event.reason ? `: ${event.reason}` : ''}).`,
              event.code,
              event.reason,
            ),
          )
          return
        }
        if (!this.closedByClient) handlers.onClose({ code: event.code, reason: event.reason })
      }
    })
  }

  sendAudio(base64Pcm16: string) {
    this.send(buildAudioMessage(base64Pcm16))
  }

  endAudioStream() {
    this.send(buildAudioStreamEndMessage())
  }

  sendText(text: string) {
    this.send(buildTextMessage(text))
  }

  sendToolResponse(responses: ToolResponse[]) {
    this.send(buildToolResponseMessage(responses))
  }

  close() {
    this.closedByClient = true
    const socket = this.socket
    this.socket = null
    if (socket) {
      socket.onmessage = null
      socket.close(1000, 'client closed')
    }
  }

  private send(message: object) {
    if (this.socket && this.socket.readyState === OPEN) this.socket.send(JSON.stringify(message))
  }
}
