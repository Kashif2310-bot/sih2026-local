import { describe, expect, it } from 'vitest'
import { PLAYBACK_START_LEAD_SECONDS, PlaybackScheduler } from './playbackScheduler'

describe('PlaybackScheduler scheduling', () => {
  it('schedules the first chunk slightly ahead of the clock, not in the past', () => {
    const s = new PlaybackScheduler()
    const first = s.schedule(10, 0.5)
    expect(first.startAt).toBeCloseTo(10 + PLAYBACK_START_LEAD_SECONDS, 6)
  })

  it('queues consecutive chunks back-to-back so speech has no gaps', () => {
    const s = new PlaybackScheduler()
    const a = s.schedule(0, 1)
    const b = s.schedule(0, 1)
    const c = s.schedule(0, 1)
    expect(b.startAt).toBeCloseTo(a.startAt + 1, 6)
    expect(c.startAt).toBeCloseTo(a.startAt + 2, 6)
  })

  it('restarts from the clock when the queue has already drained', () => {
    const s = new PlaybackScheduler()
    s.schedule(0, 1) // occupies up to ~1.04
    // The clock has since moved well past the end of that chunk.
    const later = s.schedule(50, 1)
    expect(later.startAt).toBeCloseTo(50 + PLAYBACK_START_LEAD_SECONDS, 6)
  })

  it('reports playing once audio is queued and idle again when it finishes', () => {
    const s = new PlaybackScheduler()
    expect(s.state).toBe('idle')
    s.schedule(0, 1)
    expect(s.state).toBe('playing')
    s.finish()
    expect(s.state).toBe('idle')
  })

  it('rejects a negative duration rather than corrupting the cursor', () => {
    expect(() => new PlaybackScheduler().schedule(0, -1)).toThrow(/durationSeconds/)
  })
})

describe('PlaybackScheduler interruption', () => {
  it('invalidates audio scheduled before the interruption', () => {
    const s = new PlaybackScheduler()
    const stale = s.schedule(0, 5)
    expect(s.isCurrent(stale.generation)).toBe(true)

    s.interrupt()

    expect(s.isCurrent(stale.generation)).toBe(false)
    expect(s.state).toBe('interrupted')
  })

  it('keeps audio scheduled AFTER the interruption valid', () => {
    const s = new PlaybackScheduler()
    s.schedule(0, 5)
    s.interrupt()
    const fresh = s.schedule(1, 1)
    expect(s.isCurrent(fresh.generation)).toBe(true)
  })

  it('does not let the interrupted turn tail play after the next reply starts', () => {
    // This is the specific race the generation counter exists to prevent:
    // reply A is long, the citizen barges in, reply B begins — and A's
    // remaining chunks must not be scheduled after B's.
    const s = new PlaybackScheduler()
    const replyA = s.schedule(0, 10)
    s.interrupt()
    const replyB = s.schedule(1, 1)

    expect(s.isCurrent(replyA.generation)).toBe(false)
    expect(s.isCurrent(replyB.generation)).toBe(true)
    // B starts from the live clock, not queued behind A's ten seconds.
    expect(replyB.startAt).toBeLessThan(replyA.startAt + 10)
  })

  it('treats a second interruption as harmless', () => {
    const s = new PlaybackScheduler()
    const stale = s.schedule(0, 1)
    s.interrupt()
    s.interrupt()
    expect(s.isCurrent(stale.generation)).toBe(false)
  })

  it('finish() after an interruption does not resurrect the idle state', () => {
    const s = new PlaybackScheduler()
    s.schedule(0, 1)
    s.interrupt()
    s.finish()
    expect(s.state).toBe('interrupted')
  })

  it('stop() and reset() both invalidate outstanding audio', () => {
    const stopped = new PlaybackScheduler()
    const a = stopped.schedule(0, 1)
    stopped.stop()
    expect(stopped.isCurrent(a.generation)).toBe(false)
    expect(stopped.state).toBe('stopped')

    const reused = new PlaybackScheduler()
    const b = reused.schedule(0, 1)
    reused.reset()
    expect(reused.isCurrent(b.generation)).toBe(false)
    expect(reused.state).toBe('idle')
  })
})
