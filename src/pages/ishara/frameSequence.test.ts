import { describe, expect, it } from 'vitest'
import { TOTAL_FRAMES, containFit, frameUrl, nearestLoadedIndex, scrollProgress } from './frameSequence'

describe('Ishara frame sequence', () => {
  it('maps 0-based indices to the 192 zero-padded frame files under public/ishara/frames', () => {
    expect(TOTAL_FRAMES).toBe(192)
    expect(frameUrl(0, '/')).toBe('/ishara/frames/frame-001.jpg')
    expect(frameUrl(TOTAL_FRAMES - 1, '/')).toBe('/ishara/frames/frame-192.jpg')
    expect(frameUrl(9, '/app/')).toBe('/app/ishara/frames/frame-010.jpg')
  })

  it('falls back to the nearest loaded frame, preferring the earlier one on ties', () => {
    const loaded = [true, false, false, false, true]
    expect(nearestLoadedIndex(loaded, 0)).toBe(0)
    expect(nearestLoadedIndex(loaded, 1)).toBe(0)
    expect(nearestLoadedIndex(loaded, 2)).toBe(0)
    expect(nearestLoadedIndex(loaded, 3)).toBe(4)
    expect(nearestLoadedIndex([false, false], 1)).toBe(-1)
  })

  it('contain-fits without cropping, centred on the letterbox axis', () => {
    // 16:9 frame into a portrait 390x844 phone: full width, bars top and bottom.
    const phone = containFit(1920, 1080, 390, 844)
    expect(phone.w).toBe(390)
    expect(phone.h).toBeCloseTo(219.375)
    expect(phone.x).toBe(0)
    expect(phone.y).toBeCloseTo((844 - 219.375) / 2)

    // Ultra-wide box: full height, bars left and right.
    const wide = containFit(1920, 1080, 2000, 500)
    expect(wide.h).toBe(500)
    expect(wide.x).toBeGreaterThan(0)
    expect(wide.y).toBe(0)
  })

  it('reports clamped 0..1 progress through the pinned spacer, in both scroll directions', () => {
    const vh = 1000
    const spacer = 4000 // 400vh
    expect(scrollProgress(0, spacer, vh)).toBe(0)
    expect(scrollProgress(-1500, spacer, vh)).toBe(0.5)
    expect(scrollProgress(-3000, spacer, vh)).toBe(1)
    expect(scrollProgress(-5000, spacer, vh)).toBe(1)
    expect(scrollProgress(200, spacer, vh)).toBe(0)
    expect(scrollProgress(0, 800, vh)).toBe(0)
  })
})
