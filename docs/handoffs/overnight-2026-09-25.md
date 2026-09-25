# Overnight run — 2026-09-25

Unattended run. Branch: `overnight/2026-09-25`, created from `demo/backend-integration` (which was the current branch at start). All commits below are on this branch. Nothing pushed, nothing deployed, per hard rules.

## Phase 0 — preflight

- Starting branch: `demo/backend-integration`.
- Uncommitted files at start (carried from earlier in this session, before the overnight run began):
  - `M src/assistant/conversation/voiceAssistantController.test.ts`
  - `M src/assistant/profileExtraction.test.ts`
  - `M src/assistant/profileExtraction.ts`
  - `M src/assistant/voice/geminiLiveTransport.ts`
  - `?? src/assistant/voice/geminiLiveTransport.test.ts`
  - These are the Gemini Live Blob/ArrayBuffer fix and the profile-extraction fixes from immediately before this overnight instruction — genuinely already done, not fabricated. Phase 1 verifies and formalizes the first; Phase 2 hardens the second.
- Baseline gate (before any overnight change), run against the dirty tree above:
  - `npx vitest run`: **91 files / 893 tests passed**
  - `npx tsc -b`: clean
  - `npm run lint`: clean
  - `npm run build`: succeeds (pre-existing >500kB chunk-size advisory only, unrelated)
- Six original migrations confirmed byte-identical to `feature/ishaara-gemini-live` via `git diff` (empty output) on all six files.
- Created `overnight/2026-09-25` via `git switch -c` from this state. Uncommitted files above carried onto the new branch (branch switching does not discard working-tree changes).

## Phase 1 — Gemini Live Blob/ArrayBuffer frame fix

**Already done** before this overnight run began (checked first, per instructions). `src/assistant/voice/geminiLiveTransport.ts` already had `decodeMessageData()` (string/Blob/ArrayBuffer/ArrayBufferView), a sequential `messageChain` promise queue preserving frame order, and clear-error surfacing for undecodable/malformed frames. `geminiLiveTransport.test.ts` already had 10 tests covering exactly this.

Actions taken tonight:
- Ran `npx vitest run src/assistant/voice/geminiLiveTransport.test.ts` fresh on the new branch: **10/10 passed**.
- Ran the real-server check requested: a temporary, self-contained vitest test (deleted immediately after) minted a token from the existing, unmodified, deployed `gemini-live-token` function and sent the app's exact FULL setup message (5 real tools via `VOICE_TOOL_DECLARATIONS`, the real `VOICE_SYSTEM_INSTRUCTION`, real VAD config, session resumption requested) through the real `WebSocketGeminiLiveTransport`. **Result: `session.status` reached `"listening"` — setupComplete arrived.** No setup field breaks it; no browser-side setup message change was needed. `gemini-live-token` was not touched, no token value was printed, nothing deployed.

**Commit:** `f1f61ca` — "fix(voice): decode Blob/ArrayBuffer WebSocket frames from Gemini Live"

## Phase 2 — profile extraction hardening

Added two guards to the bare "I'm/I am `<number>`" age pattern in `profileExtraction.ts` (patterns 1/2, "N years old" and "age N", untouched — same 0-120 range as before):
- Plausibility range narrowed to 18-100 for this pattern only.
- A ~30-character lookahead rejects the match if disqualifying words follow: lakh/lac/crore/thousand/rupees/rs, km/kilometres, months/days/hours, cows/buffaloes/acres, members/employees, percent, or "years of experience"/"years into"/"years in".

