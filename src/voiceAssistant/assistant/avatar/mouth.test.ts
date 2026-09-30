import { describe, expect, it } from 'vitest'
import { mouthLayers, mouthTarget, stepMouth } from './mouth'

const run = (levels: number[], start = 0, dt = 16.7) => levels.reduce((open, level) => stepMouth(open, level, dt), start)

describe('audio-driven mouth', () => {
  it('stays closed in silence and below the speech floor', () => {
    expect(run(Array(60).fill(0))).toBe(0)
    expect(run(Array(60).fill(0.08))).toBe(0)
    expect(mouthLayers(0)).toEqual({ mid: 0, open: 0 })
  })

  it('opens with speech-level audio and opens wider for louder audio', () => {
    const soft = run(Array(10).fill(0.3))
    const loud = run(Array(10).fill(0.8))
    expect(soft).toBeGreaterThan(0.2)
    expect(loud).toBeGreaterThan(soft)
    expect(mouthLayers(loud).open).toBeGreaterThan(mouthLayers(soft).open)
  })

  it('follows syllables: opens within a couple of frames of an onset', () => {
    expect(run([0.8, 0.8])).toBeGreaterThan(0.5)
  })

  it('closes fully within a few hundred ms of the final sample', () => {
    const speaking = run(Array(20).fill(0.8))
    const closed = run(Array(24).fill(0), speaking)
    expect(closed).toBe(0)
  })

  it('is independent of frame rate', () => {
    const at60 = run(Array(12).fill(0.6), 0, 1000 / 60)
    const at120 = run(Array(24).fill(0.6), 0, 1000 / 120)
    expect(Math.abs(at60 - at120)).toBeLessThan(0.01)
  })

  it('ignores invalid levels', () => {
    expect(mouthTarget(Number.NaN)).toBe(0)
    expect(stepMouth(0, Number.POSITIVE_INFINITY, 16)).toBe(0)
  })
})
