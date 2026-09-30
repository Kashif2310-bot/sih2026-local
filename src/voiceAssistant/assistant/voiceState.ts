export const VOICE_STATES = ['idle', 'listening', 'thinking', 'speaking', 'error'] as const

export type VoiceState = (typeof VOICE_STATES)[number]

export type VoiceEvent =
  | { type: 'START' }
  | { type: 'USER_FINISHED' }
  | { type: 'TEXT_SUBMITTED' }
  | { type: 'RESPONSE_STARTED' }
  /** Assistant audio drained but the model has not finished its turn yet. */
  | { type: 'RESPONSE_PAUSED' }
  | { type: 'RESPONSE_ENDED' }
  /** Reply finished (or was cut) while no microphone is open, so there is nothing to listen with. */
  | { type: 'SETTLE_IDLE' }
  | { type: 'INTERRUPT' }
  | { type: 'STOP' }
  | { type: 'FAIL' }
  | { type: 'RETRY' }
  | { type: 'RESET' }
  | { type: 'FORCE'; state: VoiceState }

type EventType = VoiceEvent['type']

const TRANSITIONS: Record<VoiceState, Partial<Record<EventType, VoiceState>>> = {
  idle: { START: 'listening', TEXT_SUBMITTED: 'thinking', FAIL: 'error' },
  listening: {
    USER_FINISHED: 'thinking',
    TEXT_SUBMITTED: 'thinking',
    RESPONSE_STARTED: 'speaking',
    STOP: 'idle',
    FAIL: 'error',
  },
  thinking: {
    RESPONSE_STARTED: 'speaking',
    RESPONSE_ENDED: 'listening',
    SETTLE_IDLE: 'idle',
    INTERRUPT: 'listening',
    STOP: 'idle',
    FAIL: 'error',
  },
  speaking: {
    RESPONSE_PAUSED: 'thinking',
    RESPONSE_ENDED: 'listening',
    SETTLE_IDLE: 'idle',
    INTERRUPT: 'listening',
    STOP: 'idle',
    FAIL: 'error',
  },
  error: { RETRY: 'listening', START: 'listening', TEXT_SUBMITTED: 'thinking', STOP: 'idle' },
}

/** Pure transition function. Events that are not valid for the current state are ignored. */
export function transition(state: VoiceState, event: VoiceEvent): VoiceState {
  if (event.type === 'RESET') return 'idle'
  if (event.type === 'FORCE') return event.state
  return TRANSITIONS[state][event.type] ?? state
}

export function canTransition(state: VoiceState, type: EventType): boolean {
  return type === 'RESET' || type === 'FORCE' || TRANSITIONS[state][type] !== undefined
}

/** The character is animated in exactly one state. */
export const isCharacterAnimated = (state: VoiceState) => state === 'speaking'
export const showsUserWaveform = (state: VoiceState) => state === 'listening'
export const showsAssistantWaveform = (state: VoiceState) => state === 'speaking'
