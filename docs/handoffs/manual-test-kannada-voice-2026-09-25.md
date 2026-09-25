# Manual test needed: Kannada voice language selector

This cannot be automated — it needs a real microphone, a real Chrome/Edge
browser, and a real spoken exchange in Kannada. Everything below it that
*could* be automated (the setup-message mapping, the appended system
instruction, the UI toggle, disabling the selector mid-session) already has
passing automated tests — see "What's already verified by tests" below. This
note is only for the part that isn't: whether the actual audio in and out is
usable.

## What was added

A small English/Kannada toggle next to the "Talk instead of typing" button on
`/assistant`. Selecting "Kannada" before starting voice does two things to the
Gemini Live `setup` message, additively:

1. Sets `generationConfig.speechConfig.languageCode` to `kn-IN` (previously
   omitted entirely, letting Gemini auto-detect/code-switch).
2. Appends one line to the end of the existing system instruction — the full
   original instruction is still sent verbatim, first — telling the model:
   "the citizen has explicitly selected Kannada for this session. Respond in
   Kannada."

Selecting "English" (the default) sends the exact same setup message as
before this change existed. The WebSocket endpoint, token minting, and the
Blob/ArrayBuffer frame-decoding fix are all untouched.

## What you need to check by hand

1. Run `npm run dev`, open `/assistant` in Chrome or Edge, grant microphone
   permission.
2. Click the language toggle to **Kannada** (it should visibly switch and
   the toggle should grey out/disable once voice starts — that part is
   already covered by an automated test, but confirm it looks right).
3. Click **"Talk instead of typing"** and wait for "Listening…".
4. **Speak a short sentence in Kannada** — e.g. something like "ನನ್ನ ಹೆಸರು
   ...", or any natural sentence you'd actually use.
5. Confirm two separate things, since either can fail independently:
   - **Recognition**: does the transcript that appears in the chat actually
     match what you said, in Kannada (not garbled, not silently dropped,
     not transcribed as English)?
   - **Spoken output**: does the assistant's spoken reply come back in
     Kannada, and is it actually intelligible/natural Kannada — not just
     "some audio played"?
6. Try at least one **mixed-language** sentence (a Kannada sentence with an
   English word or two in it, which is realistic for how people actually
   speak) and see whether it still behaves reasonably with Kannada pinned as
   the explicit language, since that's a real tension this change
   introduces: forcing `kn-IN` is a stronger signal than the previous
   "auto" mode's free code-switching.
7. Switch back to **English**, start a new voice session, and confirm it
   still behaves exactly as it did before this change (this is the "don't
   touch the working path" requirement — worth a quick sanity check with
   real audio, not just the automated tests).

## If something looks wrong

- Open the browser's DevTools Network tab, find the WebSocket connection to
  `generativelanguage.googleapis.com`, and inspect the outgoing setup frame
  — confirm it actually contains `"languageCode":"kn-IN"` and the appended
  instruction text when Kannada is selected. If that's correct but the
  audio still isn't right, the issue is on Gemini's side of the model
  behavior, not this app's wiring.
- If recognition or speech quality for Kannada is poor, that's useful
  product feedback (e.g. whether `kn-IN` is the right regional code, or
  whether the directive text needs to be stronger/different) — it isn't
  something more automated testing here could have caught.

## What's already verified by tests (so you don't need to re-check these)

- `kn` → `kn-IN` in the setup message, and `en`/`auto` → omitted
  `languageCode`: `src/assistant/voice/geminiLiveVoiceSession.test.ts`
  (pre-existing coverage — this mapping already existed before today).
- Selecting English sends the identical config as before this feature
  existed; selecting Kannada sends `{ primary: 'kn', allowCodeSwitching:
  true }` and appends (never replaces) the directive text:
  `src/assistant/voice/voiceLanguageSelection.test.ts` and
  `src/pages/AssistantPage.voiceLanguage.test.tsx`.
- The selector defaults to English, toggles correctly, and disables once a
  session is active: `src/pages/AssistantPage.voiceLanguage.test.tsx`.
- en/kn i18n parity for the two new labels: `src/i18n/parity.test.ts`
  (existing, generic test — no Hindi locale exists in this codebase, same
  gap already flagged in `docs/handoffs/overnight-2026-09-25.md`).

None of the above touched a real microphone or a real Gemini response —
they all use a fake WebSocket/session. This document exists because that
gap is real and this feature specifically depends on audio quality in a way
code review can't verify.
