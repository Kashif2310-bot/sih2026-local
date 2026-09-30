import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SCHEMES } from '../../assistant/data/schemes'
import { DemoController } from './demoController'
import { DEMO_TURNS } from './demoData'

describe('demo mode', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('never runs by itself', async () => {
    const demo = new DemoController()
    await vi.advanceTimersByTimeAsync(30000)
    expect(demo.getSnapshot().voiceState).toBe('idle')
    expect(demo.getSnapshot().advisor.matches).toEqual([])
  })

  it('feeds its scripted words through the real engine on its own state, with no audio', async () => {
    const demo = new DemoController()
    const other = new DemoController()
    demo.start()
    await vi.advanceTimersByTimeAsync(4000)
    const view = demo.getSnapshot().advisor
    expect(view.profile).toMatchObject({ age: 26, state: 'Kerala', businessSector: 'dairy' })
    expect(view.top).not.toBeNull()
    expect(other.getSnapshot().advisor.matches).toEqual([])
    expect(demo.getOutputLevel()).toBe(0)
    demo.dispose()
  })

  it('the script names no scheme itself; replies are worded from the engine view', () => {
    const script = DEMO_TURNS.flatMap((turn) => turn.user).join(' ')
    for (const scheme of SCHEMES) {
      expect(script).not.toContain(scheme.name)
      if (scheme.shortName) expect(script).not.toContain(scheme.shortName)
    }
  })
})
