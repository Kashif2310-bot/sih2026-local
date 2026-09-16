# VoiceSession — voice-first conversation architecture

**Location:** [`src/assistant/voice/`](../src/assistant/voice/) (`types.ts`, `offlineVoiceSession.ts`, `geminiLiveVoiceSession.ts`, `geminiLiveTransport.ts`, `geminiLiveProtocol.ts`, `geminiLiveConfig.ts`, `index.ts`, `testing/fakeGeminiLiveTransport.ts`)
**Status:** foundation implemented 2026-09-15; real Gemini Live adapter added 2026-09-15; `replySource: 'external'`/`deliverAssistantReply()` added 2026-09-15 to support [`VoiceConversationRuntime`](./voice-conversation-runtime.md). Both `OfflineVoiceSession` and `GeminiLiveVoiceSession` are real, working `VoiceSession` implementations. **No Gemini backend (relay/proxy or token-minting endpoint) is deployed anywhere** — `GEMINI_LIVE_PROXY_URL` ships unset, so `geminiLiveVoiceSessionFactory.isSupported()` correctly resolves `false` today and no live connection has ever actually been attempted against Google's servers. See "What is genuinely live vs. test-only" below.

## Why a separate abstraction from AIProvider

[`AIProvider`](../src/assistant/ai/types.ts) (Ollama / hosted-proxy / offline) is request/response: one message in, one reply out, no connection state, tried in a fallback chain per turn. That's the right shape for the existing text chat and it is **untouched** by this work.

A real-time voice conversation is not that shape. Gemini Live (and any equivalent) is a **persistent, bidirectional, streaming session**: you open a connection once, stream microphone audio continuously, receive partial transcripts and partial model replies as they happen, and the citizen can interrupt the model mid-sentence. Forcing that into `generateReply(): Promise<ProviderReply>` would either lie about what's actually happening or slowly pressure `AIProvider` into becoming two incompatible things at once. So:

```
UI
 ↓
VoiceSession                 (src/assistant/voice/types.ts — provider-independent)
 ↓
Gemini Live adapter          (future — not implemented in this phase)
 ↓
streaming audio/transcription/events
```

The UI is written against `VoiceSession` only. No Gemini-specific WebSocket message shape, auth flow, or wire format appears above the (future) adapter boundary.

## The state machine

Ten states, one enum (`VoiceSessionStatus`), not a web of independent booleans that could disagree with each other:

```
idle → connecting → connected → listening ⇄ user_speaking → processing → model_speaking → listening
                                                                              │                  ↑
                                                                              └──→ interrupted ───┘
(any state) → error → (connect() again if recoverable) → connecting → ...
(any state) → closed   [terminal — a closed session is never reused; create a new one via the factory]
```

- **`idle`** — constructed, `connect()` not yet called.
- **`connecting` / `connected`** — handshake in progress, then established but not yet actively listening (a real provider may do warm-up here).
- **`listening`** — mic open, ready, no speech detected yet.
- **`user_speaking`** — voice (or typed) input is streaming in; partial transcripts flow.
- **`processing`** — the user's turn just finalized; waiting on the model.
- **`model_speaking`** — the model's reply (text/audio) is streaming out.
- **`interrupted`** — a barge-in just cut off `model_speaking`; transitional, resolves back to `listening` or straight into a new `user_speaking` turn.
- **`error`** — something failed. If the error is recoverable, the session stays alive and `connect()` may be called again to retry; if not, the session closes itself.
- **`closed`** — terminal. Resources released, session unusable.

## The event model

One discriminated union (`VoiceEvent`), delivered in order through `subscribe(listener): () => void` — not ten separate `onX` callback props. Every event carries `seq` (a monotonic per-session counter), `at` (ISO timestamp), and `sessionId`, so a consumer or a test can always tell ordering and origin apart — that's the "observability" requirement, satisfied structurally rather than via a bolted-on logging side-channel.

