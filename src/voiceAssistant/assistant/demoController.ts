import type { DocumentKind } from '../application/documents'
import type { DocumentDeclaration } from '../../apply/types'
import { deriveAdvisorView, INITIAL_ADVISOR_STATE } from './advisor/advisor'
import { AdvisorSession } from './advisor/advisorSession'
import { DEMO_TURNS, GENERIC_REPLY, type DemoTurn } from './demoData'
import type { AssistantSnapshot } from './types'
import { transition, type VoiceEvent, type VoiceState } from './voiceState'

const FIRST_TURN_LEAD_MS = 400
const BARGE_IN_LEAD_MS = 450
const NEXT_TURN_PAUSE_MS = 3500
const CHUNK_MS = 650
const CAPTURE_LAG_MS = 300
const THINK_MS = 1000
const WORD_MS = 220
const MIN_REPLY_MS = 3500
const AUTO_DEMO_IDLE_MS = 3000

const QUIET_LEVEL = 0.12
const VOICE_LEVEL = 0.85
const SPEAK_LEVEL = 0.8

const SILENT: Partial<AssistantSnapshot> = {
  inputLevel: 0,
  outputLevel: 0,
  transcript: '',
  assistantTranscript: '',
}

export function createInitialSnapshot(): AssistantSnapshot {
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
  }
}

type Listener = () => void

interface SpeakOptions {
  forced?: boolean
  continueScript?: boolean
}

/**
 * Offline, scripted stand-in for the live runtime (`?mode=demo`). The
 * citizen's words are scripted, but they go through the same advisor
 * pipeline as live speech, on this controller's own state — nothing here
 * ever reaches the live runtime. There is no assistant audio, so the
 * advisor's mouth stays closed.
 */
export class DemoController {
  private snapshot = createInitialSnapshot()
  private readonly advisor = new AdvisorSession(
    () => this.set({ advisor: this.advisor.getView(), submission: this.advisor.getSubmission() }),
    {
      store: null,
      submitDisabledReason: 'The offline demo does not submit applications. Use the live assistant to submit.',
      computeFeasibility: null,
      feasibilityDisabledReason: 'The offline demo makes no network calls, so the LokScore report is not computed here.',
    },
  )
  private listeners = new Set<Listener>()
  private timers = new Set<ReturnType<typeof setTimeout>>()
  private nextTurn = 0
  /** Turn whose user part has started but whose reply has not. */
  private pendingTurn: number | null = null

  subscribe = (listener: Listener) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = () => this.snapshot

  /** No real audio exists in demo mode. */
  getOutputLevel = () => 0

  start = () => {
    const { voiceState } = this.snapshot
    if (voiceState !== 'idle' && voiceState !== 'error') return
    this.cancel()
    this.dispatch({ type: voiceState === 'error' ? 'RETRY' : 'START' }, { errorMessage: null })
    this.listenForTurn(FIRST_TURN_LEAD_MS)
  }

  retry = () => this.start()

  stop = () => {
    this.cancel()
    this.dispatch({ type: 'STOP' }, SILENT)
  }

  /** Barge-in: the user starts talking over the assistant. */
  interrupt = () => {
    const { voiceState } = this.snapshot
    if (voiceState !== 'speaking' && voiceState !== 'thinking') return
    this.pendingTurn = null
    this.cancel()
    this.dispatch({ type: 'INTERRUPT' }, { assistantTranscript: '', outputLevel: 0, inputLevel: VOICE_LEVEL })
    this.listenForTurn(BARGE_IN_LEAD_MS)
  }

  submitText = (text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    this.pendingTurn = null
    this.cancel()
    const { voiceState } = this.snapshot
    if (voiceState === 'speaking' || voiceState === 'thinking') {
      this.dispatch({ type: 'INTERRUPT' }, { assistantTranscript: '', outputLevel: 0 })
    } else if (voiceState === 'idle' || voiceState === 'error') {
      this.dispatch({ type: voiceState === 'error' ? 'RETRY' : 'START' }, { errorMessage: null })
    }
    this.ingest(trimmed)
    this.dispatch({ type: 'USER_FINISHED' }, { transcript: trimmed, inputLevel: 0 })
    this.after(THINK_MS, () => this.speak(GENERIC_REPLY(this.snapshot.advisor), { continueScript: false }))
  }

  showScheme = (schemeId: string | null) => this.advisor.showSchemeDetails(schemeId)

  chooseScheme = (schemeId: string | null) => this.advisor.chooseApplicationScheme(schemeId)

  correctField = (key: string, value: string) => this.advisor.correctField(key, value)

