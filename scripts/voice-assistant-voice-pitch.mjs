// Measures the real pitch of Gemini Live prebuilt voices through the app's own setup message.
// For each voice: token -> Constrained WebSocket -> setup (system instruction, tools, speechConfig)
// -> one text turn (tool calls answered by the app's real advisor tools) -> 24 kHz PCM -> median F0.
// Writes a WAV per voice to %TEMP%/ishaara-voice for listening.
// Usage: node scripts/voice-assistant-voice-pitch.mjs [voice ...] [--kn]   (reads .env.local; Node 22+)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'vite'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((line) => /^[A-Z_]+=/.test(line))
    .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1).trim()]),
)

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
const protocol = await vite.ssrLoadModule('/src/voiceAssistant/assistant/live/geminiProtocol.ts')
const tools = await vite.ssrLoadModule('/src/voiceAssistant/assistant/advisor/advisorTools.ts')
const instruction = await vite.ssrLoadModule('/src/voiceAssistant/assistant/advisor/systemInstruction.ts')
const advisor = await vite.ssrLoadModule('/src/voiceAssistant/assistant/advisor/advisor.ts')
await vite.close()

const args = process.argv.slice(2)
const kannada = args.includes('--kn')
const voices = args.filter((a) => !a.startsWith('--'))
if (voices.length === 0) voices.push(protocol.ISHAARA_VOICE_NAME)

const outDir = join(tmpdir(), 'ishaara-voice')
mkdirSync(outDir, { recursive: true })

const RATE = 24000

function pitchStats(samples) {
  const frame = 1024
  const hop = 240
  const minLag = Math.floor(RATE / 400)
  const maxLag = Math.ceil(RATE / 70)
  const f0s = []
  for (let start = 0; start + frame + maxLag < samples.length; start += hop) {
    let energy = 0
    for (let i = 0; i < frame; i++) energy += samples[start + i] ** 2
    if (Math.sqrt(energy / frame) < 0.02) continue
    const corr = new Float64Array(maxLag + 1)
    let best = 0
    let bestLag = 0
    for (let lag = minLag; lag <= maxLag; lag++) {
      let num = 0
      let e1 = 0
      let e2 = 0
      for (let i = 0; i < frame; i++) {
        const a = samples[start + i]
        const b = samples[start + i + lag]
        num += a * b
        e1 += a * a
        e2 += b * b
      }
      corr[lag] = num / Math.sqrt(e1 * e2 + 1e-12)
      if (corr[lag] > best) {
        best = corr[lag]
        bestLag = lag
      }
    }
    if (best < 0.6) continue
    // Prefer the shortest lag with a near-maximal peak, which avoids octave-down errors.
    for (const divisor of [4, 3, 2]) {
      const candidate = Math.round(bestLag / divisor)
      if (candidate >= minLag && corr[candidate] > 0.85 * best) {
        bestLag = candidate
        break
      }
    }
    f0s.push(RATE / bestLag)
  }
  f0s.sort((a, b) => a - b)
  const q = (p) => f0s[Math.min(f0s.length - 1, Math.floor(p * f0s.length))]
  return { frames: f0s.length, median: q(0.5), p10: q(0.1), p90: q(0.9) }
}

function wav(pcm) {
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVEfmt ', 8)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(RATE, 24)
  header.writeUInt32LE(RATE * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}

async function mintToken() {
  const response = await fetch(`${env.VITE_SUPABASE_URL}/functions/v1/gemini-live-token`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.VITE_SUPABASE_ANON_KEY}`,
      apikey: env.VITE_SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: '{}',
  })
  const { token } = await response.json()
  if (!token) throw new Error(`token status ${response.status}`)
  return token
}

function measure(voiceName, token) {
  const userText = kannada
    ? 'ನಮಸ್ಕಾರ, ನೀವು ಯಾರು ಮತ್ತು ನನಗೆ ಹೇಗೆ ಸಹಾಯ ಮಾಡಬಹುದು?'
    : 'Hello. Please introduce yourself in two sentences and tell me how you can help me.'
  return new Promise((resolve) => {
    const socket = new WebSocket(protocol.buildLiveUrl(token))
    socket.binaryType = 'arraybuffer'
    const chunks = []
    let transcript = ''
    let state = advisor.INITIAL_ADVISOR_STATE
    const finish = (result) => {
      clearTimeout(timer)
      try {
        socket.close(1000)
      } catch {}
      resolve(result)
    }
    const timer = setTimeout(() => finish({ error: 'timeout' }), 40000)
    const send = (m) => socket.send(JSON.stringify(m))
    socket.onopen = () =>
      send(
        protocol.buildSetupMessage({
          systemInstruction: instruction.buildSystemInstruction(kannada ? 'kn' : 'en'),
          tools: tools.ADVISOR_TOOL_DECLARATIONS,
          voiceName,
          languageCode: kannada ? protocol.LANGUAGE_CODES.kn : undefined,
        }),
      )
    socket.onmessage = async (event) => {
      const text = typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data)
      for (const e of protocol.parseServerMessage(text)) {
        if (e.type === 'setupComplete') send(protocol.buildTextMessage(userText))
        else if (e.type === 'audio') chunks.push(Buffer.from(e.data))
        else if (e.type === 'outputTranscript') transcript += e.text
        else if (e.type === 'toolCall') {
          const responses = e.calls.map((call) => {
            const result = tools.runAdvisorTool(state, call)
            state = result.state
            return { id: call.id, name: call.name, response: result.outcome }
          })
          send(protocol.buildToolResponseMessage(responses))
        } else if (e.type === 'turnComplete' && chunks.length > 0) {
          const pcm = Buffer.concat(chunks)
          const samples = new Float32Array(pcm.length / 2)
          for (let i = 0; i < samples.length; i++) samples[i] = pcm.readInt16LE(i * 2) / 32768
          const file = join(outDir, `${voiceName}${kannada ? '-kn' : ''}.wav`)
          writeFileSync(file, wav(pcm))
          finish({ seconds: samples.length / RATE, ...pitchStats(samples), transcript: transcript.trim(), file })
        } else if (e.type === 'error') finish({ error: e.message })
      }
    }
    socket.onclose = (event) => finish({ error: `closed ${event.code} ${event.reason}` })
  })
}

for (const voice of voices) {
  const result = await measure(voice, await mintToken())
  if (result.error) {
    console.log(`${voice.padEnd(14)} ERROR ${result.error}`)
    continue
  }
  const band = result.median >= 165 ? 'female range' : result.median <= 155 ? 'male range' : 'ambiguous'
  console.log(
    `${voice.padEnd(14)} median F0 ${result.median.toFixed(0)} Hz (p10 ${result.p10.toFixed(0)}, p90 ${result.p90.toFixed(0)}, ${result.frames} voiced frames, ${result.seconds.toFixed(1)} s) -> ${band}`,
  )
  console.log(`${''.padEnd(14)} "${result.transcript.slice(0, 160)}"`)
}
console.log('wav files:', outDir)
