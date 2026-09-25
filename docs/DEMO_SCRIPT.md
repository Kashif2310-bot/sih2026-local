# Demo Script — LokPulse / Ishaara (5-7 minutes)

Every claim in this script is backed by a row in `docs/HONESTY_LEDGER.md`. If an evaluator asks something not covered here, see `docs/PRESENTER_QA.md` first — do not improvise a claim that isn't in either document.

## Pre-demo checklist (do this before anyone walks in)

- [ ] **Chrome or Edge**, not Firefox/Safari/Opera GX — voice and speech-to-text depend on browser-native APIs only Chrome-family browsers implement reliably.
- [ ] Running on **localhost** (`npm run dev`), not a deployed URL — confirm the terminal shows the dev server up.
- [ ] **VPN off.** A VPN can break the WebSocket connection to Gemini or add enough latency to make voice feel broken when it isn't.
- [ ] **Microphone permission**: open the assistant page once beforehand and grant mic access, so the permission prompt doesn't interrupt the live demo.
- [ ] **Hard refresh** (Ctrl+Shift+R) right before presenting, so you're not showing stale state from a previous rehearsal.
- [ ] Know your **backup plan** (below) before you start, not after something fails.

**Backup plan if voice fails live:** say the line from the ledger — "voice genuinely connects to Gemini; I've verified the protocol handshake works, but if the room's network is unfriendly to WebSockets right now, here's the same interaction by typing" — then continue on the text assistant. Do not re-try voice more than once in front of the room.

**Backup plan if live-source retrieval is asked about:** it will show "not_configured" honestly if clicked — that IS the correct, intended behavior. Don't panic-explain it as broken; say the line from the ledger about not having a working dataset key yet.

---

## 1. Opening (30s)

**Say:** "LokPulse helps a citizen find and apply for government livelihood schemes — in their own words, typed or spoken, in English or Kannada."

**Do:** Open `/assistant`.

**Expect:** The AI Government Scheme Assistant page loads with an empty profile panel and example prompts.

---

## 2. Text assistant — scheme matching (90s)

**Do:** Click one of the example prompts, or type: *"I am 24, from rural Karnataka, SC category, income ₹2 lakh, want to start a poultry business needing ₹3 lakh."*

**Expect:** The profile sidebar fills in (age, area, state, category, sector, investment). Ranked schemes appear on the right with match scores and a source badge reading "Verified scheme knowledge base."

**Say:** "This matching is deterministic — same input, same output, every time. No language model is guessing eligibility; it's rule-based extraction against a curated, hand-verified scheme dataset."

**If it fails:** refresh once. If it still fails, this is a real bug — do not fake it; move to the next section and mention you'll follow up.

---

## 3. Voice — native audio conversation (90s)

**Do:** Click **"Talk instead of typing."** Wait for the status pill to show **"Listening…"**. Speak a short sentence, e.g. *"I am thirty five, general category."*

**Expect:** The assistant replies out loud (native audio, not typed-then-read-aloud), and the transcript appears in the chat alongside your own words.

**Say:** "This is genuine two-way audio with Gemini's Live API — the model hears you and speaks back directly. The browser never holds our Gemini key; it gets a short-lived, single-use token from our backend first."

**If it hangs on "Listening…" or errors:** use the backup line above and continue on text. Do not claim it "usually works" — say what you've verified: the connection and handshake are real (protocol-level, tested tonight), a live spoken exchange with an audience microphone is the one thing not personally verified end-to-end in this environment.

---

## 4. Apply flow — voice-to-form (90s)

**Do:** Navigate to `/apply`. On the voice step, click **"Start speaking"** and say the example line shown on screen, or click the example chip: *"I want to start a dairy business in Mandya with one lakh rupees margin."*

**Expect:** The transcript box fills in; "We picked this up" shows extracted hints (sector: dairy, own contribution: ₹1,00,000).

**Say:** "Notice this uses the browser's own speech engine, separate from the Gemini voice assistant — and every extracted field is shown to you, editable, before anything is submitted."

**Do:** Continue to the profile step. Point out the editable fields are pre-filled from what was said, but every one is a plain, editable text input.

**If speech recognition doesn't respond:** it will now show a clear message within ~7 seconds (fixed tonight) instead of hanging forever — narrate that as the intended honest-failure behavior, then type the example instead.

---

## 5. Submission and persistence (60s)

**Do:** Complete the remaining apply steps (documents/consent can be minimal for the demo) and submit. Then **hard refresh the page** and navigate back to the tracking page for that application.

**Expect:** The application is still there after the refresh.

**Say:** "Your application is saved locally the instant you submit — that's instantaneous and never depends on the network. It's also synced to our database under your own protected identity: we've directly tested that a different citizen's session cannot read or modify your application."

---

## 6. Closing honesty note (30-45s)

**Say:** "A few things worth being upfront about: live government statistics from data.gov.in are wired up end-to-end but we haven't found a working dataset key yet, so that path is honestly disabled, not faked. And several backend capabilities — approval workflows, admin review queues, notifications — are built and tested but not yet exposed to this citizen-facing app; they're ready for the next phase."

**Do:** Stop here. Don't over-promise on anything not in the ledger.

---

## Timing summary

| Section | Time |
|---|---|
| Opening | 0:30 |
| Text assistant | 1:30 |
| Voice | 1:30 |
| Apply flow | 1:30 |
| Persistence | 1:00 |
| Closing honesty | 0:45 |
| **Total** | **~6:45** |
