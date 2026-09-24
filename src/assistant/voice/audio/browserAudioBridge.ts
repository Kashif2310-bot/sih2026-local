/**
 * The concrete VoiceAudioBridge: MicrophoneCapture on the way in,
 * AudioOutputPlayer on the way out, wired to Gemini's documented rates.
 *
 * This is the only module that knows both halves of the audio path, and the
 * only place the runtime's provider-independent bridge contract meets
 * Gemini's specific 16kHz-in / 24kHz-out requirement. Deliberately thin:
 * every decision of substance already lives in the two modules it composes.
 *
 * Two separate AudioContexts are used on purpose — capture runs at the
 * hardware's native rate (whatever the device gives us, resampled in
 * software to 16kHz) while playback runs at exactly 24kHz so Gemini's audio
 * needs no resampling at all. Forcing both through one context would mean
 * resampling the assistant's voice on every chunk, which is both wasted CPU
 * and a quality loss on the half of the conversation the citizen is
 * listening to.
 */

import {
  GEMINI_LIVE_INPUT_SAMPLE_RATE_HZ,
  GEMINI_LIVE_OUTPUT_SAMPLE_RATE_HZ,
} from '../geminiLiveProtocol'
import type { VoiceAudioBridge } from '../../conversation/voiceConversationRuntime'
import { AudioOutputPlayer, isAudioPlaybackSupported } from './audioOutputPlayer'
import { MicrophoneCapture, isMicrophoneCaptureSupported, type MicrophoneError } from './microphoneCapture'

export interface BrowserAudioBridgeOptions {
  onMicrophoneError?: (error: MicrophoneError) => void
  onPlaybackError?: (error: Error) => void
}

/** True only when BOTH halves are available — a browser that can hear but not speak is not a voice assistant. */
export function isBrowserVoiceAudioSupported(): boolean {
  return isMicrophoneCaptureSupported() && isAudioPlaybackSupported()
}

export class BrowserAudioBridge implements VoiceAudioBridge {
  readonly inputSampleRateHz = GEMINI_LIVE_INPUT_SAMPLE_RATE_HZ

  private readonly player: AudioOutputPlayer
  private capture: MicrophoneCapture | null = null
  private readonly options: BrowserAudioBridgeOptions
  private disposed = false

  constructor(options: BrowserAudioBridgeOptions = {}) {
    this.options = options
    this.player = new AudioOutputPlayer({
      sampleRateHz: GEMINI_LIVE_OUTPUT_SAMPLE_RATE_HZ,
      onError: (error) => this.options.onPlaybackError?.(error),
    })
  }

  async startCapture(onFrame: (frame: ArrayBuffer) => void): Promise<void> {
    if (this.disposed) throw new Error('BrowserAudioBridge: bridge has been disposed.')

    // Prepare playback BEFORE requesting the microphone. Both need to happen
    // inside the user gesture that started voice, and an AudioContext
    // created after an await on getUserMedia can land outside that gesture
    // in some browsers, leaving playback permanently suspended and silent.
    await this.player.prepare()

    if (!this.capture) {
      this.capture = new MicrophoneCapture({
        targetSampleRateHz: GEMINI_LIVE_INPUT_SAMPLE_RATE_HZ,
        onFrame,
        onError: (error) => this.options.onMicrophoneError?.(error),
      })
    }
    await this.capture.start()
  }

  async stopCapture(): Promise<void> {
    await this.capture?.stop()
  }

  playChunk(chunk: ArrayBuffer): void {
    this.player.playChunk(chunk)
  }

  interruptPlayback(): void {
    this.player.interrupt()
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    // Microphone first: it is the resource with a visible indicator.
    await this.capture?.dispose()
    this.capture = null
    await this.player.dispose()
  }
}
