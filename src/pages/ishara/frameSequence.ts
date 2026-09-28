/**
 * Frame-sequence math for the Ishara cinematic hero. Ported unchanged from the
 * tested standalone prototype (ishara-scroll-test/js/main.js); only the frame
 * path moved, to public/ishara/frames/.
 */

export const TOTAL_FRAMES = 192
export const PRELOAD_CONCURRENCY = 8
/** Per-RAF lerp factor toward the scroll target; 1 = jump (reduced motion). */
export const SMOOTHING = 0.14

export function frameUrl(index: number, base: string = import.meta.env.BASE_URL): string {
  return `${base}ishara/frames/frame-${String(index + 1).padStart(3, '0')}.jpg`
}

/** The loaded frame closest to `target`, preferring the earlier one on ties; -1 if none. */
export function nearestLoadedIndex(loaded: readonly boolean[], target: number): number {
  if (loaded[target]) return target
  for (let d = 1; d < loaded.length; d++) {
    const down = target - d
    const up = target + d
    if (down >= 0 && loaded[down]) return down
    if (up < loaded.length && loaded[up]) return up
  }
  return -1
}

/** Contain-fit an image into a box, centred, preserving the full composition. */
export function containFit(imgW: number, imgH: number, boxW: number, boxH: number) {
  const imgRatio = imgW / imgH
  const boxRatio = boxW / boxH
  let w: number
  let h: number
  if (boxRatio > imgRatio) {
    h = boxH
    w = h * imgRatio
  } else {
    w = boxW
    h = w / imgRatio
  }
  return { x: (boxW - w) / 2, y: (boxH - h) / 2, w, h }
}

/** 0..1 progress of the viewport through a pinned spacer, from its bounding rect. */
export function scrollProgress(rectTop: number, rectHeight: number, viewportHeight: number): number {
  const total = rectHeight - viewportHeight
  if (total <= 0) return 0
  return Math.min(1, Math.max(0, -rectTop / total))
}
