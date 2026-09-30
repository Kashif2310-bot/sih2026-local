// Manual smoke test for the real Gemini Live path, without a browser or microphone:
// token from the Supabase function -> Constrained WebSocket -> the app's own setup message
// (system instruction, advisor tools, female voice) -> scripted text turns -> tool calls answered
// by the app's real advisor tools on one advisor state -> reports audio, transcripts and the
// ranking after each turn.
// Usage: node scripts/voice-assistant-live-probe.mjs ["sentence" ...] [--kn]   (reads .env.local; Node 22+)
import { readFileSync } from 'node:fs'
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
const turns = args.filter((a) => !a.startsWith('--'))
if (turns.length === 0) {
  turns.push(
    'I am 26 years old and I live in Kerala.',
    'I want to start a small dairy business.',
    'My family income is 2.5 lakh per year.',
    'What scheme matches me best right now?',
  )
}

const tokenResponse = await fetch(`${env.VITE_SUPABASE_URL}/functions/v1/gemini-live-token`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${env.VITE_SUPABASE_ANON_KEY}`,
    apikey: env.VITE_SUPABASE_ANON_KEY,
    'Content-Type': 'application/json',
  },
  body: '{}',
})
console.log('token status', tokenResponse.status)
const { token } = await tokenResponse.json()
if (!token) process.exit(1)

let state = advisor.INITIAL_ADVISOR_STATE
let turn = 0
let audioBytes = 0
let transcript = ''
const started = Date.now()

const socket = new WebSocket(protocol.buildLiveUrl(token))
socket.binaryType = 'arraybuffer'
const done = setTimeout(() => {
  console.log('timeout')
  socket.close()
}, 30000 * turns.length)
const send = (message) => socket.send(JSON.stringify(message))

function ranking() {
  const view = advisor.deriveAdvisorView(state)
  return view.matches
    .slice(0, 3)
    .map((m) => `${m.shortName} ${m.matchPercent}%`)
    .join(' | ')
}

function nextTurn() {
  const text = turns[turn]
  console.log(`\nuser: ${text}`)
  // Typed text takes the same path in the app: ingest, then send.
  state = advisor.ingestUtterance(state, text).state
  send(protocol.buildTextMessage(text))
}

socket.onopen = () => {
  const setup = protocol.buildSetupMessage({
    systemInstruction: instruction.buildSystemInstruction(kannada ? 'kn' : 'en'),
    tools: tools.ADVISOR_TOOL_DECLARATIONS,
    languageCode: kannada ? protocol.LANGUAGE_CODES.kn : undefined,
  })
  console.log('voice', setup.setup.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName)
  send(setup)
}

socket.onmessage = (event) => {
  const text = typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data)
  for (const serverEvent of protocol.parseServerMessage(text)) {
    switch (serverEvent.type) {
      case 'setupComplete':
        console.log('setupComplete after', Date.now() - started, 'ms')
        nextTurn()
        break
      case 'audio':
        audioBytes += serverEvent.data.byteLength
        break
      case 'outputTranscript':
        transcript += serverEvent.text
        break
      case 'toolCall': {
        const responses = serverEvent.calls.map((call) => {
          const result = tools.runAdvisorTool(state, call)
          state = result.state
          console.log('tool:', call.name, JSON.stringify(call.args), '->', JSON.stringify(result.outcome).slice(0, 220))
          return { id: call.id, name: call.name, response: result.outcome }
        })
        send(protocol.buildToolResponseMessage(responses))
        break
      }
      case 'turnComplete':
        if (audioBytes === 0) break
        console.log(`assistant (${(audioBytes / 2 / 24000).toFixed(1)} s audio): ${transcript.trim()}`)
        console.log('ranking now:', ranking())
        audioBytes = 0
        transcript = ''
        turn++
        if (turn < turns.length) nextTurn()
        else {
          clearTimeout(done)
          socket.close(1000)
        }
        break
      case 'error':
        console.log('server error:', serverEvent.message)
        break
    }
  }
}

socket.onclose = (event) => console.log('closed', event.code, event.reason)
