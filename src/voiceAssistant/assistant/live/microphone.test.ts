import { describe, expect, it, vi } from 'vitest'
import { MicrophoneCapture, MicrophoneError, type MicrophoneDeps } from './microphone'

function fakeStream() {
  const endedListeners: Array<() => void> = []
  const track = {
    stop: vi.fn(),
    addEventListener: (_: string, listener: () => void) => endedListeners.push(listener),
  }
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream
  return { stream, track, endTrack: () => endedListeners.forEach((listener) => listener()) }
}

function setup(getUserMedia: MicrophoneDeps['getUserMedia']) {
  const port: { onmessage: ((event: { data: unknown }) => void) | null } = { onmessage: null }
  const node = { port, disconnect: vi.fn() }
  const source = { connect: vi.fn(), disconnect: vi.fn() }
  const context = {
    sampleRate: 48000,
    state: 'running',
    audioWorklet: { addModule: vi.fn(async () => undefined) },
    createMediaStreamSource: vi.fn(() => source),
    resume: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  }
  const mic = new MicrophoneCapture({
    getUserMedia,
    createContext: () => context,
    createWorkletNode: () => node,
    workletUrl: () => 'worklet.js',
  })
  return { mic, port, node, source, context }
}

const domError = (name: string) => Object.assign(new Error(name), { name })

describe('MicrophoneCapture', () => {
  it('captures real frames as 16 kHz PCM16 with a level, then releases everything on stop', async () => {
    const { stream, track } = fakeStream()
    const { mic, port, node, context } = setup(async () => stream)
    const frames: Array<{ pcm16: Uint8Array; level: number }> = []

    await mic.start((frame) => frames.push(frame), () => undefined)
    expect(mic.status).toBe('active')

    const loud = new Float32Array(2048).map((_, i) => Math.sin(i / 5) * 0.5)
    port.onmessage?.({ data: loud })
    port.onmessage?.({ data: new Float32Array(2048) })

    // 2048 samples at 48 kHz -> 682 samples at 16 kHz -> 1364 bytes of PCM16.
    expect(frames[0].pcm16.byteLength).toBe(1364)
    expect(frames[0].level).toBeGreaterThan(0.3)
    expect(frames[1].level).toBe(0)

    mic.stop()
    expect(track.stop).toHaveBeenCalled()
    expect(node.disconnect).toHaveBeenCalled()
    expect(context.close).toHaveBeenCalled()
    expect(mic.status).toBe('inactive')

    port.onmessage?.({ data: loud })
    expect(frames).toHaveLength(2)
  })

  it('classifies permission denial and missing devices', async () => {
    const denied = setup(async () => {
      throw domError('NotAllowedError')
    }).mic
    await expect(denied.start(() => undefined, () => undefined)).rejects.toMatchObject({ kind: 'permission_denied' })
    expect(denied.status).toBe('inactive')

    const missing = setup(async () => {
      throw domError('NotFoundError')
    }).mic
    await expect(missing.start(() => undefined, () => undefined)).rejects.toMatchObject({ kind: 'no_microphone' })
  })

  it('stops the tracks if stop() lands while the permission prompt is open', async () => {
    const { stream, track } = fakeStream()
    let grant: (value: MediaStream) => void = () => undefined
    const { mic, context } = setup(() => new Promise<MediaStream>((resolve) => (grant = resolve)))

    const starting = mic.start(() => undefined, () => undefined)
    mic.stop()
    grant(stream)

    await expect(starting).rejects.toBeInstanceOf(MicrophoneError)
    await starting.catch((error: MicrophoneError) => expect(error.kind).toBe('aborted'))
    expect(track.stop).toHaveBeenCalled()
    expect(context.createMediaStreamSource).not.toHaveBeenCalled()
    expect(mic.status).toBe('inactive')
  })

  it('reports a device that disappears mid-capture', async () => {
    const { stream, endTrack } = fakeStream()
    const { mic } = setup(async () => stream)
    const onEnded = vi.fn()
    await mic.start(() => undefined, onEnded)
    endTrack()
    expect(onEnded).toHaveBeenCalledTimes(1)
  })
})
