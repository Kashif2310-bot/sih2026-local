import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlayerHandlers } from './audioPlayer'
import type { LiveServerEvent } from './geminiProtocol'
import type { LiveSessionHandlers } from './liveSession'
import {
  HEALTHY_SESSION_MS,
  LiveVoiceRuntime,
  RECONNECT_DELAYS_MS,
  REPEAT_NOTICE,
  THINKING_TIMEOUT_MS,
  type MicrophoneLike,
  type PlayerLike,
  type SessionLike,
} from './liveRuntime'
import { LiveSessionError } from './liveSession'
import { MicrophoneError, type MicrophoneFrame } from './microphone'
import { LiveTokenError } from './tokenResolver'

class FakeMic implements MicrophoneLike {
  onFrame: ((frame: MicrophoneFrame) => void) | null = null
  onEnded: (() => void) | null = null
  private pending: { resolve: () => void; reject: (error: unknown) => void } | null = null
  stop = vi.fn()

  start(onFrame: (frame: MicrophoneFrame) => void, onEnded: () => void) {
    this.onFrame = onFrame
    this.onEnded = onEnded
    return new Promise<void>((resolve, reject) => (this.pending = { resolve, reject }))
  }

  grant() {
    this.pending?.resolve()
  }

  deny(error: unknown) {
    this.pending?.reject(error)
  }

  frame(level: number, pcm16 = new Uint8Array([1, 2, 3, 4])) {
    this.onFrame?.({ pcm16, level })
  }

  /** One real-sized worklet frame: 100 ms of 16 kHz PCM16. */
  frame100ms(level: number) {
    this.frame(level, new Uint8Array(3200).fill(level > 0 ? 7 : 0))
  }
}

class FakeSession implements SessionLike {
  isOpen = false
  url = ''
  setup: { setup: Record<string, any> } | null = null
  handlers: LiveSessionHandlers | null = null
  private pending: { resolve: () => void; reject: (error: unknown) => void } | null = null
  sendAudio = vi.fn()
  endAudioStream = vi.fn()
  sendText = vi.fn()
  sendToolResponse = vi.fn()
  close = vi.fn(() => {
    this.isOpen = false
  })

  connect(url: string, setup: object, handlers: LiveSessionHandlers) {
    this.url = url
    this.setup = setup as { setup: Record<string, any> }
    this.handlers = handlers
    return new Promise<void>((resolve, reject) => (this.pending = { resolve, reject }))
  }

  ready() {
    this.isOpen = true
    this.pending?.resolve()
  }

  emit(event: LiveServerEvent) {
    this.handlers?.onEvent(event)
  }

  drop(code: number, reason = '') {
    this.isOpen = false
    this.handlers?.onClose({ code, reason })
  }

  refuse(error: unknown) {
    this.pending?.reject(error)
  }
}

class FakePlayer implements PlayerLike {
  isPlaying = false
  handlers: PlayerHandlers | null = null
  prime = vi.fn(async () => undefined)
  enqueue = vi.fn(() => {
    this.isPlaying = true
  })
  interrupt = vi.fn(() => {
    this.isPlaying = false
  })
  level = () => 0.6
  close = vi.fn()

  setHandlers(handlers: PlayerHandlers) {
    this.handlers = handlers
  }

  becomeAudible() {
    this.handlers?.onStart()
  }

  drain() {
    this.isPlaying = false
    this.handlers?.onDrained()
  }
}

const audio = (): LiveServerEvent => ({ type: 'audio', data: new Uint8Array([0, 1, 0, 1]) })
const flush = () => vi.advanceTimersByTimeAsync(0)

function setup(resolveToken: () => Promise<{ token: string; expiresAt: string | null }> = async () => ({
  token: 'auth_tokens/test',
  expiresAt: null,
})) {
  let clock = 0
  const mic = new FakeMic()
  const player = new FakePlayer()
  const sessions: FakeSession[] = []
  const runtime = new LiveVoiceRuntime({
    configured: true,
    resolveToken,
    createSession: () => {
      const session = new FakeSession()
      sessions.push(session)
      return session
    },
    microphone: mic,
    player,
    now: () => clock,
    store: null,
    computeFeasibility: null,
  })
  const state = () => runtime.getSnapshot().voiceState
  const tick = (ms: number) => (clock += ms)
  return { runtime, mic, player, sessions, state, tick, session: () => sessions[sessions.length - 1] }
}

