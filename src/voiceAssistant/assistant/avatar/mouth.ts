/**
 * Mouth motion driven by the assistant's actual output audio. The input is
 * the playback analyser's level (post-scheduling, so it is what is audible
 * right now); there is no timeline, loop or prerecorded motion. Silence,
 * the final sample and an interruption all read as level 0, so the mouth
 * closes with the audio.
 */

/** Time constants in ms: opening follows syllable onsets quickly; closing is slightly softer. */
export const MOUTH_ATTACK_MS = 28
export const MOUTH_RELEASE_MS = 70

/** Output levels below this are breath and room tone, not speech. */
const LEVEL_FLOOR = 0.1
const LEVEL_SPAN = 0.62
const CLOSED_EPSILON = 0.015

export function mouthTarget(level: number): number {
  if (!Number.isFinite(level)) return 0
  return Math.max(0, Math.min(1, (level - LEVEL_FLOOR) / LEVEL_SPAN))
}

/** One animation step, independent of frame rate. */
export function stepMouth(current: number, level: number, dtMs: number): number {
  const target = mouthTarget(level)
  const tau = target > current ? MOUTH_ATTACK_MS : MOUTH_RELEASE_MS
  const k = 1 - Math.exp(-Math.max(0, dtMs) / tau)
  const next = current + (target - current) * k
  return next < CLOSED_EPSILON ? 0 : next
}

const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

/** Opacities of the two photographed mouth shapes layered over the closed-mouth portrait. */
export function mouthLayers(openness: number): { mid: number; open: number } {
  return { mid: smoothstep(0.04, 0.4, openness), open: smoothstep(0.38, 0.85, openness) }
}