| Event | Purpose |
|---|---|
| `status` | Every state transition, with `previousStatus` |
| `user_transcript_partial` / `user_transcript_final` | Streaming and finalized citizen speech-to-text |
| `model_text_partial` / `model_text_final` | Streaming and finalized model reply text |
| `model_audio_chunk` / `model_audio_end` | Streaming model speech audio |
| `turn_started` / `turn_ended` | Turn lifecycle, tagged `role: 'user' \| 'model'` and (on end) `reason: 'completed' \| 'interrupted' \| 'error'` |
| `interrupted` | A barge-in happened — names which model turn got cut off and why (`user_barge_in` vs. `client_cancelled`) |
| `error` | Carries a typed `VoiceSessionError` plus `recoverable: boolean` |
| `diagnostic` | Free-form observability/logging hook, never used for control flow |

## Why `endUserTurn()` exists

Real streaming STT usually finalizes a user turn via server-side voice-activity detection (silence after speech) — the client never has to say "I'm done." But a provider without that (or a push-to-talk UI) needs an explicit signal. `endUserTurn()` is that optional signal: a Gemini Live adapter can ignore it and finalize on its own server-detected silence; the offline session relies on it because it has no real audio to analyze. `sendTextInput()` never needs it — a typed message is already a complete utterance.

## Interruption / barge-in, handled once, from two triggers

`interrupt()` is the single place a model turn gets cut off. It's triggered two ways:

1. **Explicit** — the host (e.g. a UI "stop" button) calls `session.interrupt()` directly. Emits `interrupted` with `reason: 'client_cancelled'`.
2. **Implicit (real barge-in)** — the host calls `sendAudioChunk()` / `sendTextInput()` / `endUserTurn()` while `status === 'model_speaking'`. The session automatically interrupts the in-flight model turn first (`reason: 'user_barge_in'`), then processes the new input as the start of a fresh user turn — exactly what happens when a citizen starts talking over the assistant.

Interruption is **interruption-safe** by construction: an in-flight model turn checks, after every asynchronous step, whether it has been superseded (`currentModelTurnId` reassigned/nulled) and bails out immediately if so — so an interrupted turn can never emit a stray event after the cut, and `model_audio_end` never fires for a turn that was actually cut off. See the interruption tests in `offlineVoiceSession.test.ts` for the negative-case coverage (an interrupted turn emits nothing further, even after waiting past its next scheduled step).

## Language — no English-only assumption

`VoiceSessionLanguageConfig.primary` is `'en' | 'kn' | 'auto'`. `'auto'` is a first-class value, not an afterthought — it's how the contract expresses "let mixed Kannada-English happen," which the product requires. `allowCodeSwitching` is a separate hint a provider may use or ignore. Nothing in `VoiceSession`, `VoiceEvent`, or the offline implementation assumes English; `languageHint` on `VoiceUserTranscriptFinalEvent` just echoes back whatever the session was configured with.

## AI safety boundary (unchanged, extended to voice)

A `VoiceSession` implementation is a **transport/conversation-turn layer only**. It must never itself: compute eligibility, compute LokScore, invent scheme facts or government information, make an approval decision, or play back a reply that hasn't passed [`responseGuard.validateProviderReply`](../src/assistant/ai/responseGuard.ts). `OfflineVoiceSession` respects this by construction — it never claims to know a scheme fact; its only "reply" is an unmistakably labeled scripted sentence (see below).

## Controller-authored replies (`replySource: 'external'` / `deliverAssistantReply()`)

**Added when [`VoiceConversationRuntime`](../src/assistant/conversation/voiceConversationRuntime.ts) was built** — see [`docs/voice-conversation-runtime.md`](./voice-conversation-runtime.md) for the runtime itself. This section documents the resulting `VoiceSession` contract extension, which is what made the runtime's AI safety boundary actually enforceable at the transport layer.