async function connected() {
  const harness = setup()
  harness.runtime.start()
  await flush()
  harness.mic.grant()
  await flush()
  harness.session().ready()
  await flush()
  return harness
}

async function speaking() {
  const harness = await connected()
  harness.session().emit(audio())
  harness.player.becomeAudible()
  return harness
}

describe('LiveVoiceRuntime', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('only shows listening once the microphone is capturing and Gemini confirmed setup', async () => {
    const { runtime, mic, state, session } = setup()
    runtime.start()
    expect(state()).toBe('idle')
    expect(runtime.getSnapshot().connecting).toBe(true)

    await flush()
    mic.grant()
    await flush()
    expect(state()).toBe('idle')
    expect(session().url).toContain('BidiGenerateContentConstrained?access_token=auth_tokens%2Ftest')

    session().ready()
    await flush()
    expect(state()).toBe('listening')
    expect(runtime.getSnapshot().connecting).toBe(false)
    expect(runtime.getSnapshot().transcript).toBe('')
    expect(runtime.getSnapshot().diagnostics).toMatchObject({ microphone: 'on', connection: 'connected' })

    mic.frame(0.5)
    expect(session().sendAudio).toHaveBeenCalledWith('AQIDBA==')
    expect(runtime.getSnapshot().inputLevel).toBe(0.5)
  })

  it('speaks only while real assistant audio is audible, then returns to listening', async () => {
    const { runtime, player, state, session } = await connected()

    session().emit({ type: 'inputTranscript', text: 'I am 26 years old and I live in Kerala' })
    expect(runtime.getSnapshot().advisor.profile).toMatchObject({ age: 26, state: 'Kerala' })
    expect(runtime.getSnapshot().transcript).toBe('I am 26 years old and I live in Kerala')

    session().emit(audio())
    expect(player.enqueue).toHaveBeenCalledTimes(1)
    expect(state()).toBe('thinking')

    player.becomeAudible()
    expect(state()).toBe('speaking')
    session().emit({ type: 'outputTranscript', text: 'Thank you.' })
    expect(runtime.getSnapshot().assistantTranscript).toBe('Thank you.')

    session().emit({ type: 'turnComplete' })
    expect(state()).toBe('speaking')
    player.drain()
    expect(state()).toBe('listening')
    expect(runtime.getSnapshot().outputLevel).toBe(0)
  })

  it('leaves speaking when the audio queue runs dry before the turn is complete', async () => {
    const { player, state, session } = await speaking()
    player.drain()
    expect(state()).toBe('thinking')
    session().emit(audio())
    player.becomeAudible()
    expect(state()).toBe('speaking')
  })

  it('user interrupt stops playback immediately and discards the rest of the old reply', async () => {
    const { runtime, player, state, session } = await speaking()

    runtime.interrupt()
    expect(player.interrupt).toHaveBeenCalled()
    expect(state()).toBe('listening')

    session().emit(audio())
    session().emit({ type: 'outputTranscript', text: 'stale words' })
    expect(player.enqueue).toHaveBeenCalledTimes(1)
    expect(state()).toBe('listening')
    expect(runtime.getSnapshot().assistantTranscript).not.toContain('stale')

    session().emit({ type: 'turnComplete' })
    session().emit(audio())
    expect(player.enqueue).toHaveBeenCalledTimes(2)
    expect(state()).toBe('thinking')
  })

  it('text sent after an interrupt is answered, even though the server then cancels the dropped reply', async () => {
    const { runtime, player, state, sessions } = setup()
    runtime.submitText('Explain PMEGP in full detail')
    await flush()
    sessions[0].ready()
    await flush()
    sessions[0].emit(audio())
    player.becomeAudible()
    expect(state()).toBe('speaking')

    runtime.interrupt()
    expect(state()).toBe('idle')
    runtime.submitText('Just tell me the first document')
    await flush()
    expect(state()).toBe('thinking')

    // Recorded order from a real session: the old reply's tail, then its cancellation.
    sessions[0].emit(audio())
    sessions[0].emit({ type: 'interrupted' })
    sessions[0].emit({ type: 'turnComplete' })
    expect(state()).toBe('thinking')
    expect(player.enqueue).toHaveBeenCalledTimes(1)

    sessions[0].emit(audio())
    player.becomeAudible()
    expect(state()).toBe('speaking')
    sessions[0].emit({ type: 'outputTranscript', text: 'Your Aadhaar card.' })
    expect(runtime.getSnapshot().assistantTranscript).toBe('Your Aadhaar card.')
    sessions[0].emit({ type: 'turnComplete' })
    player.drain()
    expect(state()).toBe('idle')
  })

  it('typing over a speaking reply with the microphone on moves straight to the new answer', async () => {
    const { runtime, player, state, session } = await speaking()
    runtime.submitText('Actually, I need a loan of 3 lakh')
    await flush()
    expect(player.interrupt).toHaveBeenCalled()
    expect(state()).toBe('thinking')

    session().emit({ type: 'interrupted' })
    session().emit({ type: 'turnComplete' })
    expect(state()).toBe('thinking')

    session().emit(audio())
    player.becomeAudible()
    expect(state()).toBe('speaking')
  })

  it('server barge-in stops playback and returns to listening', async () => {
    const { player, state, session } = await speaking()
    session().emit({ type: 'interrupted' })
    expect(player.interrupt).toHaveBeenCalled()
    expect(state()).toBe('listening')
    session().emit(audio())
    expect(player.enqueue).toHaveBeenCalledTimes(2)
  })

  it('shows thinking only after real speech followed by real silence', async () => {
    const { mic, state, session, tick } = await connected()

    tick(2000)
    mic.frame(0)
    expect(state()).toBe('listening')

    session().emit({ type: 'inputTranscript', text: 'I want to start a small dairy business' })
    mic.frame(0.4)
    tick(500)
    mic.frame(0)
    expect(state()).toBe('listening')
    tick(500)
    mic.frame(0)
    expect(state()).toBe('thinking')
  })

  it('closes a spoken turn Gemini never ends, so the user still gets a reply', async () => {
    const { runtime, mic, state, session, tick, player } = await connected()
    const speak = (ms: number) => {
      for (let t = 0; t < ms; t += 100) {
        tick(100)
        mic.frame100ms(0.5)
      }
    }
    const silence = (ms: number) => {
      for (let t = 0; t < ms; t += 100) {
        tick(100)
        mic.frame100ms(0)
      }
    }

    // Recorded from a failing session: activity start, then nothing, however long the user waits.
    speak(2000)
    silence(1400)
    expect(state()).toBe('listening')
    expect(session().endAudioStream).not.toHaveBeenCalled()
    silence(100)
    expect(session().endAudioStream).toHaveBeenCalledTimes(1)
    expect(state()).toBe('thinking')

    // Held: silence is not streamed, which would reopen the turn.
    const sentWhileListening = session().sendAudio.mock.calls.length
    silence(1000)
    expect(session().sendAudio).toHaveBeenCalledTimes(sentWhileListening)

    // Gemini transcribes and answers the closed turn; the stream resumes for barge-in.
    session().emit({ type: 'inputTranscript', text: 'I want to start a small dairy business' })
    expect(runtime.getSnapshot().transcript).toBe('I want to start a small dairy business')
    session().emit(audio())
    player.becomeAudible()
    expect(state()).toBe('speaking')
    mic.frame100ms(0)
    expect(session().sendAudio).toHaveBeenCalledTimes(sentWhileListening + 1)
    expect(session().endAudioStream).toHaveBeenCalledTimes(1)
  })

  it('speaking again while the stream is held resumes it, starting with the audio just before', async () => {
    const { mic, session, tick } = await connected()
    for (let t = 0; t < 1000; t += 100) {
      tick(100)
      mic.frame100ms(0.5)
    }
    for (let t = 0; t < 1500; t += 100) {
      tick(100)
      mic.frame100ms(0)
    }
    expect(session().endAudioStream).toHaveBeenCalledTimes(1)
    const before = session().sendAudio.mock.calls.length

    for (let i = 0; i < 3; i++) mic.frame100ms(0)
    expect(session().sendAudio).toHaveBeenCalledTimes(before)
    mic.frame100ms(0.5)
    expect(session().sendAudio).toHaveBeenCalledTimes(before + 4)
    mic.frame100ms(0)
    expect(session().sendAudio).toHaveBeenCalledTimes(before + 5)
  })

  it('does not close the turn for a cough, background silence, or a turn Gemini already closed', async () => {
    const { mic, state, session, tick } = await connected()
    tick(100)
    mic.frame100ms(0.5)
    for (let t = 0; t < 3000; t += 100) {
      tick(100)
      mic.frame100ms(0)
    }
    expect(session().endAudioStream).not.toHaveBeenCalled()
    expect(state()).toBe('listening')

    for (let t = 0; t < 1000; t += 100) {
      tick(100)
      mic.frame100ms(0.5)
    }
    session().emit({ type: 'inputTranscript', text: 'I live in Mysuru' })
    session().emit(audio())
    for (let t = 0; t < 3000; t += 100) {
      tick(100)
      mic.frame100ms(0)
    }
    expect(session().endAudioStream).not.toHaveBeenCalled()
  })

  it('stop releases the microphone, the socket and any playing audio', async () => {
    const { runtime, mic, player, state, session } = await speaking()
    runtime.stop()
    expect(state()).toBe('idle')
    expect(mic.stop).toHaveBeenCalled()
    expect(session().close).toHaveBeenCalled()
    expect(player.interrupt).toHaveBeenCalled()

    mic.frame(0.5)
    expect(session().sendAudio).not.toHaveBeenCalled()
    expect(runtime.getSnapshot().diagnostics).toMatchObject({ microphone: 'off', connection: 'disconnected' })
  })

  it('stop during the permission prompt leaves nothing running', async () => {
    const { runtime, mic, sessions, state } = setup()
    runtime.start()
    await flush()
    runtime.stop()
    mic.grant()
    await flush()
    expect(state()).toBe('idle')
    expect(sessions).toHaveLength(0)
    expect(runtime.getSnapshot().connecting).toBe(false)
  })

  it('dispose (unmount) tears everything down', async () => {
    const { runtime, mic, player, session } = await connected()
    runtime.dispose()
    expect(mic.stop).toHaveBeenCalled()
    expect(session().close).toHaveBeenCalled()
    expect(player.close).toHaveBeenCalled()
  })

  it('permission denied shows an error, and text still works without a microphone', async () => {
    const { runtime, mic, player, state, sessions } = setup()
    runtime.start()
    await flush()
    mic.deny(new MicrophoneError('permission_denied', 'denied'))
    await flush()
    expect(state()).toBe('error')
    expect(runtime.getSnapshot().errorMessage).toMatch(/microphone/i)
    expect(sessions).toHaveLength(0)

    runtime.submitText('I want to start a small dairy business')
    expect(runtime.getSnapshot().advisor.profile).toMatchObject({ businessSector: 'dairy', proposedBusiness: 'small dairy business' })
    await flush()
    sessions[0].ready()
    await flush()
    expect(sessions[0].sendText).toHaveBeenCalledWith('I want to start a small dairy business')
    expect(state()).toBe('thinking')
    expect(runtime.getSnapshot().errorMessage).toBeNull()

    sessions[0].emit(audio())
    player.becomeAudible()
    expect(state()).toBe('speaking')
    sessions[0].emit({ type: 'turnComplete' })
    player.drain()
    expect(state()).toBe('idle')
  })

  it('token failure ends in a clear error and releases the microphone', async () => {
    const { runtime, mic, state } = setup(async () => {
      throw new LiveTokenError('service_not_configured', 'no key')
    })
    runtime.start()
    await flush()
    mic.grant()
    await flush()
    expect(state()).toBe('error')
    expect(runtime.getSnapshot().errorMessage).toMatch(/no Gemini key/)
    expect(mic.stop).toHaveBeenCalled()

    runtime.submitText('I am 30 years old')
    expect(runtime.getSnapshot().advisor.profile.age).toBe(30)
  })

  it('a disconnect that keeps recurring backs off, and only ends in an error once every attempt failed', async () => {
    const { runtime, mic, state, session, sessions } = await connected()
    for (const delay of RECONNECT_DELAYS_MS) {
      session().drop(1011, 'Internal error encountered.')
      await flush()
      expect(state()).toBe('listening')
      expect(runtime.getSnapshot().connecting).toBe(true)
      const opened = sessions.length
      if (delay > 0) {
        await vi.advanceTimersByTimeAsync(delay - 1)
        expect(sessions).toHaveLength(opened)
        await vi.advanceTimersByTimeAsync(1)
      }
      expect(sessions).toHaveLength(opened + (delay > 0 ? 1 : 0))
      session().ready()
      await flush()
      expect(runtime.getSnapshot().connecting).toBe(false)
      expect(runtime.getSnapshot().errorMessage).toBeNull()
    }
    session().drop(1011, 'Internal error encountered.')
    await flush()
    expect(state()).toBe('error')
    expect(mic.stop).toHaveBeenCalled()
    expect(runtime.getSnapshot().diagnostics).toMatchObject({
      lastCloseCode: 1011,
      lastCloseReason: 'Internal error encountered.',
      reconnects: RECONNECT_DELAYS_MS.length,
    })
    expect(runtime.getSnapshot().errorMessage).toBe('Voice connection closed (code 1011: Internal error encountered.).')
  })

  it('a session that answers ends the outage, so the next drop reconnects at once again', async () => {
    const { runtime, player, session, sessions } = await connected()
    session().drop(1011)
    await flush()
    session().ready()
    await flush()
    session().drop(1011)
    await vi.advanceTimersByTimeAsync(1000)
    session().ready()
    await flush()

    session().emit(audio())
    player.becomeAudible()
    session().emit({ type: 'turnComplete' })
    player.drain()

    const opened = sessions.length
    session().drop(1011)
    await flush()
    expect(sessions).toHaveLength(opened + 1)
    session().ready()
    await flush()
    expect(runtime.getSnapshot().connecting).toBe(false)
  })

  it('a session that stayed open for a while also counts as healthy', async () => {
    const { session, sessions, tick } = await connected()
    session().drop(1011)
    await flush()
    session().ready()
    await flush()
    tick(HEALTHY_SESSION_MS)
    const opened = sessions.length
    session().drop(1011)
    await flush()
    expect(sessions).toHaveLength(opened + 1)
  })

  it('a reconnect whose own setup fails is retried instead of shown as an error', async () => {
    const { runtime, state, sessions } = await connected()
    sessions[0].drop(1011, 'Internal error encountered.')
    await flush()
    sessions[1].refuse(new LiveSessionError('closed', 'closed during setup', 1011, 'Internal error encountered.'))
    await flush()
    expect(state()).toBe('listening')
    expect(sessions).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(1000)
    expect(sessions).toHaveLength(3)
    sessions[2].refuse(new LiveSessionError('setup_timeout', 'no reply'))
    await vi.advanceTimersByTimeAsync(2000)
    sessions[3].ready()
    await flush()
    expect(state()).toBe('listening')
    expect(runtime.getSnapshot().connecting).toBe(false)
    expect(runtime.getSnapshot().errorMessage).toBeNull()
  })

  it('a refused setup is not retried, since another attempt would be refused the same way', async () => {
    const { runtime, state, sessions } = await connected()
    sessions[0].drop(1011)
    await flush()
    sessions[1].refuse(new LiveSessionError('closed', 'refused', 1007, 'Request contains an invalid argument.'))
    await flush()
    expect(state()).toBe('error')
    expect(runtime.getSnapshot().errorMessage).toBe('Voice connection closed (code 1007: Request contains an invalid argument.).')
  })

  it('a reply that never starts on an open connection is asked again on a new one, then dropped with a notice', async () => {
    const { runtime, state, sessions } = await connected()
    runtime.submitText('I need a loan of 2 lakh')
    await flush()
    expect(sessions[0].sendText).toHaveBeenCalledWith('I need a loan of 2 lakh')
    expect(state()).toBe('thinking')

    await vi.advanceTimersByTimeAsync(THINKING_TIMEOUT_MS)
    expect(sessions[0].close).toHaveBeenCalled()
    expect(sessions).toHaveLength(2)
    sessions[1].ready()
    await flush()
    expect(sessions[1].sendText).toHaveBeenCalledWith('I need a loan of 2 lakh')
    expect(state()).toBe('thinking')
    expect(runtime.getSnapshot().diagnostics.stalls).toBe(1)

    await vi.advanceTimersByTimeAsync(THINKING_TIMEOUT_MS + 1000)
    sessions[2].ready()
    await flush()
    expect(sessions[2].sendText).toHaveBeenCalledWith('I need a loan of 2 lakh')

    await vi.advanceTimersByTimeAsync(THINKING_TIMEOUT_MS + 2000)
    sessions[3].ready()
    await flush()
    expect(sessions[3].sendText).not.toHaveBeenCalled()
    expect(state()).toBe('listening')
    expect(runtime.getSnapshot().notice).toBe(REPEAT_NOTICE)
    expect(runtime.getSnapshot().errorMessage).toBeNull()
    // The fact itself was recorded the moment it was typed.
    expect(runtime.getSnapshot().advisor.profile.financingRequired).toBe(200000)
  })

  it('words lost with the connection ask the user to repeat them, until they speak again', async () => {
    const { runtime, state, sessions } = await connected()
    sessions[0].emit({ type: 'toolCall', calls: [] })
    expect(state()).toBe('thinking')
    sessions[0].drop(1011)
    await flush()
    expect(state()).toBe('listening')
    expect(runtime.getSnapshot().notice).toBe(REPEAT_NOTICE)
    sessions[1].ready()
    await flush()
    sessions[1].emit({ type: 'inputTranscript', text: 'I am 40' })
    expect(runtime.getSnapshot().notice).toBeNull()
  })

  it('text typed while reconnecting waits for the new session instead of opening another', async () => {
    const { runtime, state, sessions } = await connected()
    sessions[0].drop(1011)
    await flush()
    runtime.submitText('I live in Mysuru')
    await flush()
    expect(sessions).toHaveLength(2)
    expect(state()).toBe('thinking')
    sessions[1].ready()
    await flush()
    expect(sessions[1].sendText).toHaveBeenCalledTimes(1)
    expect(sessions[1].sendText).toHaveBeenCalledWith('I live in Mysuru')
    expect(state()).toBe('thinking')
  })

  it('a new session continues the conversation instead of starting over', async () => {
    const { player, sessions } = await connected()
    expect(sessions[0].setup!.setup.systemInstruction.parts[0].text).not.toMatch(/CONVERSATION SO FAR/)
    sessions[0].emit({ type: 'inputTranscript', text: 'I want to start a dairy' })
    sessions[0].emit(audio())
    sessions[0].emit({ type: 'outputTranscript', text: 'Good idea. What is your name?' })
    player.becomeAudible()
    sessions[0].emit({ type: 'turnComplete' })
    player.drain()

    sessions[0].drop(1011)
    await flush()
    const instruction: string = sessions[1].setup!.setup.systemInstruction.parts[0].text
    expect(instruction).toMatch(/CONVERSATION SO FAR/)
    expect(instruction).toContain('Citizen: I want to start a dairy\nIshaara: Good idea. What is your name?')
  })

  it('when Gemini announces the connection will end, it is renewed at the next quiet moment', async () => {
    const { runtime, state, player, sessions } = await speaking()
    sessions[0].emit({ type: 'goAway' })
    expect(sessions).toHaveLength(1)
    sessions[0].emit({ type: 'turnComplete' })
    player.drain()
    expect(sessions[0].close).toHaveBeenCalled()
    await flush()
    expect(sessions).toHaveLength(2)
    sessions[1].ready()
    await flush()
    expect(state()).toBe('listening')
    expect(runtime.getSnapshot().notice).toBeNull()
    expect(runtime.getSnapshot().errorMessage).toBeNull()
  })

  it('a server error mid-turn reconnects with the facts on file and answers what the user said', async () => {
    const { runtime, state, sessions, player } = await connected()
    sessions[0].emit({ type: 'inputTranscript', text: 'I am 32 years old and I live in Mysuru, Karnataka' })
    sessions[0].emit({ type: 'toolCall', calls: [{ id: 'c1', name: 'recordCitizenDetail', args: { detail: 'I am 32' } }] })
    expect(state()).toBe('thinking')

    sessions[0].drop(1011, 'Internal error encountered.')
    await flush()
    expect(state()).toBe('thinking')
    expect(runtime.getSnapshot().connecting).toBe(true)
    expect(sessions).toHaveLength(2)
    expect(JSON.stringify(sessions[1].setup)).toContain('ALREADY ON FILE')

    sessions[1].ready()
    await flush()
    expect(runtime.getSnapshot().connecting).toBe(false)
    expect(sessions[1].sendText).toHaveBeenCalledWith('I am 32 years old and I live in Mysuru, Karnataka')
    expect(runtime.getSnapshot().errorMessage).toBeNull()

    sessions[1].emit(audio())
    player.becomeAudible()
    expect(state()).toBe('speaking')
  })

  it('a reply already playing is not asked again after a reconnect', async () => {
    const { state, sessions } = await speaking()
    sessions[0].drop(1011)
    await flush()
    expect(state()).toBe('listening')
    sessions[1].ready()
    await flush()
    expect(sessions[1].sendText).not.toHaveBeenCalled()
  })

  it('an exhausted quota is reported plainly instead of retried', async () => {
    const { runtime, state, sessions } = await connected()
    sessions[0].drop(1011, 'Resource has been exhausted (e.g. check quota).')
    expect(state()).toBe('error')
    expect(sessions).toHaveLength(1)
    expect(runtime.getSnapshot().errorMessage).toMatch(/usage limit/)
  })

  it('a microphone that disappears ends in an error', async () => {
    const { runtime, mic, state } = await connected()
    mic.onEnded?.()
    expect(state()).toBe('error')
    expect(runtime.getSnapshot().errorMessage).toMatch(/disconnected/)
  })

  it('records details through the real engine and answers findSchemes from the real matcher', async () => {
    const { runtime, session } = await connected()
    session().emit({
      type: 'toolCall',
      calls: [
        { id: 'a', name: 'recordCitizenDetail', args: { detail: 'I am 30 years old' } },
        { id: 'b', name: 'findSchemes', args: {} },
      ],
    })
    await flush()

    const { advisor } = runtime.getSnapshot()
    expect(advisor.profile.age).toBe(30)
    expect(advisor.matches.length).toBeGreaterThan(0)
    const [responses] = session().sendToolResponse.mock.calls[0] as [Array<{ name: string; response: Record<string, unknown> }>]
    const recorded = responses[0].response as { ok: boolean; data: { recorded: string[] } }
    expect(recorded.ok).toBe(true)
    expect(recorded.data.recorded).toEqual(['age'])
    const found = responses[1].response as { ok: boolean; data: { matches: Array<{ schemeId: string; matchPercent: number }> } }
    expect(found.data.matches.map((m) => m.schemeId)).toEqual(advisor.matches.slice(0, 5).map((m) => m.id))
    expect(found.data.matches[0].matchPercent).toBe(advisor.matches[0].matchPercent)
    expect(JSON.stringify(found)).not.toMatch(/not connected/i)
  })

  it('sends the female voice and the advisor tools in the client setup message', async () => {
    const { session } = await connected()
    const setup = session().setup!.setup
    expect(setup.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe('Sulafat')
    expect(setup.generationConfig.speechConfig.languageCode).toBeUndefined()
    expect(setup.tools[0].functionDeclarations.map((d: { name: string }) => d.name)).toEqual([
      'recordCitizenDetail',
      'findSchemes',
      'getSchemeDetails',
      'applyForScheme',
      'getCitizenProfile',
      'getApplicationReadiness',
    ])
    expect(setup.systemInstruction.parts[0].text).toMatch(/rural livelihood/)
  })

  it('a reconnect starts from the details already on file, so they are never asked again', async () => {
    const { runtime, mic, sessions } = await connected()
    expect(sessions[0].setup!.setup.systemInstruction.parts[0].text).not.toMatch(/ALREADY ON FILE/)
    sessions[0].emit({ type: 'inputTranscript', text: 'My name is Lakshmi Nair, I am 26 and I want to start a dairy business' })

    runtime.setLanguage('kn')
    await flush()
    mic.grant()
    await flush()
    const instruction: string = sessions[1].setup!.setup.systemInstruction.parts[0].text
    expect(instruction).toMatch(/ALREADY ON FILE/)
    expect(instruction).toContain('- Name: Lakshmi Nair')
    expect(instruction).toContain('- Age: 26 years')
    expect(instruction).toContain('- Sector: Dairy')
    expect(instruction).not.toMatch(/PMEGP|Stand-Up|Mudra|Kudumbashree/)
  })

  it('switching to Kannada reconnects with kn-IN and the Kannada directive, keeping the voice', async () => {
    const { runtime, mic, sessions, state } = await connected()
    runtime.setLanguage('kn')
    expect(sessions[0].close).toHaveBeenCalled()
    await flush()
    mic.grant()
    await flush()
    sessions[1].ready()
    await flush()
    expect(state()).toBe('listening')
    const setup = sessions[1].setup!.setup
    expect(setup.generationConfig.speechConfig.languageCode).toBe('kn-IN')
    expect(setup.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe('Sulafat')
    expect(setup.systemInstruction.parts[0].text).toMatch(/Respond in Kannada/)
  })

  it('speech transcripts and typed text produce the identical advisor state', async () => {
    const lines = ['I am 26 years old and I live in Kerala.', 'I want to start a small dairy business.', 'My family income is 2.5 lakh per year.']

    const spoken = await connected()
    for (const line of lines) {
      spoken.session().emit({ type: 'inputTranscript', text: line })
      spoken.session().emit(audio())
      spoken.session().emit({ type: 'turnComplete' })
      spoken.player.drain()
    }

    const typed = await connected()
    for (const line of lines) typed.runtime.submitText(line)

    const a = spoken.runtime.getSnapshot().advisor
    const b = typed.runtime.getSnapshot().advisor
    expect(a.profile).toEqual(b.profile)
    expect(a.matches).toEqual(b.matches)
    expect(a.application).toEqual(b.application)
    expect(a.profile).toMatchObject({ age: 26, state: 'Kerala', businessSector: 'dairy', annualIncome: 250000 })
  })

  it('a fact arriving mid-utterance updates the ranking before the turn ends', async () => {
    const { runtime, session } = await connected()
    session().emit({ type: 'inputTranscript', text: 'I am 26 years old' })
    session().emit({ type: 'inputTranscript', text: ' and I live in Kerala' })
    const firstTop = runtime.getSnapshot().advisor.top?.id
    session().emit({ type: 'inputTranscript', text: ' and I want to start a small dairy business' })
    const view = runtime.getSnapshot().advisor
    expect(view.profile.businessSector).toBe('dairy')
    expect(view.top?.id).not.toBe(firstTop)
  })

  it('the mouth level follows real playback only while speaking, and drops to zero on interrupt', async () => {
    const { runtime, player, session } = await connected()
    expect(runtime.getOutputLevel()).toBe(0)
    session().emit(audio())
    expect(runtime.getOutputLevel()).toBe(0)
    player.becomeAudible()
    expect(runtime.getOutputLevel()).toBe(0.6)
    runtime.interrupt()
    expect(player.interrupt).toHaveBeenCalled()
    expect(runtime.getSnapshot().voiceState).toBe('listening')
    expect(runtime.getOutputLevel()).toBe(0)
  })

  it('the mouth level returns to zero when the last sample has played', async () => {
    const { runtime, player, session } = await speaking()
    expect(runtime.getOutputLevel()).toBeGreaterThan(0)
    session().emit({ type: 'turnComplete' })
    player.drain()
    expect(runtime.getOutputLevel()).toBe(0)
  })

  it('getSchemeDetails opens that scheme for reading; only applyForScheme moves the application', async () => {
    const { runtime, session } = await connected()
    runtime.submitText('I am 26 years old and I live in Kerala. I want to start a small dairy business.')
    const top = runtime.getSnapshot().advisor.top?.id
    const second = runtime.getSnapshot().advisor.matches[1].id
    session().emit({ type: 'toolCall', calls: [{ id: 'd', name: 'getSchemeDetails', args: { schemeId: second } }] })
    await flush()
    let view = runtime.getSnapshot().advisor
    expect(view.detailSchemeId).toBe(second)
    expect(view.application?.schemeId).toBe(top)
    expect(view.application?.basis).toBe('top_match')

    session().emit({ type: 'toolCall', calls: [{ id: 'a', name: 'applyForScheme', args: { schemeId: second } }] })
    await flush()
    view = runtime.getSnapshot().advisor
    expect(view.application?.schemeId).toBe(second)
    expect(view.application?.basis).toBe('chosen')
    runtime.chooseScheme(null)
    expect(runtime.getSnapshot().advisor.application?.schemeId).toBe(runtime.getSnapshot().advisor.top?.id)
  })

  it('a reply that never produces audio does not leave the UI thinking forever', async () => {
    const { state, session } = await connected()
    session().emit({ type: 'toolCall', calls: [] })
    expect(state()).toBe('thinking')
    await vi.advanceTimersByTimeAsync(15000)
    expect(state()).toBe('listening')
  })
})
