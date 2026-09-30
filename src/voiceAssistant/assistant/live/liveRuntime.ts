import type { DocumentKind } from '../../application/documents'
import type { FeasibilityInputs, FeasibilityResult } from '../../application/feasibility'
import { applicationStore, type ApplicationStore } from '../../application/store'
import type { DocumentDeclaration } from '../../../apply/types'
import { deriveAdvisorView, INITIAL_ADVISOR_STATE } from '../advisor/advisor'
import { AdvisorSession, LIVE_FEASIBILITY } from '../advisor/advisorSession'
import { ADVISOR_TOOL_DECLARATIONS } from '../advisor/advisorTools'
import { profileFacts } from '../advisor/format'
import { buildSystemInstruction, type ConversationTurn, type VoiceLanguage } from '../advisor/systemInstruction'
import type { AssistantSnapshot } from '../types'
import { transition, type VoiceEvent } from '../voiceState'
import { AudioOutputPlayer, PlaybackError, type PlayerHandlers } from './audioPlayer'
import {
  buildLiveUrl,
  buildSetupMessage,
  ISHAARA_VOICE_NAME,
  LANGUAGE_CODES,
  type LiveServerEvent,
  type ToolCall,
  type ToolResponse,
} from './geminiProtocol'
import { LiveSession, LiveSessionError, type LiveSessionHandlers } from './liveSession'
import { MicrophoneCapture, MicrophoneError, type MicrophoneFrame } from './microphone'
import { bytesToBase64 } from './pcm'
import {
  isLiveConfigured,
  LiveTokenError,
  readLiveTokenConfig,
  resolveLiveToken,
  type LiveToken,
} from './tokenResolver'

/** Quiet time after the last real speech (mic level and transcript) before showing "thinking". */
export const END_OF_SPEECH_SILENCE_MS = 900
/** A reply that never produces audio returns the UI to listening instead of hanging. */
export const THINKING_TIMEOUT_MS = 15000
/** Upper bound on discarding the remainder of a reply the user interrupted. */
export const DISCARD_WINDOW_MS = 8000
/**
 * Gemini Live drops sessions with 1011 (internal error), or ends them without warning after a few
 * minutes. The runtime reconnects, carrying the conversation over, waiting this long before each
 * attempt. The error only shows once every attempt failed without a session proving healthy.
 */
export const RECONNECT_DELAYS_MS = [0, 1000, 2000, 4000, 8000]
/** A session that answered, or stayed open this long, was healthy: its drop starts a fresh set of attempts. */
export const HEALTHY_SESSION_MS = 30_000
/** Times one unanswered turn is sent again. A turn that keeps losing its session is dropped and the user asked to repeat it. */
export const MAX_RESENDS = 2
export const REPEAT_NOTICE = 'Connection dropped. Please say that again.'
/** Exchanges carried into a renewed session, so it continues the conversation instead of starting over. */
const RECENT_TURNS = 6
const RECENT_TURN_CHARS = 300
/**
 * Gemini's own activity detection normally closes a spoken turn about 0.6 s after the user stops.
 * When it misses the end (the turn stays open, nothing comes back), the runtime closes it after this
 * much local silence instead. Gemini only transcribes the user once the turn is closed.
 */
export const LOCAL_TURN_END_SILENCE_MS = 1500
/** Voiced audio needed before the local fallback treats the sound as speech, not a cough or a click. */
export const MIN_SPOKEN_MS = 400
/** Audio kept while the stream is held, so the first syllable of the next sentence is not lost. */
const HELD_PREROLL_FRAMES = 8
const INPUT_BYTES_PER_MS = 32
const LEVEL_POLL_MS = 80
const VOICED_LEVEL = 0.08
const LEVEL_EPSILON = 0.03

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'failed'
export type MicrophoneStatus = 'off' | 'requesting' | 'on' | 'failed'

export interface LiveDiagnostics {
  configured: boolean
  voiceName: string
  connection: ConnectionStatus
  microphone: MicrophoneStatus
  playback: 'idle' | 'playing'
  lastServerEvent: string | null
  malformedFrames: number
  lastCloseCode: number | null
  lastCloseReason: string | null
  reconnects: number
  /** Replies Gemini never started on an open connection, recovered by reconnecting. */
  stalls: number
  lastError: string | null
}

export interface LiveSnapshot extends AssistantSnapshot {
  /** Token, permission or socket setup is in flight. The voice state stays truthful meanwhile. */
  connecting: boolean
  /** A short, non-error message for the user, e.g. that a reconnect lost their last words. */
  notice: string | null
  diagnostics: LiveDiagnostics
}

