import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { AudioOutputPlayer } from './audioPlayer'

interface FakeSource {
  buffer: unknown
  onended: (() => void) | null
  connect: Mock<(node: unknown) => void>
  start: Mock<(when: number) => void>
  stop: Mock<() => void>
}

function createFakeContext() {
  const sources: FakeSource[] = []
  const context = {
    currentTime: 0,
    state: 'running',
    destination: {},
    createBuffer: (_channels: number, length: number, rate: number) => ({
      duration: length / rate,
      copyToChannel: vi.fn<(source: Float32Array, channel: number) => void>(),
    }),
    createBufferSource: () => {
      const source: FakeSource = {
        buffer: null,
        onended: null,
        connect: vi.fn<(node: unknown) => void>(),
        start: vi.fn<(when: number) => void>(),
        stop: vi.fn<() => void>(),
      }
      sources.push(source)
      return source
    },
    createAnalyser: () => ({
      fftSize: 0,
      connect: vi.fn<(node: unknown) => void>(),
      getFloatTimeDomainData: vi.fn<(array: Float32Array) => void>(),
    }),
    resume: vi.fn(async () => {
      context.state = 'running'
    }),
    close: vi.fn(async () => undefined),
  }
  return { context, sources }
}

const chunk = (samples = 2400) => new Uint8Array(samples * 2).fill(16)

describe('AudioOutputPlayer', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  function setup() {
    const fake = createFakeContext()
    const player = new AudioOutputPlayer(() => fake.context)
    const handlers = { onStart: vi.fn(), onDrained: vi.fn(), onError: vi.fn() }
    player.setHandlers(handlers)
    return { ...fake, player, handlers }
  }

  it('schedules chunks back to back and reports start only once audible', () => {
    const { player, sources, handlers } = setup()
    player.enqueue(chunk())
    player.enqueue(chunk())

    expect(sources[0].start).toHaveBeenCalledWith(0.04)
    expect(sources[1].start).toHaveBeenCalledWith(expect.closeTo(0.14, 5))
    expect(handlers.onStart).not.toHaveBeenCalled()

    vi.advanceTimersByTime(40)
    expect(handlers.onStart).toHaveBeenCalledTimes(1)
    expect(player.isPlaying).toBe(true)

    sources[0].onended?.()
    expect(handlers.onDrained).not.toHaveBeenCalled()
    sources[1].onended?.()
    expect(handlers.onDrained).toHaveBeenCalledTimes(1)
    expect(player.isPlaying).toBe(false)
  })

  it('stops live sources on interrupt and ignores their late callbacks (no stale audio)', () => {
    const { player, sources, handlers } = setup()
    player.enqueue(chunk())
    vi.advanceTimersByTime(40)
    const stale = sources[0]
    const staleEnded = stale.onended

    player.interrupt()
    expect(stale.stop).toHaveBeenCalled()
    expect(player.isPlaying).toBe(false)

    staleEnded?.()
    expect(handlers.onDrained).not.toHaveBeenCalled()

    player.enqueue(chunk())
    expect(sources[1].start).toHaveBeenCalledWith(0.04)
    vi.advanceTimersByTime(40)
    expect(handlers.onStart).toHaveBeenCalledTimes(2)
  })

  it('does not announce start for audio interrupted before it became audible', () => {
    const { player, handlers } = setup()
    player.enqueue(chunk())
    player.interrupt()
    vi.advanceTimersByTime(100)
    expect(handlers.onStart).not.toHaveBeenCalled()
  })

  it('reports a playback failure instead of pretending to speak when audio is blocked', () => {
    const { player, context, handlers } = setup()
    context.state = 'suspended'
    player.enqueue(chunk())
    vi.advanceTimersByTime(40)
    expect(handlers.onStart).not.toHaveBeenCalled()
    expect(handlers.onError).toHaveBeenCalledTimes(1)
    expect(player.isPlaying).toBe(false)
  })
})