  setDocument = (kind: DocumentKind, declaration: DocumentDeclaration) => this.advisor.setDocument(kind, declaration)

  submitApplication = (consentAccepted: boolean) => this.advisor.submit(consentAccepted)

  clearSubmission = () => this.advisor.clearSubmission()

  setLanguage = (language: 'en' | 'kn') => this.set({ language })

  fail = (message = "Voice couldn't start") => {
    this.cancel()
    this.dispatch({ type: 'FORCE', state: 'error' }, { ...SILENT, errorMessage: message })
  }

  reset = () => {
    this.cancel()
    this.nextTurn = 0
    this.pendingTurn = null
    this.advisor.reset()
    this.snapshot = createInitialSnapshot()
    this.emit()
  }

  runAutoDemo = () => {
    this.reset()
    this.after(AUTO_DEMO_IDLE_MS, this.start)
  }

  /** Debug-only: jump straight to a state. */
  force = (state: VoiceState) => {
    this.cancel()
    switch (state) {
      case 'idle':
        this.dispatch({ type: 'FORCE', state }, SILENT)
        break
      case 'listening':
        this.dispatch({ type: 'FORCE', state }, { ...SILENT, inputLevel: QUIET_LEVEL })
        break
      case 'thinking':
        this.dispatch({ type: 'FORCE', state }, { inputLevel: 0, outputLevel: 0, assistantTranscript: '' })
        break
      case 'speaking':
        this.speak(GENERIC_REPLY(this.snapshot.advisor), { forced: true, continueScript: false })
        break
      case 'error':
        this.fail()
        break
    }
  }

  dispose = () => {
    this.cancel()
    this.advisor.dispose()
    this.listeners.clear()
  }

  private listenForTurn(leadMs: number) {
    const index = this.nextTurn
    const turn: DemoTurn | undefined = DEMO_TURNS[index]
    this.set({ transcript: '', inputLevel: QUIET_LEVEL })
    if (!turn) return

    this.nextTurn = index + 1
    this.pendingTurn = index
    const previousTopId = this.snapshot.advisor.top?.id ?? null

    let t = leadMs
    let heard = ''
    for (const chunk of turn.user) {
      heard += chunk
      const soFar = heard
      this.after(t, () => this.set({ transcript: soFar, inputLevel: VOICE_LEVEL }))
      this.after(t + CAPTURE_LAG_MS, () => this.ingest(soFar))
      t += CHUNK_MS
    }
    this.after(t - 150, () => this.set({ inputLevel: QUIET_LEVEL }))
    this.after(t, () => this.dispatch({ type: 'USER_FINISHED' }, { inputLevel: 0 }))
    this.after(t + THINK_MS, () => {
      this.pendingTurn = null
      this.speak(turn.reply(this.snapshot.advisor, previousTopId))
    })
  }

  private speak(reply: string, { forced = false, continueScript = true }: SpeakOptions = {}) {
    this.dispatch(forced ? { type: 'FORCE', state: 'speaking' } : { type: 'RESPONSE_STARTED' }, {
      assistantTranscript: '',
      inputLevel: 0,
      outputLevel: SPEAK_LEVEL,
    })

    const words = reply.split(' ')
    const duration = Math.max(MIN_REPLY_MS, words.length * WORD_MS)
    const step = duration / words.length
    words.forEach((_, i) => {
      this.after(Math.round(i * step), () => this.set({ assistantTranscript: words.slice(0, i + 1).join(' ') }))
    })

    this.after(duration, () => {
      this.dispatch({ type: 'RESPONSE_ENDED' }, { outputLevel: 0 })
      if (continueScript) this.listenForTurn(NEXT_TURN_PAUSE_MS)
      else this.set({ transcript: '', inputLevel: QUIET_LEVEL })
    })
  }

  private ingest(text: string) {
    this.advisor.ingest(text)
  }

  private dispatch(event: VoiceEvent, patch: Partial<AssistantSnapshot> = {}) {
    this.set({ ...patch, voiceState: transition(this.snapshot.voiceState, event) })
  }

  private set(patch: Partial<AssistantSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch }
    this.emit()
  }

  private emit() {
    this.listeners.forEach((listener) => listener())
  }

  private after(ms: number, fn: () => void) {
    const id = setTimeout(() => {
      this.timers.delete(id)
      fn()
    }, ms)
    this.timers.add(id)
  }

  private cancel() {
    this.timers.forEach(clearTimeout)
    this.timers.clear()
    if (this.pendingTurn !== null) {
      this.nextTurn = this.pendingTurn
      this.pendingTurn = null
    }
  }
}
