// Manual smoke test for the spoken path, without a browser: streams 16 kHz mono PCM16 WAVs to
// Gemini Live in real time (as the microphone worklet does), one utterance per reply, and answers
// tool calls with the app's real AdvisorSession, logging every server event so a turn that never
// ends, never gets a reply, or closes the connection is visible.
// Usage: node scripts/voice-assistant-live-audio-probe.mjs <a.wav> [b.wav ...] [options]   (reads .env.local; Node 22+)
//   --bare     sends a setup with no system instruction or tools, to separate app setup from audio
//   --kn       Kannada setup
//   --lead=ms  streams that much silence before the first utterance, as a microphone does
//   --chunk=n  samples per message (default 640; the browser worklet sends 682 from a 48 kHz device)
//   --noise=n  mixes steady background noise of RMS n (PCM16 units; speech peaks near 5000)
//   --stream-end=ms    sends audioStreamEnd that long after each utterance, as the runtime's fallback does
//   --vad-silence=ms   overrides the server's end-of-speech silence, to simulate a turn it never ends
//   --dummy-tools      answers every tool call with { ok: true } instead of the real advisor tools
//   --feasibility      runs the real LokScore feasibility report (network), as the live app does
//   --model=name       overrides the Live model, e.g. --model=models/gemini-3.8-live
//   --prefill="a|b"    records those sentences first and starts with them ALREADY ON FILE, as a reconnect does
// A turn that does not end in .wav is sent as typed text, e.g. "Apply for PMEGP".
import { readFileSync } from 'node:fs'
import { createServer } from 'vite'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((line) => /^[A-Z_]+=/.test(line))
    .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1).trim()]),
)

const args = process.argv.slice(2)
const wavPaths = args.filter((a) => !a.startsWith('--'))
if (wavPaths.length === 0) {
  console.log('usage: node scripts/voice-assistant-live-audio-probe.mjs <a.wav> [b.wav ...] [options]')
  process.exit(1)
}
const flag = (name) => args.includes(`--${name}`)
const option = (name, fallback) => {
  const arg = args.find((a) => a.startsWith(`--${name}=`))
  return arg ? Number(arg.slice(name.length + 3)) : fallback
}
const bare = flag('bare')
const kannada = flag('kn')
const dummyTools = flag('dummy-tools')
const CHUNK_SAMPLES = option('chunk', 640)
const CHUNK = CHUNK_SAMPLES * 2
const CHUNK_MS = (CHUNK_SAMPLES / 16000) * 1000
const NOISE_RMS = option('noise', 0)
const STREAM_END_MS = option('stream-end', -1)
const VAD_SILENCE_MS = option('vad-silence', null)
const LEAD_MS = option('lead', 0)
const MODEL = args.find((a) => a.startsWith('--model='))?.slice('--model='.length)
const PREFILL = (args.find((a) => a.startsWith('--prefill='))?.slice('--prefill='.length) ?? '').split('|').filter(Boolean)
const FINAL_SILENCE_MS = 8000
const NEXT_UTTERANCE_AFTER_REPLY_MS = 1500
const REPLY_TIMEOUT_MS = 20000

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
const protocol = await vite.ssrLoadModule('/src/voiceAssistant/assistant/live/geminiProtocol.ts')
const tools = await vite.ssrLoadModule('/src/voiceAssistant/assistant/advisor/advisorTools.ts')
const instruction = await vite.ssrLoadModule('/src/voiceAssistant/assistant/advisor/systemInstruction.ts')
const { AdvisorSession, LIVE_FEASIBILITY } = await vite.ssrLoadModule('/src/voiceAssistant/assistant/advisor/advisorSession.ts')
const { profileFacts } = await vite.ssrLoadModule('/src/voiceAssistant/assistant/advisor/format.ts')
await vite.close()

const advisor = new AdvisorSession(() => undefined, {
  store: null,
  computeFeasibility: flag('feasibility') ? LIVE_FEASIBILITY : null,
  feasibilityDebounceMs: 0,
})
PREFILL.forEach((text) => advisor.ingest(text))
const onFile = () => {
  const { profile, details, documents } = advisor.getState()
  return profileFacts(profile, details, documents)
}
// A turn ending in .wav is spoken; anything else is sent as typed text, as the app's text box does.
const utterances = wavPaths.map((path) => {
  if (!path.toLowerCase().endsWith('.wav')) return { text: path }
  const wav = readFileSync(path)
  return { pcm: wav.subarray(wav.indexOf('data') + 8) }
})

