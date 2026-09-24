/**
 * PCM conversion primitives — pure functions, no Web Audio, no DOM, so the
 * numerically fiddly part of microphone capture is unit-testable in this
 * repo's Node test environment (see vitest.config.ts) rather than only
 * observable by ear in a browser.
 *
 * Gemini Live's documented audio contract (verified 2026-09-23):
 *   input  — raw 16-bit PCM, mono, little-endian, 16kHz
 *   output — raw 16-bit PCM, mono, little-endian, 24kHz
 * The browser gives us Float32 samples in [-1, 1] at the AudioContext's own
 * rate (typically 48kHz), so both a format conversion and a rate conversion
 * are required. GeminiLiveVoiceSession deliberately validates and throws
 * rather than resampling, so doing it correctly is this module's job.
 */

/**
 * Float32 [-1, 1] -> signed 16-bit little-endian.
 *
 * Asymmetric scaling is deliberate and not a rounding slip: two's-complement
 * 16-bit covers -32768..32767, so negative samples scale by 32768 and
 * positive by 32767. Using one factor for both either clips every full-scale
 * positive sample or wastes a code point. Input outside [-1, 1] (which
 * getUserMedia can produce with some gain settings) is clamped rather than
 * allowed to wrap around into loud noise.
 */
export function float32ToPcm16(input: Float32Array): Int16Array<ArrayBuffer> {
  const out = new Int16Array(input.length)
  for (let i = 0; i < input.length; i++) {
    const s = input[i]
    const clamped = s < -1 ? -1 : s > 1 ? 1 : s
    out[i] = clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767)
  }
  return out
}

/**
 * Linear-interpolation resampler, mono.
 *
 * Linear interpolation (rather than a windowed-sinc filter) is the right
 * trade here: we only ever downsample speech from 48kHz to 16kHz for a
 * speech-recognition pipeline, the aliasing it introduces sits well above
 * the band that carries intelligibility, and a proper polyphase filter
 * would cost CPU on low-end phones — which is exactly the hardware this
 * product targets. Returns the input untouched when the rates already match,
 * so the common case allocates nothing extra.
 */
export function resampleLinear(input: Float32Array, fromRateHz: number, toRateHz: number): Float32Array {
  if (fromRateHz <= 0 || toRateHz <= 0) {
    throw new Error(`resampleLinear: sample rates must be positive (got ${fromRateHz} -> ${toRateHz}).`)
  }
  if (fromRateHz === toRateHz) return input
  if (input.length === 0) return input

  const ratio = fromRateHz / toRateHz
  const outLength = Math.floor(input.length / ratio)
  const out = new Float32Array(outLength)
  for (let i = 0; i < outLength; i++) {
    const srcPos = i * ratio
    const idx = Math.floor(srcPos)
    const frac = srcPos - idx
    const a = input[idx]
    // At the tail there is no next sample to interpolate toward; holding the
    // last value is correct here and avoids reading undefined -> NaN.
    const b = idx + 1 < input.length ? input[idx + 1] : a
    out[i] = a + (b - a) * frac
  }
  return out
}

/**
 * Int16Array -> the exact little-endian byte layout Gemini expects.
 *
 * Written byte-by-byte through a DataView with an explicit littleEndian
 * flag rather than handing over `int16.buffer` directly: the latter would
 * silently emit big-endian bytes on a big-endian host, producing audio that
 * is pure noise on exactly the machines nobody tests on.
 */
export function pcm16ToLittleEndianBytes(samples: Int16Array): ArrayBuffer {
  const buffer = new ArrayBuffer(samples.length * 2)
  const view = new DataView(buffer)
  for (let i = 0; i < samples.length; i++) view.setInt16(i * 2, samples[i], true)
  return buffer
}

/** Inverse of pcm16ToLittleEndianBytes — used by playback to turn Gemini's 24kHz PCM back into samples. */
export function littleEndianBytesToPcm16(buffer: ArrayBuffer): Int16Array<ArrayBuffer> {
  const view = new DataView(buffer)
  const count = Math.floor(buffer.byteLength / 2)
  const out = new Int16Array(count)
  for (let i = 0; i < count; i++) out[i] = view.getInt16(i * 2, true)
  return out
}

/** Signed 16-bit -> Float32 [-1, 1], for handing decoded audio to Web Audio. Mirrors float32ToPcm16's asymmetric scaling. */
export function pcm16ToFloat32(samples: Int16Array): Float32Array<ArrayBuffer> {
  const out = new Float32Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i]
    out[i] = s < 0 ? s / 32768 : s / 32767
  }
  return out
}

/** One-call microphone path: browser Float32 at any rate -> Gemini-ready little-endian PCM16 bytes. */
export function encodeMicrophoneFrame(input: Float32Array, fromRateHz: number, targetRateHz: number): ArrayBuffer {
  return pcm16ToLittleEndianBytes(float32ToPcm16(resampleLinear(input, fromRateHz, targetRateHz)))
}

/** One-call playback path: Gemini's little-endian PCM16 bytes -> Float32 samples for an AudioBuffer. */
export function decodePlaybackFrame(buffer: ArrayBuffer): Float32Array<ArrayBuffer> {
  return pcm16ToFloat32(littleEndianBytesToPcm16(buffer))
}
