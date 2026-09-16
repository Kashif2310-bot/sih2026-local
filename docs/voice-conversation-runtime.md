# VoiceConversationRuntime — the voice ↔ intelligence wiring layer

**Location:** [`src/assistant/conversation/voiceConversationRuntime.ts`](../src/assistant/conversation/voiceConversationRuntime.ts)
**Status:** implemented 2026-09-15. No UI, no microphone capture, no audio playback — this is the headless coordinator only. See "What remains" below.

## What this is

The thin coordinator that connects [`VoiceSession`](./voice-session-architecture.md) (transport) to [`VoiceAssistantController`](../src/assistant/conversation/voiceAssistantController.ts) (intelligence):

```
VoiceSession --events--> VoiceConversationRuntime --transcript--> VoiceAssistantController
VoiceConversationRuntime <--replyText-- VoiceAssistantController
VoiceConversationRuntime --deliverAssistantReply()--> VoiceSession
```

**This file is orchestration only.** It contains zero eligibility, ranking, profile-extraction, or response-generation logic — all of that stays exactly where prior phases put it, inside `VoiceAssistantController` and the deterministic pipeline underneath it. The runtime's entire job is turn correlation, concurrency safety, and translating between `VoiceSession`'s event/status vocabulary and a small, consumer-friendly state.

## Precondition: the session must use `replySource: 'external'`

`VoiceConversationRuntime` requires the `VoiceSession` it's given to have been constructed with `replySource: 'external'` (see [`docs/voice-session-architecture.md`](./voice-session-architecture.md#controller-authored-replies-replysource-external--deliverassistantreply) for why this exists and how each provider implements it). Without it, the session would generate its own autonomous reply *and* the runtime would try to deliver the controller's — the runtime doesn't enforce this at construction time (no such getter exists on `VoiceSession`), but every delivery attempt is wrapped defensively (see "Error handling" below), so a misconfigured session fails safely rather than crashing.

## Provider independence

Nothing in `voiceConversationRuntime.ts` imports from `geminiLive*.ts` or `offlineVoiceSession.ts`, or references a Gemini message shape, a WebSocket, or a browser audio API — it depends only on `VoiceSession`/`VoiceEvent` (`../voice/types.ts`). `voiceConversationRuntime.test.ts` proves this concretely: the identical runtime class drives a real `OfflineVoiceSession` and a real `GeminiLiveVoiceSession` (via `FakeGeminiLiveTransport`) through the same script with no provider-specific runtime code anywhere.

## Turn correlation — a simple monotonic token, not provider-specific turn ids

Every finalized transcript, and every session-level `'interrupted'` status transition, claims a fresh `turnToken`. A controller call only gets to deliver its reply if the token it captured is still the *current* one when it resolves:

```ts
const myToken = (this.turnToken += 1)
// ... await controller.handleUserTranscript(...) ...
if (this.isStale(myToken)) return // superseded — never deliver
```

This one mechanism is what makes every concurrency case below safe, without needing a provider to expose its own turn ids.

## Interruption / barge-in

