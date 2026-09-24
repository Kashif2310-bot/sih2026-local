/**
 * The AudioWorklet processor that pulls microphone samples off the audio
 * rendering thread.
 *
 * Shipped as a source string compiled to a Blob URL at runtime rather than a
 * separate .js asset, because `audioWorklet.addModule()` takes a URL and a
 * standalone file in public/ would sit outside the bundler's module graph —
 * no typechecking, no bundling, and a path that silently breaks under a
 * non-root base URL. A Blob URL keeps the worklet next to the code that uses
 * it and correct under every deployment path.
 *
 * ScriptProcessorNode would be fewer lines but is deprecated and runs on the
 * main thread, so any React render competing for that thread shows up as
 * dropped microphone frames — audible to the person speaking as words the
 * assistant never heard.
 *
 * The processor itself is deliberately minimal: it buffers raw Float32
 * samples at the context's own rate and posts fixed-size frames back to the
 * main thread. Resampling and PCM conversion happen there (pcm.ts), where
 * they are pure, testable functions rather than untestable code inside a
 * worklet string.
 */

/** Frame size in samples at the capture context's rate. ~85ms at 48kHz: small enough to keep latency conversational, large enough to avoid flooding the message port. */
export const CAPTURE_FRAME_SAMPLES = 4096

export const CAPTURE_WORKLET_NAME = 'ishaara-voice-capture'

export const CAPTURE_WORKLET_SOURCE = `
class VoiceCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super()
    this.frameSize = (options && options.processorOptions && options.processorOptions.frameSize) || ${CAPTURE_FRAME_SAMPLES}
    this.buffer = new Float32Array(this.frameSize)
    this.offset = 0
  }

  process(inputs) {
    const input = inputs[0]
    // No input connected (device unplugged mid-session, or the graph is
    // being torn down) — keep the processor alive rather than ending it,
    // so a reconnecting device resumes without rebuilding the graph.
    if (!input || input.length === 0) return true
    const channel = input[0]
    if (!channel) return true

    for (let i = 0; i < channel.length; i++) {
      this.buffer[this.offset++] = channel[i]
      if (this.offset === this.frameSize) {
        // Transfer a copy: the underlying buffer is reused for the next
        // frame, so posting it directly would hand the main thread memory
        // that is about to be overwritten.
        const frame = this.buffer.slice(0)
        this.port.postMessage(frame, [frame.buffer])
        this.offset = 0
      }
    }
    return true
  }
}

registerProcessor('${CAPTURE_WORKLET_NAME}', VoiceCaptureProcessor)
`

/** Builds the Blob URL for addModule(). The caller owns revoking it — see MicrophoneCapture.stop(). */
export function createCaptureWorkletUrl(): string {
  return URL.createObjectURL(new Blob([CAPTURE_WORKLET_SOURCE], { type: 'application/javascript' }))
}
