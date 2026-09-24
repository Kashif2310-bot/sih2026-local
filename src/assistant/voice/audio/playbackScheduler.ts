/**
 * The scheduling brain of streaming audio playback, separated from Web Audio
 * so it can be unit-tested in this repo's Node test environment. It answers
 * two questions and holds no browser objects:
 *
 *   1. WHEN should the next chunk start, so consecutive chunks play
 *      gapless rather than overlapping or stuttering?
 *   2. Is a chunk that arrived late still allowed to play, or does it belong
 *      to a turn the citizen already interrupted?
 *
 * (2) is the one that actually bites in practice. Gemini streams a reply as
 * many small chunks; when the citizen barges in, chunks already in flight
 * keep arriving, and buffers already handed to the audio hardware keep their
 * scheduled start times. Without a generation counter, the interrupted
 * reply's tail plays *after* the new reply starts — the exact race called
 * out as forbidden. Every chunk is stamped with the generation current when
 * it was accepted, and `interrupt()` bumps that generation, so stale audio
 * is identifiable and droppable rather than merely "usually too late".
 */

export type PlaybackState = 'idle' | 'playing' | 'interrupted' | 'stopped' | 'error'

export interface ScheduledChunk {
  /** AudioContext-clock time this chunk should start at. */
  startAt: number
  /** The generation it belongs to — compare against `generation` before letting it make a sound. */
  generation: number
}

/**
 * Small lead added when starting a fresh run of audio, so the first buffer
 * isn't scheduled at a moment that has already passed by the time the
 * browser processes it (which surfaces as a click or a dropped first
 * syllable). Large enough to absorb a scheduling hiccup, small enough to
 * stay imperceptible.
 */
export const PLAYBACK_START_LEAD_SECONDS = 0.04

export class PlaybackScheduler {
  private cursor = 0
  private _generation = 0
  private _state: PlaybackState = 'idle'

  get generation(): number {
    return this._generation
  }

  get state(): PlaybackState {
    return this._state
  }

  /** Where the currently-queued audio is scheduled to run out. Equal to the context clock when nothing is queued. */
  get scheduledUntil(): number {
    return this.cursor
  }

  /**
   * Reserves the next slot. `now` is the audio clock's current time;
   * `durationSeconds` is the chunk's own length. Returns the start time and
   * the generation stamp the caller must re-check before the sound is
   * allowed to reach the speakers.
   *
   * When the queue has drained (or this is the first chunk after an
   * interruption), scheduling restarts from `now` plus a small lead instead
   * of from a stale cursor in the past.
   */
  schedule(now: number, durationSeconds: number): ScheduledChunk {
    if (durationSeconds < 0) throw new Error('PlaybackScheduler: durationSeconds must be >= 0.')
    const startAt = this.cursor > now ? this.cursor : now + PLAYBACK_START_LEAD_SECONDS
    this.cursor = startAt + durationSeconds
    this._state = 'playing'
    return { startAt, generation: this._generation }
  }

  /** True if audio stamped with `generation` still belongs to the current turn. */
  isCurrent(generation: number): boolean {
    return generation === this._generation
  }

  /**
   * Barge-in. Invalidates everything already scheduled and returns the new
   * generation. Idempotent in effect — calling it twice simply invalidates
   * twice, which is harmless and simpler than tracking whether an
   * interruption is "already in progress".
   */
  interrupt(): number {
    this._generation += 1
    this.cursor = 0
    this._state = 'interrupted'
    return this._generation
  }

  /** Playback ended normally (the model finished its turn). Does NOT invalidate audio — the tail is meant to finish. */
  finish(): void {
    if (this._state === 'playing') this._state = 'idle'
  }

  /** Full stop — same invalidation as interrupt(), different reported state. */
  stop(): void {
    this._generation += 1
    this.cursor = 0
    this._state = 'stopped'
  }

  /** Back to a clean slate for reuse, invalidating anything outstanding. */
  reset(): void {
    this._generation += 1
    this.cursor = 0
    this._state = 'idle'
  }

  markError(): void {
    this._state = 'error'
  }
}
