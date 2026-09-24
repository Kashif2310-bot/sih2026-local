/**
 * Microphone lifecycle and error mapping. The Web Audio graph itself is not
 * exercised here (this repo's test environment is Node — see
 * vitest.config.ts); what IS exercised is everything that decides whether a
 * device gets opened, stays open, or gets released, which is where the real
 * bugs live: a leaked MediaStream leaves the browser's recording indicator
 * lit after the citizen thinks they stopped.
 */

import { describe, expect, it, vi } from 'vitest'
import { MicrophoneCapture, classifyMicrophoneError } from './microphoneCapture'

class FakeTrack {
  stopped = false
  readonly listeners = new Map<string, () => void>()
  stop() {
    this.stopped = true
  }
  addEventListener(name: string, handler: () => void) {
    this.listeners.set(name, handler)
  }
}

function fakeStream() {
  const track = new FakeTrack()
  const stream = {
    getTracks: () => [track],
    getAudioTracks: () => [track],
  } as unknown as MediaStream
  return { stream, track }
}

/** A deliberately failing AudioContext factory — the graph cannot be built in Node, so every test that gets past getUserMedia lands in the error path by design. */
function unavailableContext(): () => AudioContext {
  return () => {
    throw new Error('AudioContext is unavailable in this environment')
  }
}

function makeCapture(overrides: {
  getUserMedia?: (c: MediaStreamConstraints) => Promise<MediaStream>
  onError?: (e: { code: string; message: string }) => void
} = {}) {
  return new MicrophoneCapture({
    targetSampleRateHz: 16000,
    onFrame: () => {},
    onError: overrides.onError,
    getUserMedia: overrides.getUserMedia ?? (() => Promise.resolve(fakeStream().stream)),
    createContext: unavailableContext(),
  })
}

describe('permission and device errors', () => {
  it('maps a denied permission to an actionable message, not a DOMException name', () => {
    const error = classifyMicrophoneError(Object.assign(new Error('x'), { name: 'NotAllowedError' }))
    expect(error.code).toBe('permission_denied')
    expect(error.message).toMatch(/allow/i)
  })

  it('maps every documented device failure to its own code', () => {
    const cases: Array<[string, string]> = [
      ['NotFoundError', 'no_microphone'],
      ['DevicesNotFoundError', 'no_microphone'],
      ['PermissionDeniedError', 'permission_denied'],
      ['NotReadableError', 'device_lost'],
      ['OverconstrainedError', 'unsupported'],
    ]
    for (const [name, code] of cases) {
      expect(classifyMicrophoneError(Object.assign(new Error('x'), { name })).code).toBe(code)
    }
  })

  it('falls back to unknown rather than throwing on an unrecognised failure', () => {
    expect(classifyMicrophoneError('a string').code).toBe('unknown')
  })

  it('reports a denied permission through onError and ends in the error state', async () => {
    const onError = vi.fn()
    const capture = makeCapture({
      getUserMedia: () => Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' })),
      onError,
    })

    await expect(capture.start()).rejects.toThrow()

    expect(capture.state).toBe('error')
    expect(capture.isCapturing).toBe(false)
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'permission_denied' }))
  })
})

describe('resource release', () => {
  it('stops the device when the audio graph cannot be built', async () => {
    // Permission was granted, then setup failed. The stream must not survive
    // — this is the leak that leaves the recording indicator on.
    const { stream, track } = fakeStream()
    const capture = makeCapture({ getUserMedia: () => Promise.resolve(stream) })

    await expect(capture.start()).rejects.toThrow()

    expect(track.stopped).toBe(true)
  })

  it('stops the device if stop() lands while permission is still pending', async () => {
    const { stream, track } = fakeStream()
    let release: (s: MediaStream) => void = () => {}
    const pending = new Promise<MediaStream>((resolve) => {
      release = resolve
    })
    const capture = makeCapture({ getUserMedia: () => pending })

    const starting = capture.start()
    await capture.stop() // citizen changed their mind mid-prompt
    release(stream)
    await starting.catch(() => {})

    expect(track.stopped).toBe(true)
  })

  it('is safe to stop repeatedly', async () => {
    const capture = makeCapture()
    await capture.stop()
    await capture.stop()
    expect(capture.state).toBe('stopped')
  })

  it('refuses to start again after disposal', async () => {
    const capture = makeCapture()
    await capture.dispose()
    await expect(capture.start()).rejects.toThrow(/disposed/)
  })

  it('is safe to dispose repeatedly', async () => {
    const capture = makeCapture()
    await capture.dispose()
    await capture.dispose()
    expect(capture.state).toBe('stopped')
  })
})

describe('duplicate start protection', () => {
  it('opens only ONE device when start() is called twice concurrently', async () => {
    // React StrictMode double-invokes effects; without the in-flight guard
    // this opens two microphones and leaks one of them.
    const getUserMedia = vi.fn(() => Promise.resolve(fakeStream().stream))
    const capture = makeCapture({ getUserMedia })

    await Promise.allSettled([capture.start(), capture.start()])

    expect(getUserMedia).toHaveBeenCalledTimes(1)
  })

  it('requests a mono stream with echo cancellation enabled', async () => {
    // Without echo cancellation the assistant's own voice re-enters the
    // microphone and the server's VAD treats it as the citizen interrupting.
    const seen: MediaStreamConstraints[] = []
    const capture = makeCapture({
      getUserMedia: (c) => {
        seen.push(c)
        return Promise.resolve(fakeStream().stream)
      },
    })

    await capture.start().catch(() => {})

    const audio = seen[0]?.audio as MediaTrackConstraints | undefined
    expect(audio?.echoCancellation).toBe(true)
    expect(audio?.channelCount).toBe(1)
  })
})