11 new tests, all passing: every required "must produce NO age" case ("I'm 5 km from Mandya", "I am 2 years into dairy farming", "I'm 3 lakh short", "I am 50000 rupees short" — this one was already safe structurally since `\d{1,3}\b` cannot match a 5-digit number, "I have 24 cows" — already safe since it doesn't use "I'm"/"I am" at all, "I'm 200" — rejected by the new range) and every required "must produce an age" case ("I'm 24", "I am twenty four", "I'm 24 and female", "I'm 35, general category").

Re-ran `voiceAssistantController.test.ts`'s "tolerates a message where only some facts are recognizable" test in isolation: still passes — age=28 extracted, `financingRequired`/`investmentRequired` still correctly undefined (the genuinely-unstated loan amount is not invented).

Full gate after this phase: **91 files / 904 tests**, tsc clean, lint clean, build succeeds.

**Commit:** `bf9cc22` — "fix(profile-extraction): harden bare I'm/I am <number> age pattern"

## Phase 3 — voice robustness

**Audio capture/playback review:** read `microphoneCapture.ts`, `audioOutputPlayer.ts`, `browserAudioBridge.ts`, `captureWorklet.ts` in full. **No real defect found** — autoplay-gesture ordering (`player.prepare()` called before `getUserMedia()`, with a comment explaining why), cleanup on stop/dispose (worklet disconnected, blob URL revoked, every track stopped, AudioContext closed), and the StrictMode double-invoke guard were all already correct. Per "fix real defects only, don't refactor working code," nothing was changed here.

**Token freshness:** confirmed structurally already correct by reading `connect()` — `resolveConnection()` is called fresh inside every `connect()` invocation, with no caching anywhere in the chain (`defaultGeminiLiveConnectionResolver` → `createEphemeralTokenConnectionResolver()()`). No existing test proved this (the existing reconnect test reuses a static `TARGET`). Added one: a resolver returning a distinguishable value per call, asserting it's invoked twice across a fail-then-reconnect cycle with two different resulting URLs.

**`/apply` SpeechRecognition stuck on "Listening...":** real, reproduced bug. `window.SpeechRecognition`/`webkitSpeechRecognition` existing only proves the API shape is present, not that the backend actually responds (Opera GX: `start()` succeeds, no event ever fires). Fixed in `VoicePage.tsx`:
- 7-second response timeout: if nothing (result/error/end) has fired since `start()`, stop and show a "did not respond" message.
- Specific, visible messages for every documented `SpeechRecognitionErrorEvent.error` code: `network`, `not-allowed`, `service-not-allowed`, `no-speech`, plus a generic fallback — previously `onerror` only did `setListening(false)` with **no message at all**.
- Unmount cleanup (stops recognition + clears the timer) — previously absent; navigating away mid-listening could leak the recording indicator and would call state setters after unmount once the timer was added.

**First-ever component test in this codebase.** No `.test.tsx` file existed before tonight. Added `VoicePage.test.tsx` (10 tests, all passing), opted into `jsdom` via the per-file `// @vitest-environment jsdom` magic comment rather than touching `vitest.config.ts`'s global `environment: 'node'` (every other test relies on that staying as-is). Needed `@testing-library/jest-dom/vitest` specifically (not the plain `@testing-library/jest-dom` entrypoint) for Vitest's `expect` types to recognize `toBeInTheDocument`/`toHaveTextContent` under `tsc -b` — found this by hitting the actual type error, not by guessing.

**i18n discrepancy — flagged, not silently worked around.** Tonight's brief assumed en/hi/kn parity is the CI gate. I checked `src/i18n/index.ts` and `src/i18n/parity.test.ts` directly: **this repo has only `en` and `kn`. There is no Hindi locale anywhere, and the real, currently-enforced parity test only checks en/kn.** I did not fabricate a Hindi translation set for a citizen-facing government-scheme app unattended and unreviewed. New strings added with real en/kn parity (verified: `parity.test.ts` passes). **See "Needs human decision" in the final report.**

Full gate after this phase: **92 files / 915 tests**, tsc clean, lint clean, build succeeds.

**Commit:** `0dfbe0f` — "feat(voice): fix /apply speech recognition hanging on 'Listening...'; prove token freshness"

## Phase 4 — STOPPED, proposal only (no code changed)

Investigated the actual scope before touching anything, per this phase's explicit escape hatch.

**What's there today:** `ProfileSidebar.tsx` (`src/components/assistant/ProfileSidebar.tsx`) is a pure, read-only `<dl>` rendering 18 possible fields (`FIELD_ORDER`), fed by `profile: UserProfile` from `useAssistant()` (backed by `AssistantContext.tsx`'s plain `useState<UserProfile>`). Two separate write points ultimately call `setProfile(...)` with a freshly-extracted profile: the text path (~line 136-142) and `syncFromController()` (line 250-257, the voice bridge). `UserProfile` and `mergeProfile`/`extractAndMerge` (used by both `orchestrator.ts` and `voiceAssistantController.ts`) have no concept of "user-confirmed" today.

**Why I stopped rather than build it tonight:** the fields span three genuinely different edit shapes — numeric (age, annualIncome, investmentRequired, financingRequired, ownContribution), enum (gender, socialCategory, areaType, businessStage, businessStatus — each needs its own bounded `<select>`, not free text, to never let an edit write an invalid value), and plain string (businessSector, proposedBusiness, state, district, education, landOrAssets, existingLoans, occupation). Doing this correctly means: a type-aware editor per field, threading a "confirmed" concept through both `AssistantContext.tsx` write points without touching the shared `UserProfile` type, full keyboard + ARIA accessibility, and a new batch of en/kn i18n strings — while also being only the second `.test.tsx` file this codebase will have ever had. That is a real, multi-part feature, not a small patch, and I judged it unsafe to rush unattended with Phases 5-7 still ahead.

**Proposed smallest-safe design, for review:**
1. In `AssistantContext.tsx`: add `const confirmedFieldsRef = useRef<Set<keyof UserProfile>>(new Set())` — pure additive local state, no change to `UserProfile`, `ConversationState`, `mergeProfile`, `orchestrator.ts`, or `voiceAssistantController.ts`.
2. Wrap both existing `setProfile(...)` call sites through one new helper, e.g. `applyProfileUpdate(next: UserProfile)`, that re-applies whichever fields are in `confirmedFieldsRef` from the PREVIOUS profile before setting state — so a fresh extraction can never silently clobber a confirmed field. This is the entire "don't overwrite" mechanism; it needs no change to the extraction pipeline itself.
3. `ProfileSidebar.tsx`: add optional `onEditField?: (field, value) => void` / `onRemoveField?: (field) => void` props. Render a small edit/remove control per row (icon buttons, `aria-label`, keyboard-operable). On edit: a `<select>` for the 5 enum fields (populated from the field's own known values — never free text for these), a `type="number"` input for the 5 numeric fields, plain text for the rest. Both callbacks call `applyProfileUpdate` with the single field patched and add it to `confirmedFieldsRef`.
4. New i18n keys under `assistant.field.*` or a new `assistant.editField.*` block (edit/remove/save/cancel labels) — en/kn, verified against the real `parity.test.ts`.
5. Tests: given `VoicePage.test.tsx` just established the jsdom/RTL pattern tonight, a `ProfileSidebar.test.tsx` can reuse it directly — render with a profile that has 2-3 fields set, click edit, verify the callback fires with the right patch; click remove, verify it clears; verify a fresh `extractProfileFromMessage` result doesn't overwrite a confirmed field once wired into `AssistantContext.tsx`.
6. Explicitly out of scope, confirmed unaffected: `/apply`'s existing review/edit flow (`ApplyPage.tsx`'s `overrides` state) — untouched by this design.

**Needs human decision:** whether "remove" should mean "clear and confirm as empty" (blocks re-extraction filling it back in) or "clear and allow re-extraction again" (a soft undo) — both are defensible, and I did not want to guess which one this product wants for a citizen-facing correction control.