**Why this exists:** a real Gemini Live session, left to its own devices, autonomously generates its own reply from the conversation history — that's the natural shape of a live conversational agent, and it's exactly what `replySource: 'provider'` (the default, unchanged from every prior phase) does. But LokPulse's AI safety boundary requires the *deterministic* [`VoiceAssistantController`](../src/assistant/conversation/voiceAssistantController.ts) — not the voice provider — to be the sole source of truth for what gets said, since only the controller's pipeline runs extraction, ranking, and `responseGuard` validation. Reusing `sendTextInput()` to hand the controller's reply back to the session was considered and rejected: that method is unambiguously a **user** turn (it drives `user_speaking → processing`, and both existing implementations would treat the controller's own words as if the citizen had spoken them — corrupting the turn/role model and re-triggering another round of extraction on the assistant's own sentence).

**The mechanism**, added to `VoiceSessionConfig`/`VoiceSession` (`types.ts`):
- `replySource?: 'provider' | 'external'` — set once, at construction. Omitted (or `'provider'`) preserves every prior phase's autonomous-reply behavior exactly, byte-for-byte; this is a purely additive, backward-compatible extension, verified by re-running all pre-existing offline (28) and Gemini (37) tests unchanged after adding it.
- `deliverAssistantReply(text: string): void` — when `replySource: 'external'`, a user turn finalizes into `status: 'processing'` and then **waits** (no autonomous reply is generated) until the host calls this with the controller's already-guarded `replyText`. It then emits the exact same `turn_started(model) → model_text_final → model_audio_end → turn_ended → listening` sequence an autonomous reply would — a subscriber never needs to know which path produced it, including being subject to the identical interruption/barge-in handling (`currentModelTurnId`-based staleness checks apply uniformly to both).

**Per-provider realization:**
- `OfflineVoiceSession` — registers its "waiting for a reply" promise **synchronously, with no artificial pre-delay**, the instant a user turn finalizes (in the same synchronous burst as the `user_transcript_final` emission) — this was a real, since-fixed timing bug: an earlier version kept the autonomous path's pre-reply `sleep()` for the external path too, which was fast enough that a quick-resolving controller call could call `deliverAssistantReply()` before the session had even registered its resolver. Once delivered, the reply streams out word-by-word exactly like an autonomous one (still genuinely interruptible mid-stream).
- `GeminiLiveVoiceSession` — suppresses translating the server's own autonomous `serverContent` into `model_text`/`model_audio` events entirely (the citizen's own speech transcription still flows through normally); `deliverAssistantReply()` emits the controller's text as `model_text_final` synchronously and atomically. **Honest limitation:** no `model_audio_chunk` is ever emitted for a controller-authored reply — this adapter has no protocol-verified mechanism to make Gemini Live speak arbitrary externally-supplied text as audio (see the Gemini adapter's own "Protocol grounding" section above). Audio synthesis of controller text is out of scope for this phase regardless (see "Remaining work" above) and would need either a verified `clientContent role:'model'` mechanism or a separate TTS integration.

## The offline/mock implementation

[`OfflineVoiceSession`](../src/assistant/voice/offlineVoiceSession.ts) plays the same role for voice that [`offlineProvider.ts`](../src/assistant/ai/offlineProvider.ts) already plays for text: a fully working, always-available implementation requiring **no API key, no microphone, and no network**, so the rest of the app — and other developers — can build and test against a real `VoiceSession` today.

**Offline session honesty rules** (this is load-bearing, not decoration):
- Every scripted reply is prefixed `[OFFLINE VOICE SESSION — simulation]` and states plainly that no real AI model or government data was used.
- Every simulated audio chunk carries `format: 'mock'` — a real value in the `VoiceAudioFormat` type, not a magic string a consumer has to guess at — so nothing downstream can mistake it for real PCM/Opus audio.
- It never invents scheme facts, eligibility results, or government information of any kind.