export interface SessionLike {
  readonly isOpen: boolean
  connect(url: string, setup: object, handlers: LiveSessionHandlers): Promise<void>
  sendAudio(base64Pcm16: string): void
  endAudioStream(): void
  sendText(text: string): void
  sendToolResponse(responses: ToolResponse[]): void
  close(): void
}

export interface MicrophoneLike {
  start(onFrame: (frame: MicrophoneFrame) => void, onEnded: () => void): Promise<void>
  stop(): void
}

export interface PlayerLike {
  readonly isPlaying: boolean
  setHandlers(handlers: PlayerHandlers): void
  prime(): Promise<void>
  enqueue(bytes: Uint8Array): void
  interrupt(): void
  level(): number
  close(): void
}

export interface LiveRuntimeDeps {
  configured: boolean
  resolveToken: (signal: AbortSignal) => Promise<LiveToken>
  createSession: () => SessionLike
  microphone: MicrophoneLike
  player: PlayerLike
  now?: () => number
  store?: ApplicationStore | null
  computeFeasibility?: ((inputs: FeasibilityInputs) => Promise<FeasibilityResult>) | null
  feasibilityDebounceMs?: number
}

const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError'
const isQuotaClose = (reason: string | undefined) => /quota|exhaust|rate.?limit/i.test(reason ?? '')
/** Closes that mean the request itself is refused (invalid setup, bad token, policy), which a reconnect cannot fix. */
const FINAL_CLOSE_CODES = new Set([1007, 1008])
const abortError = () => new DOMException('Cancelled', 'AbortError')

/** Server faults, dropped connections and unreachable services are worth another attempt; refusals are not. */
function isRecoverable(error: unknown): boolean {
  if (error instanceof LiveSessionError) {
    if (error.kind === 'server_error') return false
    if (error.code !== undefined && FINAL_CLOSE_CODES.has(error.code)) return false
    return !isQuotaClose(error.reason)
  }
  if (error instanceof LiveTokenError) return error.kind === 'network' || error.kind === 'unavailable'
  return false
}

export function describeError(error: unknown): string {
  if (error instanceof MicrophoneError) {
    switch (error.kind) {
      case 'permission_denied':
        return 'Microphone access is blocked. Allow it in site settings.'
      case 'no_microphone':
        return 'No microphone was found.'
      case 'device_busy':
        return 'The microphone is in use by another app.'
      case 'device_lost':
        return 'The microphone was disconnected.'
      case 'unsupported':
        return 'This browser cannot use the microphone here.'
      default:
        return 'The microphone could not be started.'
    }
  }
  if (error instanceof LiveTokenError) {
    switch (error.kind) {
      case 'not_configured':
        return 'Voice is not configured for this preview.'
      case 'service_not_configured':
        return 'The voice service has no Gemini key configured.'
      case 'network':
        return 'Could not reach the voice service.'
      case 'malformed':
        return 'The voice service sent an unexpected reply.'
      default:
        return 'The voice service is unavailable right now.'
    }
  }
  if (error instanceof LiveSessionError) {
    switch (error.kind) {
      case 'setup_timeout':
        return 'Gemini Live did not respond in time.'
      case 'server_error':
        return 'Gemini Live reported an error.'
      case 'closed':
        if (isQuotaClose(error.reason)) return 'Gemini voice usage limit reached. Wait a minute and try again, or type below.'
        if (!error.code) return 'The voice connection closed.'
        return `Voice connection closed (code ${error.code}${error.reason ? `: ${error.reason}` : ''}).`
      default:
        return 'Could not connect to Gemini Live.'
    }
  }
  if (error instanceof PlaybackError) return 'The assistant audio could not be played.'
  return 'Voice is unavailable right now.'
}

function createLiveSnapshot(configured: boolean): LiveSnapshot {
  return {
    voiceState: 'idle',
    advisor: deriveAdvisorView(INITIAL_ADVISOR_STATE),
    submission: { status: 'idle' },
    language: 'en',
    transcript: '',
    assistantTranscript: '',
    inputLevel: 0,
    outputLevel: 0,
    errorMessage: null,
    connecting: false,
    notice: null,
    diagnostics: {
      configured,
      voiceName: ISHAARA_VOICE_NAME,
      connection: 'disconnected',
      microphone: 'off',
      playback: 'idle',
      lastServerEvent: null,
      malformedFrames: 0,
      lastCloseCode: null,
      lastCloseReason: null,
      reconnects: 0,
      stalls: 0,
      lastError: null,
    },
  }
}