const tokenResponse = await fetch(`${env.VITE_SUPABASE_URL}/functions/v1/gemini-live-token`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${env.VITE_SUPABASE_ANON_KEY}`,
    apikey: env.VITE_SUPABASE_ANON_KEY,
    'Content-Type': 'application/json',
  },
  body: '{}',
})
const { token } = await tokenResponse.json()
if (!token) process.exit(1)

const started = Date.now()
const t = () => ((Date.now() - started) / 1000).toFixed(2)
const socket = new WebSocket(protocol.buildLiveUrl(token))
socket.binaryType = 'arraybuffer'
const send = (message) => socket.send(JSON.stringify(message))

// Streaming state: lead silence, then each utterance followed by silence until its reply is done.
let index = -1
let offset = 0
let leadSent = 0
let finalSilence = 0
let streamPaused = false
let waitingForReply = false
let replyAudio = 0
let userTurn = ''
let replyTimer = null

function nextUtterance() {
  clearTimeout(replyTimer)
  index++
  offset = 0
  streamPaused = false
  waitingForReply = false
  userTurn = ''
  if (index < utterances.length) console.log(`\n${t()} --- utterance ${index + 1}: ${wavPaths[index]}`)
}

function stream() {
  nextUtterance()
  const timer = setInterval(() => {
    if (socket.readyState !== WebSocket.OPEN) return clearInterval(timer)
    let chunk = Buffer.alloc(CHUNK)
    if (leadSent < LEAD_MS) {
      leadSent += CHUNK_MS
    } else if (index < utterances.length && !waitingForReply) {
      const { pcm, text } = utterances[index]
      if (text !== undefined) {
        advisor.ingest(text)
        send(protocol.buildTextMessage(text))
      } else {
        chunk = pcm.subarray(offset, offset + CHUNK)
        offset += CHUNK
      }
      if (text !== undefined || offset >= pcm.length) {
        console.log(t(), text !== undefined ? `typed: ${text}` : 'speech sent')
        waitingForReply = true
        replyAudio = 0
        replyTimer = setTimeout(() => {
          console.log(t(), `NO REPLY within ${REPLY_TIMEOUT_MS / 1000} s`)
          nextUtterance()
        }, REPLY_TIMEOUT_MS)
        if (STREAM_END_MS >= 0) {
          setTimeout(() => {
            if (!waitingForReply || replyAudio > 0) return
            console.log(t(), 'sending audioStreamEnd, then holding audio')
            send(protocol.buildAudioStreamEndMessage())
            streamPaused = true
          }, STREAM_END_MS)
        }
      }
    } else if (index >= utterances.length) {
      finalSilence += CHUNK_MS
      if (finalSilence > FINAL_SILENCE_MS) {
        clearInterval(timer)
        console.log(t(), 'done, closing')
        socket.close(1000)
        return
      }
    }
    if (!streamPaused) send(protocol.buildAudioMessage(withNoise(chunk).toString('base64')))
  }, CHUNK_MS)
}

/** Adds steady background noise (as from a fan or street) at the given RMS, in PCM16 units. */
function withNoise(chunk) {
  const out = Buffer.from(chunk)
  if (NOISE_RMS <= 0) return out
  for (let i = 0; i + 1 < out.length; i += 2) {
    const noise = (Math.random() * 2 - 1) * NOISE_RMS * Math.sqrt(3)
    out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(out.readInt16LE(i) + noise))), i)
  }
  return out
}

socket.onopen = () => {
  const setup = protocol.buildSetupMessage({
    systemInstruction: bare ? 'You are a helpful assistant.' : instruction.buildSystemInstruction(kannada ? 'kn' : 'en', onFile()),
    tools: bare ? [] : tools.ADVISOR_TOOL_DECLARATIONS,
    languageCode: kannada ? protocol.LANGUAGE_CODES.kn : undefined,
    ...(MODEL ? { model: MODEL } : {}),
  })
  if (PREFILL.length > 0) console.log(t(), `on file: ${onFile().map((fact) => `${fact.label}=${fact.value}`).join(', ')}`)
  if (VAD_SILENCE_MS !== null) {
    setup.setup.realtimeInputConfig.automaticActivityDetection.silenceDurationMs = VAD_SILENCE_MS
  }
  send(setup)
}

let transcript = ''
socket.onmessage = (event) => {
  const text = typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data)
  const raw = JSON.parse(text)
  if (raw.voiceActivity) console.log(t(), 'voiceActivity', raw.voiceActivity.type)
  if (raw.serverContent?.generationComplete && waitingForReply) {
    console.log(t(), `assistant: ${transcript.trim()}`)
    transcript = ''
    setTimeout(nextUtterance, NEXT_UTTERANCE_AFTER_REPLY_MS)
  }
  for (const serverEvent of protocol.parseServerMessage(text)) {
    switch (serverEvent.type) {
      case 'setupComplete':
        console.log(t(), 'setupComplete')
        stream()
        break
      case 'audio':
        if (replyAudio++ === 0) console.log(t(), 'first reply audio')
        streamPaused = false
        break
      case 'inputTranscript':
        userTurn += serverEvent.text
        advisor.ingest(userTurn)
        console.log(t(), 'IN :', JSON.stringify(serverEvent.text))
        break
      case 'outputTranscript':
        transcript += serverEvent.text
        break
      case 'toolCall': {
        const responses = serverEvent.calls.map((call) => {
          const response = dummyTools ? { ok: true } : advisor.runTool(call)
          const size = JSON.stringify(response).length
          console.log(t(), `tool ${call.name} ${JSON.stringify(call.args).slice(0, 120)} -> ${size} chars`)
          return { id: call.id, name: call.name, response }
        })
        send(protocol.buildToolResponseMessage(responses))
        break
      }
      default:
        console.log(t(), serverEvent.type, 'message' in serverEvent ? serverEvent.message : '')
    }
  }
}

socket.onclose = (event) => {
  clearTimeout(replyTimer)
  console.log(t(), 'closed', event.code, event.reason)
  process.exit(0)
}
