import { describe, expect, it } from 'vitest'
import { canTransition, transition, type VoiceEvent, type VoiceState } from './voiceState'

const run = (from: VoiceState, ...events: VoiceEvent['type'][]) =>
  events.reduce<VoiceState>((state, type) => transition(state, { type } as VoiceEvent), from)

describe('voice state machine', () => {
  it('follows a full spoken turn', () => {
    expect(run('idle', 'START')).toBe('listening')
    expect(run('idle', 'START', 'USER_FINISHED')).toBe('thinking')
    expect(run('idle', 'START', 'USER_FINISHED', 'RESPONSE_STARTED')).toBe('speaking')
    expect(run('idle', 'START', 'USER_FINISHED', 'RESPONSE_STARTED', 'RESPONSE_ENDED')).toBe('listening')
  })

  it('lets a fast reply go straight from listening to speaking', () => {
    expect(run('listening', 'RESPONSE_STARTED')).toBe('speaking')
  })

  it('drops back to thinking when audio drains mid-turn, then resumes speaking', () => {
    expect(run('speaking', 'RESPONSE_PAUSED')).toBe('thinking')
    expect(run('speaking', 'RESPONSE_PAUSED', 'RESPONSE_STARTED')).toBe('speaking')
  })

  it('interrupts speaking and thinking back to listening', () => {
    expect(run('speaking', 'INTERRUPT')).toBe('listening')
    expect(run('thinking', 'INTERRUPT')).toBe('listening')
    expect(canTransition('listening', 'INTERRUPT')).toBe(false)
  })

  it('handles text turns with and without an open microphone', () => {
    expect(run('idle', 'TEXT_SUBMITTED')).toBe('thinking')
    expect(run('idle', 'TEXT_SUBMITTED', 'RESPONSE_STARTED', 'SETTLE_IDLE')).toBe('idle')
    expect(run('error', 'TEXT_SUBMITTED')).toBe('thinking')
    expect(run('listening', 'TEXT_SUBMITTED')).toBe('thinking')
  })

  it('never reaches speaking from idle without a turn', () => {
    expect(run('idle', 'RESPONSE_STARTED')).toBe('idle')
    expect(run('idle', 'RESPONSE_ENDED')).toBe('idle')
  })

  it('fails from any active state and recovers via retry or stop', () => {
    for (const state of ['idle', 'listening', 'thinking', 'speaking'] as const) {
      expect(run(state, 'FAIL')).toBe('error')
    }
    expect(run('error', 'RETRY')).toBe('listening')
    expect(run('error', 'STOP')).toBe('idle')
  })
})