Interruption itself is **not reimplemented here** — it's already handled correctly at the `VoiceSession` level (see [`voice-session-architecture.md`](./voice-session-architecture.md#interruption--barge-in-handled-once-from-two-triggers)): a `currentModelTurnId`-based staleness check inside each session guarantees a cut-off model turn can never emit a stray event, whether the reply was autonomous or `deliverAssistantReply()`-delivered. The runtime's job on top of that is narrower: when it observes an `'interrupted'` status, it bumps `turnToken`, so that any controller call still in flight for the turn that just got cut off can never deliver a now-stale reply once it resolves. The next finalized transcript (the citizen's actual barge-in words) is then processed immediately — it is never queued behind the interrupted turn.

## Concurrency cases, explicitly handled and tested

| Case | Handling |
|---|---|
| Two final transcripts arrive close together | Each claims its own token; only the reply matching the *current* token is ever delivered — an earlier one resolving late is silently discarded. |
| Assistant reply ready, user interrupts before delivery lands | The `'interrupted'` status bumps the token first; the in-flight controller call's eventual result is discarded. |
| Stale server content from an interrupted turn | Already prevented at the `VoiceSession` level (see above) — the runtime never even sees it as a "new" turn. |
| `VoiceSession` closes while the controller is processing | Checked explicitly (`session.status === 'closed'`) before attempting delivery. |
| Controller throws unexpectedly | Caught; `ConversationState` is untouched (the controller only reassigns its internal state at the very end of a *successful* call, never mid-method) — see "Error handling" below for what happens next. |
| The same final-transcript turn id arrives twice | Tracked in a `seenFinalTurnIds` set; the duplicate is a no-op. |

## Error handling

Two error sources, surfaced distinctly via `RuntimeEvent` (`{ type: 'error', error: { source: 'session' | 'controller', ... } }`):

- **Session error** (`VoiceErrorEvent`) — forwarded as-is; the runtime never fabricates a successful response in its place. The session's own `'status'` event (which always accompanies a real error) drives `audioState` to `'error'` through the normal status mapping.
- **Controller error** — the runtime cannot leave the session stuck in `'processing'` forever (no reply ever delivered), so it attempts to deliver a clearly-labeled fallback message ("Sorry, something went wrong... could you say it again?") to recover the session back to `'listening'`. This is reported as `recovered: true`/`false` depending on whether that fallback delivery itself succeeded. **Never** a fabricated *successful* turn — no `turn_completed` event fires for a failed turn, only `error`.

Both paths honor "conversation state remains intact": `VoiceAssistantController.handleUserTranscript` never mutates `this.state` until it fully succeeds, so a thrown error leaves the citizen's previously-established profile, ranking, and history exactly as they were.

## `AssistantAudioState` — a coarser, consumer-friendly view

Not a second state machine — a pure, total mapping from `VoiceSessionStatus`'s ten values down to seven (`idle | listening | processing | speaking | interrupted | error | closed`), collapsing `idle/connecting/connected` into one `idle` and `listening/user_speaking` into one `listening`. The runtime never tracks an independent notion of "is the assistant speaking" that could drift from what the session itself reports — every `audioState` change is derived, in `mapVoiceStatusToAudioState()`, directly from the session's own `'status'` events.

## Lifecycle

```
create (constructor, subscribes to the session)
  → start()      — connects the session
  → sendText() / (voice events arrive on their own)
  → interrupt()  — delegates to session.interrupt()
  → dispose()    — unsubscribes, closes the session, emits 'closed', clears listeners
```

`dispose()` is idempotent (a guarded no-op on a second call) and closes the underlying `VoiceSession` too (itself already safe to call more than once) — no timer or subscription is left registered after disposal.

## Text fallback — one pipeline, not two

`runtime.sendText(text)` calls `session.sendTextInput(text)` — the exact same `VoiceSession` method a "type instead of speak" UI control would use — which produces a real `user_transcript_final` event through the session's own normal pipeline. The runtime's event handler doesn't know or care whether that event originated from spoken audio or typed text; there is exactly one turn-handling code path (`handleFinalTranscript` → `processTurn`), never a duplicated one for text vs. voice. This is what makes text input useful for development, accessibility, testing, and a future text UI without any extra plumbing.

## Testing strategy

`voiceConversationRuntime.test.ts` uses three kinds of `VoiceSession`:

1. **`FakeVoiceSession`** (test-only, defined in the test file) — a hand-driven implementation that can emit *any* event sequence, including races the two real implementations structurally prevent by construction (e.g. two finals in immediate succession). Used for the concurrency/correlation tests, so the runtime is proven against the *contract*, not against one provider's particular timing.
2. **Real `OfflineVoiceSession`** (`replySource: 'external'`) — for realistic end-to-end behavior and the integration scenario.
3. **Real `GeminiLiveVoiceSession`** with `FakeGeminiLiveTransport` — for the provider-independence proof (identical runtime code, different provider).

A `ScriptedController` test double (satisfying the narrower `ConversationTurnHandler` interface the runtime actually depends on, not a full `VoiceAssistantController`) is used only for the small number of tests that need a controller call to be slow or to throw on demand — the real controller is deliberately resilient (every internal step already fails gracefully), which makes forcing it to throw awkward without a double built specifically for that.

## What remains before a voice UI can use this

- Microphone capture / audio resampling into `sendAudioChunk()`-ready `VoiceAudioChunk`s.
- Audio playback of `model_audio_chunk` events (and stopping it immediately on interruption).
- A UI layer (React components, hooks) consuming `runtime.subscribe(...)` and `runtime.getController().subscribe(...)` — explicitly out of scope for this phase; Prerna's workstream.
- Gemini backend deployment (relay/proxy or ephemeral-token minting) — see [`voice-session-architecture.md`](./voice-session-architecture.md#authentication-boundary); still unset in this repo.
- Audio synthesis of controller-authored replies for the real Gemini adapter (currently text-only — see "Controller-authored replies" in the voice architecture doc).