**What it simulates, genuinely asynchronously** (small real timer delays between steps — this is closer to a real network's timing than a synchronous fake, on purpose): the full documented turn sequence — `user_speaking` (word-by-word partial transcripts) → `user_transcript_final` → `processing` → `model_speaking` (partial reply text → final text → two mock audio chunks → audio end) → back to `listening`. It also supports push-to-talk audio input (`sendAudioChunk` + `endUserTurn`, producing a transcript that honestly says how many bytes were "captured" — never a fabricated sentence), full interruption/barge-in (both triggers above), a `simulateError(error, recoverable)` test-only method for exercising the error/reconnect path without a real network to fail, and clean resource disposal (`close()` clears every pending timer and listener, is idempotent, and is safe mid-turn).

Configurable via `OfflineVoiceSessionOptions`: `stepDelayMs` (timing), `replyFor` (inject a custom scripted reply function — useful for tests or for a demo script), `idGenerator` (deterministic ids in tests).

```ts
import { createOfflineVoiceSession } from 'src/assistant/voice'

const session = createOfflineVoiceSession({ language: { primary: 'auto', allowCodeSwitching: true } })
const unsubscribe = session.subscribe((event) => { /* ... */ })
await session.connect()
session.sendTextInput('I want to start a dairy business')
```

## The Gemini Live adapter

`GeminiLiveVoiceSession` (`geminiLiveVoiceSession.ts`) implements `VoiceSession` exactly — same `connect`/`close`/`sendAudioChunk`/`endUserTurn`/`sendTextInput`/`interrupt`/`updateContext`/`subscribe` surface as `OfflineVoiceSession`, so the UI needs zero changes to switch providers. It's split into three layers, each independently testable:

```
geminiLiveVoiceSession.ts   — the VoiceSession adapter: turn/event bookkeeping, interruption logic
        ↓ depends on
geminiLiveTransport.ts      — GeminiLiveTransport interface + WebSocketGeminiLiveTransport (the real one)
        ↓ depends on
geminiLiveProtocol.ts       — pure message types + builders/parser (no networking, no state)
```

Nothing about Gemini's message shapes, connection details, or auth model is visible above `geminiLiveVoiceSession.ts` — a caller holding a `VoiceSession` reference (typed via `types.ts` only) cannot tell whether it's talking to Gemini or the offline mock.

### Protocol grounding (verified, not assumed)

The message shapes in `geminiLiveProtocol.ts` — `setup`/`clientContent`/`realtimeInput` (client→server) and `serverContent`/`setupComplete`/`error` (server→client) — were fetched directly from Google's current Live API reference and get-started guide while building this (2026-09-15), not recalled from training data. Confirmed directly from those pages:

- Input audio: raw 16-bit PCM, mono, little-endian, sent as `audio/pcm;rate=16000` inside `realtimeInput.audio`.
- Output audio: raw 16-bit PCM, mono, little-endian, **24kHz**, delivered base64-encoded inside `serverContent.modelTurn.parts[].inlineData`.
- `serverContent.interrupted: boolean` and `serverContent.turnComplete: boolean` are real, documented fields.
- Ephemeral tokens are Google's own recommended auth pattern for client-side/browser connections (see "Authentication boundary" below).

**Not independently verified** (best-effort, clearly marked in code comments): the exact runtime behavior of `interimInputTranscription`/`outputTranscription` streaming semantics (whether they arrive as incremental deltas or complete-each-time — this adapter assumes incremental, accumulating into a running buffer), and whether the server always sends an explicit `interrupted`/`turnComplete` boundary in response to a client-side barge-in (this adapter has a bounded fallback for exactly this uncertainty — see "Interruption flow" below). **Verify both against a real connection before trusting this adapter in production.**

### Authentication boundary

**No long-lived Gemini API key exists anywhere in this codebase, in a browser-reachable location, or in this phase's design.** `geminiLiveConfig.ts` is the single security-reviewed boundary; read its header comment before changing it. Two backend patterns are supported by the adapter's design (which one gets built is not decided here — see "Remaining work" below):

1. **Relay/proxy** — the browser opens a WebSocket to a developer-run backend, which holds the real key server-side and relays frames to Google's real endpoint. `GEMINI_LIVE_PROXY_URL` (from `VITE_GEMINI_LIVE_PROXY_URL`) is this pattern's config slot — an endpoint URL, not a secret, exactly like `VITE_SUPABASE_URL`.
2. **Ephemeral token** (Google's own documented recommendation for browser clients) — the browser calls a trusted backend over HTTPS to mint a short-lived token, then connects *directly* to Google's own endpoint (`GEMINI_LIVE_WEBSOCKET_ENDPOINT` in `geminiLiveProtocol.ts`) using it.

The adapter doesn't hardcode either — `GeminiLiveConnectionResolver` (`geminiLiveTransport.ts`) is an injected async function that produces `{ url, protocols? }` at connect() time; `defaultGeminiLiveConnectionResolver` (pattern 1's default) just returns the configured static proxy URL, and a project wiring up pattern 2 instead supplies its own resolver that calls a token-minting endpoint first. **This repo ships neither backend piece** — `GEMINI_LIVE_PROXY_URL` is unset by default, mirroring `aiConfig.ts`'s `HOSTED_PROXY_URL` exactly: no crash, no fake "connected" state, `isSupported()` correctly reports `false`.

### Transport abstraction

`GeminiLiveTransport` (`geminiLiveTransport.ts`) is the seam that makes this testable without a network: `connect`/`send`/`close`/`onMessage`/`onError`/`onClose`, operating on already-typed `GeminiLiveClientMessage`/`GeminiLiveServerMessage` objects (JSON (de)serialization is the transport's job, not the adapter's). `WebSocketGeminiLiveTransport` is the real implementation — a native browser `WebSocket` carrying Gemini's JSON text-frame protocol; it validates every incoming message through `parseServerMessage` (same "drop what can't be validated, never guess" discipline as `liveRetrieval.ts`'s `validateLiveEvidenceItems`) and silently ignores anything unrecognized rather than treating forward-incompatibility as an error.

### Audio format boundary

`sendAudioChunk()` **validates, never silently resamples**: it throws immediately if a chunk's `format !== 'pcm16'` or its declared `sampleRateHz !== 16000`. Turning arbitrary browser microphone audio (which is neither 16-bit PCM nor 16kHz by default) into a conforming `VoiceAudioChunk` is explicitly the **future voice UI/audio-capture layer's job**, not this adapter's — see "Remaining work" below. Output audio arrives from the server already correctly tagged (`format: 'pcm16'`, `sampleRateHz: 24000`) on every `model_audio_chunk` event; **playing it back is also future work** — this phase only translates Gemini's audio into `VoiceAudioChunk`s on the event stream, nothing here touches a speaker.

### Transcription flow

Two genuinely different paths, both server-honest (this adapter never fabricates a transcript):

- **Audio input** — `sendAudioChunk()` forwards raw audio to Gemini via `realtimeInput.audio`; it does **not** emit a transcript itself. `endUserTurn()` sends `realtimeInput.audioStreamEnd` and locally ends the turn/moves to `processing` — but the actual `user_transcript_partial`/`user_transcript_final` events only appear later, driven by the server's own `interimInputTranscription`/`inputTranscription` messages, correlated back to the right turn via a `lastUserTurnId` field that (unlike `currentUserTurnId`) survives past the turn's local "end" specifically so a late-arriving transcript can still be attributed correctly.
- **Text input** — `sendTextInput()` emits `user_transcript_final` **immediately and locally** — what the citizen typed already *is* the final transcript, verbatim; no server round trip is needed or requested.

Model output text is sourced from **either** `modelTurn.parts[].text` **or** `serverContent.outputTranscription` (this session's `setup` message requests `AUDIO` response modality, which per the protocol means the reply's *text* form — if any — arrives via `outputTranscription`, not `parts[].text`; the adapter accumulates from whichever channel is present, robust to either configuration).

### Interruption flow

The most carefully-designed part of this adapter — see the extended comment on `beginInterruption()` in `geminiLiveVoiceSession.ts`. Two triggers, one path, exactly mirroring `OfflineVoiceSession`'s semantics:

1. **Explicit** — `interrupt()` called directly.
2. **Barge-in** — `sendAudioChunk`/`sendTextInput`/`endUserTurn` called while `status === 'model_speaking'`.

Both call `beginInterruption()`, which is **locally optimistic**: it stops this adapter from translating the interrupted turn's output *immediately*, synchronously, without waiting for Gemini's own confirmation — because "buffered model audio must not continue playing" is about what this layer hands upward to its caller, not about what happens inside Google's servers. A `suppressServerContentUntilBoundary` flag then swallows any trailing stale `serverContent` for the old (now-abandoned) turn — Gemini's protocol has **no per-message turn id**, so this adapter can't distinguish "old turn's tail" from "new turn's start" by content alone; it watches for the old turn's own boundary signal (`interrupted: true` or `turnComplete: true`) to know when it's safe to stop suppressing. Because the reference this was built against documents no explicit client "cancel generation" message, there's also a bounded fallback (`GEMINI_LIVE_INTERRUPT_SETTLE_TIMEOUT_MS`, 1.5s default, injectable for tests) that clears suppression unconditionally if the server never confirms — **this bound is a defensive design choice, not a documented protocol guarantee; tune it against real observed latency once tested live.**

No stale event can leak: every emission inside the model-turn-output branch is guarded by comparing against the *current* `currentModelTurnId`, which `beginInterruption()` nulls out synchronously the instant an interruption starts.

### Reconnect behavior

`connect()` is idempotent while already in any active state, throws if the session is `closed` (create a new one via the factory instead), and is safely re-callable after an `'error'` status — each call builds a **fresh** transport via `deps.createTransport()` (a WebSocket can't be reopened once closed/errored), tearing down and discarding whatever transport was there before (unsubscribing its listeners *before* closing it, so a stale transport's late close event never reaches a handler that's already moved on). A transport-level `'error'` event alone doesn't change status (a WebSocket `error` reliably precedes `close`, so the actual state transition happens in the close handler, keeping the state machine from forking down two paths for one failure). An unexpected close after a successful connection is reported as a `recoverable: true` `network_lost` error — the caller decides whether/when to retry `connect()`.

### Language handling

`languageCodeFor()` (`geminiLiveProtocol.ts`) maps the provider-independent `VoiceLanguage` onto Gemini's `speechConfig.languageCode`: `'en'` → `'en-US'`, `'kn'` → `'kn-IN'`, and **`'auto'` omits `languageCode` entirely** — the setup message simply doesn't include it, letting Gemini apply its own detection/code-switching handling rather than this adapter guessing a single language for what the product requires to be mixed Kannada-English. The Gemini-specific mapping lives entirely inside `geminiLiveProtocol.ts`; nothing above the adapter ever sees a Gemini language code, only the provider-independent `VoiceLanguage`/`VoiceSessionLanguageConfig` types already defined in `types.ts`.

### Context updates

`updateContext()` merges the given fields into the session's local context and emits a `diagnostic` event — it never tears down or reconnects the transport. One real, documented limitation: Gemini's `setup` message is sent once, at the start of the session, with no documented mid-session reconfiguration call — so an updated `ApplicantProfile` doesn't reach the model's *system-level* grounding immediately. It's available locally for the next turn the pipeline seam builds (see below), and the WebSocket connection itself is never torn down by calling this — which is what "without requiring the entire application to reconnect unnecessarily" actually required of this phase.

### Testing strategy — REAL vs. FAKE, never blurred

| | Real | Test-only |
|---|---|---|
| Transport | `WebSocketGeminiLiveTransport` — a genuine browser `WebSocket` | `FakeGeminiLiveTransport` (`testing/fakeGeminiLiveTransport.ts`) — **never imported outside `testing/`**, scripts server messages/errors/closes directly with no network |
| Protocol | `geminiLiveProtocol.ts`'s builders/parser — used by both | same (pure functions, no fakery needed) |
| What's tested | Nothing — no real Gemini connection has ever been attempted in this codebase | `geminiLiveVoiceSession.test.ts` (37 tests) verifies **this adapter's protocol translation**: given a scripted Gemini message, does the right `VoiceEvent` come out; given a `VoiceSession` call, does the right Gemini message go out. `geminiLiveProtocol.test.ts` (15 tests) verifies the pure builders/parser/base64 round-trip in isolation. |

`geminiLiveVoiceSession.test.ts` covers: full connect lifecycle (including that `status` only reaches `listening` after a scripted `setupComplete`), connection failure, a network drop during setup being distinguished from a normal unexpected close, reconnect after a recoverable error building a genuinely new transport, user transcript partial/final translation for both audio and text input, audio chunk base64 encoding and format/sample-rate validation, model text/audio/completion translation via both `modelTurn.parts` and `outputTranscription`, four interruption/barge-in scenarios including the suppression-window edge cases (server confirms → immediate recovery; server never confirms → bounded fallback recovery; a genuinely new turn's content isn't wrongly suppressed), close/cleanup (including that a stray post-close message is ignored), recoverable-vs-transient error handling, language configuration for all three `VoiceLanguage` values, `updateContext`, and — critically — that no API key/secret/token string ever appears in a sent message or connection target, and that `OfflineVoiceSession` remains fully unaffected.

### What is genuinely live vs. test-only

**Live (real code, would genuinely talk to Google if configured):** `geminiLiveProtocol.ts`'s message builders/parser, `WebSocketGeminiLiveTransport`, `GeminiLiveVoiceSession`'s entire turn/event/interruption logic, `geminiLiveConfig.ts`'s security boundary.
**Not live (this phase, by design):** no backend (relay/proxy or token-minting endpoint) is deployed; `GEMINI_LIVE_PROXY_URL` is unset; no real WebSocket to `generativelanguage.googleapis.com` has ever been opened by this code; no microphone capture or audio playback exists yet (see below).
**Test-only, never reachable from production code:** `FakeGeminiLiveTransport`.

### Remaining work before a voice UI can use this

1. **Backend decision** — pick relay/proxy vs. ephemeral-token (see "Authentication boundary"); build and deploy it; set `VITE_GEMINI_LIVE_PROXY_URL` (or supply a custom `GeminiLiveConnectionResolver` for the token pattern).
2. **Microphone capture + resampling** — browser mic audio is neither 16-bit PCM nor 16kHz by default; something must capture and resample it into conforming `VoiceAudioChunk`s before calling `sendAudioChunk()`. Not built in this phase.
3. **Audio playback** — `model_audio_chunk` events carry raw 24kHz PCM16; something must queue and play it (and stop immediately on `interrupted`). Not built in this phase.
4. **The pipeline seam** (below) — wiring a finalized transcript into the real deterministic pipeline instead of nothing.
5. **A real connection test** — everything above is protocol-grounded but unverified end-to-end; the first real connection should specifically confirm the transcription streaming semantics and interruption-confirmation timing noted as "not independently verified" above.

## The pipeline seam (not implemented yet)

`VoiceTurnPipelineHandler`, defined at the bottom of `types.ts`, fixes the *shape* of the function a future change will write to bridge one finalized voice turn into the **existing** deterministic text pipeline — so this phase's work can be built against a stable signature without implementing the pipeline itself yet:

```
audio → transcript (VoiceUserTranscriptFinalEvent)
      → profileExtraction.extractAndMerge(transcript, userProfile)         [reuse, unchanged]
      → withApplicantFields(...) into the caller's ApplicantProfile         [src/shared/applicantProfile.ts, reuse]
      → missingFields.identifyMissingFields(userProfile)                    [reuse, unchanged]
      → ranking.rankSchemes(...) (retrieval.ts + eligibility.ts underneath) [reuse, unchanged]
      → liveRetrieval's evidence-merge step, same as orchestrator.ts does   [reuse, unchanged]
      → ai/promptBuilder.buildUserTurn + a real AIProvider.generateReply    [reuse, unchanged]
      → ai/responseGuard.validateProviderReply — REQUIRED gate              [reuse, unchanged]
      → model voice output (model_text_final / model_audio_chunk events)
```

Nothing in this list is duplicated by the voice layer — every step is a call into a module that already exists and is already tested. The eventual implementation lives in the assistant module (e.g. a sibling to `orchestrator.ts`), **never** inside a `VoiceSession` implementation itself.

## Applicant profile — progressive enrichment, no new profile type

`VoiceSessionConfig`/`VoiceSessionContext` carry an optional `applicantProfile: ApplicantProfile` (the shared contract from [`docs/applicant-profile.md`](./applicant-profile.md)), and `updateContext()` lets a caller push an updated one mid-session. A `VoiceSession` implementation never mutates this itself — per the AI safety boundary, turning a transcript into new profile facts is the pipeline seam's job (via the existing `profileExtraction` + `applicantProfile` adapters), not something baked into any voice transport. No second/competing profile type is introduced anywhere in this module.

## Multi-team boundaries respected

- **No persistence.** `VoiceSession` is entirely in-memory/client-side. Nothing here writes to Supabase or defines a storage schema — that stays Vamshi's backend contract to design; a future adapter would simply call into it the same way `liveRetrieval.ts` already calls a Supabase Edge Function for scheme evidence. This phase also does **not** deploy the relay/proxy or token-minting backend `GeminiLiveVoiceSession` needs for a real connection — see "Authentication boundary" and "Remaining work" above.
- **No application/document/consent logic** (Adita's workstream), **no UI components** (Prerna's — this phase is types + headless implementations only, nothing rendered, no microphone capture, no audio playback), **no blockchain/multisig changes** (Jordan's) were touched.
- **AIProvider is untouched.** `src/assistant/ai/*` was not modified; `VoiceSession` and its Gemini/offline implementations are new, parallel modules.

## 🚨 Cross-team issues found in this phase

None required a hard stop. Every requirement mapped onto a new, self-contained module — the adapter, transport, and protocol layers are all real and complete without needing any other team's contract to change. One forward-looking, non-blocking note for whoever eventually builds the real backend (Vamshi): **which of the two authentication patterns to build — relay/proxy vs. ephemeral-token — is a real decision** (see "Authentication boundary" above), but it doesn't block anything in this phase, since `GeminiLiveConnectionResolver` is injectable either way and the adapter is fully built and tested against both shapes conceptually. Raise it when backend work on this actually starts.

## Tests

- [`src/assistant/voice/offlineVoiceSession.test.ts`](../src/assistant/voice/offlineVoiceSession.test.ts) — 34 tests covering: lifecycle ordering and idempotency, event sequencing/seq monotonicity, a full text-input turn's exact event/status sequence, language passthrough, push-to-talk audio accumulation and finalization, four interruption/barge-in scenarios (explicit stop, no-op when not speaking, implicit user barge-in, and "no stray events survive an interruption"), error handling with both recoverable-reconnect and non-recoverable-close paths, cleanup/disconnect (mid-turn close, idempotent close, unsubscribe, listener release), `updateContext`, the `offlineVoiceSessionFactory` contract, and (6 tests) `replySource: 'external'`/`deliverAssistantReply()` — including that it's interruptible mid-stream exactly like an autonomous reply, and that `close()` while awaiting an external reply resolves cleanly.
- [`src/assistant/voice/geminiLiveProtocol.test.ts`](../src/assistant/voice/geminiLiveProtocol.test.ts) — 15 tests covering the pure message builders, the server-message parser (including rejecting malformed/garbage input), and the base64⇄ArrayBuffer round trip.
- [`src/assistant/voice/geminiLiveVoiceSession.test.ts`](../src/assistant/voice/geminiLiveVoiceSession.test.ts) — 43 tests, detailed in "Testing strategy" above, all driven through `FakeGeminiLiveTransport` with zero network access, plus (6 tests) `replySource: 'external'`/`deliverAssistantReply()` — including that Gemini's own autonomous serverContent is correctly suppressed while the citizen's own transcription still flows through.
- [`src/assistant/conversation/voiceConversationRuntime.test.ts`](../src/assistant/conversation/voiceConversationRuntime.test.ts) — the runtime that wires the above into `VoiceAssistantController`; see [`docs/voice-conversation-runtime.md`](./voice-conversation-runtime.md).
