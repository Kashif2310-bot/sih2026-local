import { describe, expect, it } from 'vitest'
import {
  decodePlaybackFrame,
  encodeMicrophoneFrame,
  float32ToPcm16,
  littleEndianBytesToPcm16,
  pcm16ToFloat32,
  pcm16ToLittleEndianBytes,
  resampleLinear,
} from './pcm'

describe('float32ToPcm16', () => {
  it('maps full-scale values to the exact 16-bit extremes', () => {
    const out = float32ToPcm16(new Float32Array([1, -1, 0]))
    expect(out[0]).toBe(32767)
    expect(out[1]).toBe(-32768)
    expect(out[2]).toBe(0)
  })

  it('clamps out-of-range input instead of letting it wrap into loud noise', () => {
    // A wrapping conversion would turn +2 into a large NEGATIVE value, which
    // is audible as a violent click rather than as clipping.
    const out = float32ToPcm16(new Float32Array([2, -2]))
    expect(out[0]).toBe(32767)
    expect(out[1]).toBe(-32768)
  })

  it('round-trips a mid-scale value within one quantisation step', () => {
    const roundTripped = pcm16ToFloat32(float32ToPcm16(new Float32Array([0.5])))
    expect(roundTripped[0]).toBeCloseTo(0.5, 4)
  })
})

describe('resampleLinear', () => {
  it('returns the identical array when the rates already match', () => {
    const input = new Float32Array([0.1, 0.2])
    expect(resampleLinear(input, 16000, 16000)).toBe(input)
  })

  it('produces the expected sample count when downsampling 48kHz to 16kHz', () => {
    const input = new Float32Array(480)
    expect(resampleLinear(input, 48000, 16000).length).toBe(160)
  })

  it('interpolates between neighbouring samples rather than dropping them', () => {
    // 4 samples at 4Hz -> 2 samples at 2Hz: positions 0 and 2.
    const out = resampleLinear(new Float32Array([0, 1, 2, 3]), 4, 2)
    expect(Array.from(out)).toEqual([0, 2])
  })

  it('holds the final sample instead of reading past the end', () => {
    // Would produce NaN if the tail interpolated toward an undefined neighbour.
    const out = resampleLinear(new Float32Array([1, 1, 1]), 3, 2)
    expect(Array.from(out).every((v) => Number.isFinite(v))).toBe(true)
  })

  it('rejects non-positive sample rates', () => {
    expect(() => resampleLinear(new Float32Array([0]), 0, 16000)).toThrow(/positive/)
  })

  it('handles an empty buffer without throwing', () => {
    expect(resampleLinear(new Float32Array(0), 48000, 16000).length).toBe(0)
  })
})

describe('little-endian byte layout', () => {
  it('writes the low byte first, as Gemini requires', () => {
    // 0x0102 little-endian is [0x02, 0x01]; big-endian would be [0x01, 0x02]
    // and would reach Gemini as noise.
    const bytes = new Uint8Array(pcm16ToLittleEndianBytes(new Int16Array([0x0102])))
    expect(Array.from(bytes)).toEqual([0x02, 0x01])
  })

  it('round-trips signed values including the negative extreme', () => {
    const samples = new Int16Array([0, 1, -1, 32767, -32768])
    const back = littleEndianBytesToPcm16(pcm16ToLittleEndianBytes(samples))
    expect(Array.from(back)).toEqual(Array.from(samples))
  })

  it('ignores a trailing odd byte rather than reading past the buffer', () => {
    expect(littleEndianBytesToPcm16(new ArrayBuffer(3)).length).toBe(1)
  })
})

describe('end-to-end frame helpers', () => {
  it('encodes a microphone frame to the expected byte length', () => {
    // 480 samples at 48kHz -> 160 samples at 16kHz -> 320 bytes.
    expect(encodeMicrophoneFrame(new Float32Array(480), 48000, 16000).byteLength).toBe(320)
  })

  it('decodes playback bytes back into the original waveform', () => {
    const original = new Float32Array([0, 0.25, -0.25, 1, -1])
    const decoded = decodePlaybackFrame(pcm16ToLittleEndianBytes(float32ToPcm16(original)))
    expect(decoded.length).toBe(original.length)
    for (let i = 0; i < original.length; i++) {
      expect(decoded[i]).toBeCloseTo(original[i], 4)
    }
  })
})