/**
 * Real Gemini Live runtime. Exposes the same surface as the demo controller
 * and drives the one shared voice state machine from real signals only:
 * listening once the microphone is capturing, speaking once assistant audio
 * is audible, back to listening when that audio has finished.
 */
export class LiveVoiceRuntime {
  private snapshot: LiveSnapshot
  private readonly advisor: AdvisorSession
  private readonly listeners = new Set<() => void>()
  private readonly deps: LiveRuntimeDeps
  private readonly now: () => number

  private attempt = 0
  private session: SessionLike | null = null
  private pendingSession: SessionLike | null = null
  private sessionPromise: Promise<SessionLike> | null = null
  private abort: AbortController | null = null
  private micActive = false

  private userTurnOpen = false
  private userTurnText = ''
  private assistantTurnText = ''
  private modelTurnActive = false
  private modelTurnComplete = false
  private discarding = false
  /** Text was sent while a cancelled reply was still streaming; its `interrupted`/`turnComplete` are stale. */
  private supersededTurnPending = false
  private staleTurnCompletePending = false
  private lastVoiceAt = 0
  private lastTranscriptAt = 0
  /** Voiced audio since Gemini last acknowledged the user's turn. */
  private spokenMs = 0
  /** audioStreamEnd was sent; audio is held back until the user speaks again or a reply starts. */
  private streamHeld = false
  private heldFrames: Uint8Array[] = []
  /** The user's latest words, spoken or typed, until a reply to them starts. */
  private unansweredUserText = ''
  private recentTurns: ConversationTurn[] = []
  /** A reconnect is running: typed text waits for it instead of opening a session of its own. */
  private reconnecting = false
  /** Attempts in the current outage; reset once a session proves healthy. */
  private reconnectFailures = 0
  private sessionOpenedAt = 0
  private sessionAnswered = false
  private resentText = ''
  private resendCount = 0
  /** Gemini announced the connection will end; renew it at the next quiet moment. */
  private renewWhenIdle = false
  private readonly cancelledToolCalls = new Set<string>()

  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private discardTimer: ReturnType<typeof setTimeout> | null = null
  private thinkingTimer: ReturnType<typeof setTimeout> | null = null
  private levelTimer: ReturnType<typeof setInterval> | null = null

  constructor(deps: LiveRuntimeDeps) {
    this.deps = deps
    this.now = deps.now ?? Date.now
    this.snapshot = createLiveSnapshot(deps.configured)
    this.advisor = new AdvisorSession(
      () => this.update({ advisor: this.advisor.getView(), submission: this.advisor.getSubmission() }),
      {
        store: deps.store === undefined ? applicationStore : deps.store,
        computeFeasibility: deps.computeFeasibility === undefined ? LIVE_FEASIBILITY : deps.computeFeasibility,
        feasibilityDebounceMs: deps.feasibilityDebounceMs,
      },
    )
    deps.player.setHandlers({
      onStart: () => this.handleAudible(),
      onDrained: () => this.handleDrained(),
      onError: (error) => this.fail(error),
    })
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = () => this.snapshot

  start = () => {
    void this.begin()
  }

  retry = () => {
    void this.begin()
  }

  stop = () => {
    this.attempt++
    this.teardown()
    this.update({ connecting: false, inputLevel: 0, outputLevel: 0 })
    this.dispatch({ type: 'STOP' })
  }

  interrupt = () => {
    const state = this.snapshot.voiceState
    if (state !== 'speaking' && state !== 'thinking') return
    this.deps.player.interrupt()
    // Only a reply that is still streaming (or about to) has a tail to drop.
    if (state === 'thinking' || this.modelTurnActive) this.beginDiscard()
    this.endModelTurn()
    this.dispatch({ type: this.micActive ? 'INTERRUPT' : 'SETTLE_IDLE' })
  }

  submitText = (text: string) => {
    void this.sendText(text)
  }

  /** Level of the assistant audio audible right now; 0 whenever the assistant is not speaking. */
  getOutputLevel = () => (this.snapshot.voiceState === 'speaking' ? this.deps.player.level() : 0)

  showScheme = (schemeId: string | null) => this.advisor.showSchemeDetails(schemeId)

  chooseScheme = (schemeId: string | null) => this.advisor.chooseApplicationScheme(schemeId)

  correctField = (key: string, value: string) => this.advisor.correctField(key, value)

  setDocument = (kind: DocumentKind, declaration: DocumentDeclaration) => this.advisor.setDocument(kind, declaration)

  submitApplication = (consentAccepted: boolean) => this.advisor.submit(consentAccepted)

  clearSubmission = () => this.advisor.clearSubmission()

  /** The language is part of the Live setup, so an open session reconnects with the new one. */
  setLanguage = (language: VoiceLanguage) => {
    if (language === this.snapshot.language) return
    const wasActive = this.micActive || this.snapshot.connecting
    const hadSession = Boolean(this.session || this.sessionPromise)
    this.update({ language })
    if (!hadSession && !wasActive) return
    this.stop()
    if (wasActive) this.start()
  }

  dispose = () => {
    this.stop()
    this.advisor.dispose()
    this.deps.player.close()
  }

  private async begin() {
    const { voiceState, connecting } = this.snapshot
    if (connecting || (voiceState !== 'idle' && voiceState !== 'error')) return
    const attempt = ++this.attempt
    this.update({ connecting: true, errorMessage: null }, { microphone: 'requesting', lastError: null })

    // Must run synchronously inside the click so the browser allows audio output.
    const primed = this.deps.player.prime()
    primed.catch(() => undefined)

    try {
      await this.deps.microphone.start(this.handleFrame, this.handleMicEnded)
      if (attempt !== this.attempt) return
      this.micActive = true
      this.updateDiagnostics({ microphone: 'on' })

      await this.ensureSession()
      await primed
      if (attempt !== this.attempt) return
      this.userTurnOpen = false
      this.spokenMs = 0
      this.update({ connecting: false, transcript: '', assistantTranscript: '', notice: null })
      this.dispatch({ type: 'START' })
    } catch (error) {
      if (attempt !== this.attempt || isAbort(error)) return
      this.fail(error)
    }
  }

  private async sendText(raw: string) {
    const text = raw.trim()
    if (!text) return

    // The advisor updates from typed text exactly as from speech, whether or not Gemini is reachable.
    this.userTurnOpen = false
    this.update({ transcript: text, notice: null })
    this.ingest(text)

    const state = this.snapshot.voiceState
    if (state === 'speaking' || state === 'thinking') this.interrupt()
    if (this.discarding) this.supersededTurnPending = true

    if (this.reconnecting) {
      // The running reconnect sends it once the new session is up.
      this.unansweredUserText = text
      this.dispatch({ type: 'TEXT_SUBMITTED' })
      return
    }

    const attempt = this.attempt
    const primed = this.deps.player.prime()
    primed.catch(() => undefined)
    if (!this.session?.isOpen) this.update({ connecting: true })

    try {
      const session = await this.ensureSession()
      await primed
      if (attempt !== this.attempt) return
      this.update({ connecting: false })
      session.sendText(text)
      this.unansweredUserText = text
      this.dispatch({ type: 'TEXT_SUBMITTED' })
    } catch (error) {
      if (attempt !== this.attempt || isAbort(error)) return
      this.fail(error)
    }
  }

  private ensureSession(): Promise<SessionLike> {
    if (this.session?.isOpen) return Promise.resolve(this.session)
    if (this.sessionPromise) return this.sessionPromise

    const abort = new AbortController()
    this.abort = abort
    this.updateDiagnostics({ connection: 'connecting' })

    const promise = (async () => {
      const { token } = await this.deps.resolveToken(abort.signal)
      if (abort.signal.aborted) throw abortError()

      const session = this.deps.createSession()
      this.pendingSession = session
      const setup = buildSetupMessage({
        systemInstruction: buildSystemInstruction(
          this.snapshot.language,
          profileFacts(this.advisor.getState().profile, this.advisor.getState().details, this.advisor.getState().documents),
          this.recentTurns,
        ),
        tools: ADVISOR_TOOL_DECLARATIONS,
        languageCode: LANGUAGE_CODES[this.snapshot.language],
      })
      await session.connect(buildLiveUrl(token), setup, {
        onEvent: (event) => {
          if (this.session === session) this.handleServerEvent(event)
        },
        onClose: (info) => {
          if (this.session === session) this.handleSessionClosed(info.code, info.reason)
        },
        onMalformed: () =>
          this.updateDiagnostics({ malformedFrames: this.snapshot.diagnostics.malformedFrames + 1 }),
      })
      if (this.pendingSession === session) this.pendingSession = null
      if (abort.signal.aborted) {
        session.close()
        throw abortError()
      }
      this.session = session
      this.sessionOpenedAt = this.now()
      this.sessionAnswered = false
      this.renewWhenIdle = false
      this.updateDiagnostics({ connection: 'connected', lastCloseCode: null })
      return session
    })()

    this.sessionPromise = promise
    promise.then(
      () => {
        if (this.sessionPromise === promise) this.sessionPromise = null
      },
      (error) => {
        if (this.sessionPromise === promise) this.sessionPromise = null
        this.updateDiagnostics({ connection: isAbort(error) ? 'disconnected' : 'failed' })
      },
    )
    return promise
  }

  private handleFrame = (frame: MicrophoneFrame) => {
    const voiced = frame.level >= VOICED_LEVEL
    this.streamFrame(frame.pcm16, voiced)

    const now = this.now()
    if (voiced) this.lastVoiceAt = now
    this.setLevel('inputLevel', frame.level)

    if (this.snapshot.voiceState !== 'listening') return
    if (this.userTurnOpen && this.userTurnText.trim()) {
      if (now - Math.max(this.lastVoiceAt, this.lastTranscriptAt) >= END_OF_SPEECH_SILENCE_MS) {
        this.dispatch({ type: 'USER_FINISHED' })
      }
      return
    }
    if (voiced) this.spokenMs += frame.pcm16.length / INPUT_BYTES_PER_MS
    if (this.spokenMs >= MIN_SPOKEN_MS && now - this.lastVoiceAt >= LOCAL_TURN_END_SILENCE_MS) this.closeSpokenTurn()
  }

  private streamFrame(pcm16: Uint8Array, voiced: boolean) {
    const session = this.session
    if (!session?.isOpen) return
    if (this.streamHeld) {
      this.heldFrames.push(pcm16)
      if (this.heldFrames.length > HELD_PREROLL_FRAMES) this.heldFrames.shift()
      if (!voiced) return
      // Speaking again reopens the stream, starting with the audio just before the voice.
      const held = this.heldFrames
      this.releaseStream()
      held.forEach((bytes) => session.sendAudio(bytesToBase64(bytes)))
      return
    }
    session.sendAudio(bytesToBase64(pcm16))
  }

  /** The user spoke and went quiet, but Gemini has not closed the turn: tell it the audio paused. */
  private closeSpokenTurn() {
    const session = this.session
    this.spokenMs = 0
    if (!session?.isOpen) return
    session.endAudioStream()
    this.streamHeld = true
    this.heldFrames = []
    this.dispatch({ type: 'USER_FINISHED' })
  }

  private releaseStream() {
    this.streamHeld = false
    this.heldFrames = []
  }

  private handleMicEnded = () => {
    this.fail(new MicrophoneError('device_lost', 'The microphone stopped.'))
  }

  private handleServerEvent(event: LiveServerEvent) {
    if (event.type !== 'audio' && event.type !== this.snapshot.diagnostics.lastServerEvent) {
      this.updateDiagnostics({ lastServerEvent: event.type })
    }

    switch (event.type) {
      case 'inputTranscript':
        this.handleUserTranscript(event.text)
        break
      case 'audio':
        if (this.discarding) return
        this.beginModelTurn()
        if (this.snapshot.voiceState === 'listening') this.dispatch({ type: 'USER_FINISHED' })
        this.deps.player.enqueue(event.data)
        break
      case 'outputTranscript':
        if (this.discarding) return
        this.beginModelTurn()
        this.assistantTurnText += event.text
        this.update({ assistantTranscript: this.assistantTurnText.trim() })
        break
      case 'toolCall':
        if (this.snapshot.voiceState === 'listening') this.dispatch({ type: 'USER_FINISHED' })
        this.runTools(event.calls)
        break
      case 'toolCallCancellation':
        event.ids.forEach((id) => this.cancelledToolCalls.add(id))
        break
      case 'interrupted':
        this.handleServerInterrupted()
        break
      case 'turnComplete':
        this.handleTurnComplete()
        break
      case 'goAway':
        this.renewWhenIdle = true
        this.renewIfIdle()
        break
      case 'error':
        this.fail(new LiveSessionError('server_error', event.message))
        break
      default:
        break
    }
  }

  private handleUserTranscript(text: string) {
    this.spokenMs = 0
    if (!this.userTurnOpen) {
      this.userTurnOpen = true
      this.userTurnText = ''
    }
    this.userTurnText += text
    this.unansweredUserText = this.userTurnText.trim()
    this.lastTranscriptAt = this.now()
    this.update({ transcript: this.userTurnText.trim(), notice: null })
    // Re-reading the whole turn so far is idempotent, and lets a fact update the moment its words arrive.
    this.ingest(this.userTurnText)
  }

  private handleAudible() {
    if (this.discarding) return
    this.dispatch({ type: 'RESPONSE_STARTED' })
    if (this.snapshot.voiceState !== 'speaking') return
    this.updateDiagnostics({ playback: 'playing' })
    this.stopLevelPolling()
    this.levelTimer = setInterval(() => this.setLevel('outputLevel', this.deps.player.level()), LEVEL_POLL_MS)
  }

  private handleDrained() {
    this.stopLevelPolling()
    this.updateDiagnostics({ playback: 'idle' })
    if (this.modelTurnComplete) this.settle()
    else this.dispatch({ type: 'RESPONSE_PAUSED' })
  }

  private handleServerInterrupted() {
    this.deps.player.interrupt()
    this.endDiscard()
    if (this.supersededTurnPending) {
      // The server cancelled the reply we had already dropped, to answer the text sent after it.
      this.supersededTurnPending = false
      this.staleTurnCompletePending = true
      return
    }
    this.endModelTurn()
    const state = this.snapshot.voiceState
    if (state === 'speaking' || state === 'thinking') {
      this.dispatch({ type: this.micActive ? 'INTERRUPT' : 'SETTLE_IDLE' })
    }
  }

  private handleTurnComplete() {
    if (this.discarding) {
      this.endDiscard()
      this.supersededTurnPending = false
      return
    }
    if (this.staleTurnCompletePending && !this.modelTurnActive) {
      this.staleTurnCompletePending = false
      return
    }
    // A turn Gemini closed without speaking still counts as answered; it must not be sent again later.
    this.rememberTurn('Citizen', this.unansweredUserText)
    this.unansweredUserText = ''
    this.modelTurnActive = false
    this.modelTurnComplete = true
    if (!this.deps.player.isPlaying) this.settle()
  }

  private handleSessionClosed(code: number, reason: string) {
    this.session = null
    this.updateDiagnostics({ connection: 'disconnected', lastCloseCode: code, lastCloseReason: reason || null })
    if (!this.micActive && this.snapshot.voiceState === 'idle') return
    const error = new LiveSessionError('closed', 'The voice connection closed.', code, reason)
    if (isRecoverable(error)) void this.reconnect(error)
    else this.fail(error)
  }

  /** Gemini heard the user but never started a reply on a connection that stayed open. */
  private recoverStalledSession() {
    const session = this.session
    this.session = null
    session?.close()
    this.updateDiagnostics({ connection: 'disconnected', stalls: this.snapshot.diagnostics.stalls + 1 })
    void this.reconnect(new LiveSessionError('closed', 'Gemini Live stopped answering.'))
  }

  /** Gemini announced the connection will end: renew it now if nobody is talking, else at the next quiet moment. */
  private renewIfIdle() {
    const session = this.session
    if (!this.renewWhenIdle || !session || this.reconnecting) return
    const state = this.snapshot.voiceState
    if (state === 'idle' && !this.micActive) {
      // Nothing is listening; the next typed message opens a fresh session.
      this.renewWhenIdle = false
      this.session = null
      session.close()
      return
    }
    if (state !== 'listening' || this.userTurnOpen || this.spokenMs > 0 || this.modelTurnActive) return
    this.renewWhenIdle = false
    this.session = null
    session.close()
    this.reconnectFailures = 0
    void this.reconnect(new LiveSessionError('closed', 'Gemini Live ended the connection.'))
  }

  /**
   * A new session starts with everything already on file and the last few exchanges in its
   * instruction. A turn Gemini had heard but not yet answered is sent again as text, so the user
   * is not asked to repeat it. Attempts back off; only when all of them fail does the error show.
   */
  private async reconnect(cause: LiveSessionError) {
    const attempt = this.attempt
    if (this.sessionAnswered || this.now() - this.sessionOpenedAt >= HEALTHY_SESSION_MS) this.reconnectFailures = 0

    const state = this.snapshot.voiceState
    const turnInFlight = !this.modelTurnActive && (state === 'thinking' || this.userTurnOpen || this.spokenMs > 0)
    let unanswered = this.modelTurnActive ? '' : this.unansweredUserText
    if (unanswered && unanswered === this.resentText && this.resendCount >= MAX_RESENDS) unanswered = ''
    const lostWords = turnInFlight && !unanswered

    this.reconnecting = true
    this.deps.player.interrupt()
    this.endDiscard()
    this.supersededTurnPending = false
    this.staleTurnCompletePending = false
    this.endModelTurn()
    this.releaseStream()
    this.spokenMs = 0
    this.userTurnOpen = false
    this.cancelledToolCalls.clear()
    this.clearThinkingTimer()
    this.unansweredUserText = unanswered
    if (!unanswered) this.dispatch({ type: this.micActive ? 'INTERRUPT' : 'SETTLE_IDLE' })
    this.update({ connecting: true, ...(lostWords ? { notice: REPEAT_NOTICE } : {}) })

    let lastError: unknown = cause
    for (;;) {
      const delay = RECONNECT_DELAYS_MS[this.reconnectFailures]
      if (delay === undefined) {
        this.fail(lastError)
        return
      }
      this.reconnectFailures++
      if (delay > 0) {
        await new Promise((resolve) => (this.reconnectTimer = setTimeout(resolve, delay)))
        this.reconnectTimer = null
        if (attempt !== this.attempt) return
      }
      this.updateDiagnostics({ reconnects: this.snapshot.diagnostics.reconnects + 1 })
      try {
        const session = await this.ensureSession()
        if (attempt !== this.attempt) return
        this.reconnecting = false
        this.update({ connecting: false })
        const text = this.unansweredUserText
        if (!text) return
        this.resendCount = text === this.resentText ? this.resendCount + 1 : 1
        this.resentText = text
        session.sendText(text)
        if (this.snapshot.voiceState === 'thinking') this.armThinkingTimer()
        else this.dispatch({ type: 'TEXT_SUBMITTED' })
        return
      } catch (error) {
        if (attempt !== this.attempt || isAbort(error)) return
        if (!isRecoverable(error)) {
          this.fail(error)
          return
        }
        lastError = error
        if (error instanceof LiveSessionError && error.code !== undefined) {
          this.updateDiagnostics({ lastCloseCode: error.code, lastCloseReason: error.reason ?? null })
        }
      }
    }
  }

  private rememberTurn(speaker: ConversationTurn['speaker'], raw: string) {
    const text = raw.trim()
    if (!text) return
    this.recentTurns.push({ speaker, text: text.length > RECENT_TURN_CHARS ? `${text.slice(0, RECENT_TURN_CHARS)}…` : text })
    if (this.recentTurns.length > RECENT_TURNS) this.recentTurns.shift()
  }

  private settle() {
    this.endModelTurn()
    this.releaseStream()
    this.spokenMs = 0
    this.dispatch({ type: this.micActive ? 'RESPONSE_ENDED' : 'SETTLE_IDLE' })
    this.renewIfIdle()
  }

  private beginModelTurn() {
    if (this.modelTurnActive) return
    // The live stream resumes so the user can talk over the reply.
    this.releaseStream()
    this.spokenMs = 0
    this.rememberTurn('Ishaara', this.assistantTurnText)
    this.rememberTurn('Citizen', this.unansweredUserText)
    this.unansweredUserText = ''
    this.resentText = ''
    this.resendCount = 0
    // A session that replies is healthy, so the outage (if any) is over.
    this.sessionAnswered = true
    this.reconnectFailures = 0
    this.staleTurnCompletePending = false
    this.modelTurnActive = true
    this.modelTurnComplete = false
    this.userTurnOpen = false
    this.assistantTurnText = ''
    if (this.snapshot.notice) this.update({ notice: null })
  }

  private endModelTurn() {
    this.rememberTurn('Ishaara', this.assistantTurnText)
    this.assistantTurnText = ''
    this.modelTurnActive = false
    this.modelTurnComplete = false
    this.stopLevelPolling()
    this.updateDiagnostics({ playback: 'idle' })
  }

  private beginDiscard() {
    this.discarding = true
    if (this.discardTimer !== null) clearTimeout(this.discardTimer)
    this.discardTimer = setTimeout(() => this.endDiscard(), DISCARD_WINDOW_MS)
  }

  private endDiscard() {
    this.discarding = false
    if (this.discardTimer !== null) clearTimeout(this.discardTimer)
    this.discardTimer = null
  }

  private runTools(calls: ToolCall[]) {
    const session = this.session
    const responses: ToolResponse[] = []
    for (const call of calls) {
      const response = this.runTool(call)
      if (!this.cancelledToolCalls.delete(call.id)) responses.push({ id: call.id, name: call.name, response })
    }
    if (responses.length > 0 && session && this.session === session) session.sendToolResponse(responses)
  }

  private runTool(call: ToolCall): Record<string, unknown> {
    try {
      return this.advisor.runTool(call)
    } catch (cause) {
      return {
        ok: false,
        error: 'execution_failed',
        message: cause instanceof Error ? cause.message : 'That lookup could not be completed.',
      }
    }
  }

  /** The single write path for speech transcripts and typed text. */
  private ingest(text: string) {
    this.advisor.ingest(text)
  }

  private fail(error: unknown) {
    this.attempt++
    const message = describeError(error)
    this.teardown()
    this.update(
      { connecting: false, errorMessage: message, inputLevel: 0, outputLevel: 0 },
      {
        lastError: error instanceof Error ? `${error.name}: ${error.message}` : message,
        microphone: error instanceof MicrophoneError ? 'failed' : 'off',
        connection: error instanceof LiveSessionError || error instanceof LiveTokenError ? 'failed' : 'disconnected',
      },
    )
    this.dispatch({ type: 'FAIL' })
  }

  private teardown() {
    this.abort?.abort()
    this.abort = null
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    this.reconnecting = false
    this.renewWhenIdle = false
    this.pendingSession?.close()
    this.pendingSession = null
    this.sessionPromise = null
    this.session?.close()
    this.session = null

    this.deps.microphone.stop()
    this.micActive = false
    this.deps.player.interrupt()

    this.endDiscard()
    this.supersededTurnPending = false
    this.staleTurnCompletePending = false
    this.endModelTurn()
    this.clearThinkingTimer()
    this.userTurnOpen = false
    this.releaseStream()
    this.spokenMs = 0
    this.unansweredUserText = ''
    this.resentText = ''
    this.resendCount = 0
    this.cancelledToolCalls.clear()
    this.update({ notice: null }, { connection: 'disconnected', microphone: 'off', playback: 'idle' })
  }

  private dispatch(event: VoiceEvent) {
    const previous = this.snapshot.voiceState
    const next = transition(previous, event)
    if (next === previous) return
    const patch: Partial<LiveSnapshot> = { voiceState: next }
    if (next !== 'speaking') patch.outputLevel = 0
    if (next !== 'listening') patch.inputLevel = 0
    if (previous === 'error') patch.errorMessage = null
    this.update(patch)

    if (next !== 'speaking') this.stopLevelPolling()
    if (next === 'thinking') this.armThinkingTimer()
    else this.clearThinkingTimer()
  }

  private armThinkingTimer() {
    this.clearThinkingTimer()
    this.thinkingTimer = setTimeout(() => {
      this.thinkingTimer = null
      if (this.snapshot.voiceState !== 'thinking' || this.deps.player.isPlaying || this.reconnecting) return
      // Words Gemini heard (or text it was sent) that got no reply at all: the session stalled.
      if (this.unansweredUserText && this.session && !this.modelTurnActive) this.recoverStalledSession()
      else this.settle()
    }, THINKING_TIMEOUT_MS)
  }

  private clearThinkingTimer() {
    if (this.thinkingTimer !== null) clearTimeout(this.thinkingTimer)
    this.thinkingTimer = null
  }

  private stopLevelPolling() {
    if (this.levelTimer !== null) clearInterval(this.levelTimer)
    this.levelTimer = null
  }

  private setLevel(key: 'inputLevel' | 'outputLevel', value: number) {
    const relevant = key === 'inputLevel' ? this.snapshot.voiceState === 'listening' : this.snapshot.voiceState === 'speaking'
    const next = relevant ? value : 0
    const current = this.snapshot[key]
    if (Math.abs(next - current) < LEVEL_EPSILON && !(next === 0 && current !== 0)) return
    this.update(key === 'inputLevel' ? { inputLevel: next } : { outputLevel: next })
  }

  private updateDiagnostics(patch: Partial<LiveDiagnostics>) {
    this.update({}, patch)
  }

  private update(patch: Partial<LiveSnapshot>, diagnostics?: Partial<LiveDiagnostics>) {
    this.snapshot = {
      ...this.snapshot,
      ...patch,
      diagnostics: diagnostics ? { ...this.snapshot.diagnostics, ...diagnostics } : this.snapshot.diagnostics,
    }
    this.listeners.forEach((listener) => listener())
  }
}

export function createLiveVoiceRuntime(config = readLiveTokenConfig()): LiveVoiceRuntime {
  return new LiveVoiceRuntime({
    configured: isLiveConfigured(config),
    resolveToken: (signal) => resolveLiveToken(config, fetch, signal),
    createSession: () => new LiveSession(),
    microphone: new MicrophoneCapture(),
    player: new AudioOutputPlayer(),
  })
}
