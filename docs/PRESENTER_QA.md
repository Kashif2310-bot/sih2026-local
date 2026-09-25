# Presenter Q&A — 15 likely evaluator questions

Every answer here is drawn from `docs/HONESTY_LEDGER.md`. If a question comes up that isn't here or in the ledger, say "let me verify that and follow up" rather than guessing — that's a more credible answer than an improvised one.

### 1. "Is the scheme data live from the government, or hardcoded?"

Curated, not scraped live. It's a hand-verified dataset (`schemes.ts`) that our team checked against real scheme documentation. We do have a live government-statistics integration built and deployed — see question 2 — but the scheme *definitions themselves* (eligibility rules, loan amounts, documents) are curated, deliberately, because no government API actually publishes that structured a dataset for us to pull from live.

### 2. "Is any of this actually connected to a real government data source?"

Yes, one path: `data.gov.in`'s Open Government Data API, via a deployed Edge Function. Right now it's honestly returning "not configured" because we haven't registered a working dataset key yet — you can watch it fail cleanly rather than fake success. The self-service registration is real and free; we simply haven't completed it.

### 3. "What stops another user from reading my application?"

Row-level security in Postgres, keyed to your own authenticated identity — not something we just configured and hoped works. We wrote a test that creates two real, separate accounts and proves directly that one cannot read, update, or forge ownership of the other's application or profile. That test passes against our live database, not a mock.

### 4. "Where is the Gemini API key? Can I find it in the browser?"

No. The browser never receives it. A backend function holds it server-side and exchanges it for a short-lived, single-use token good for about a minute — the browser only ever sees that token, not the real key. We've scanned our actual production JavaScript bundle to confirm the real key never ends up in it.

### 5. "What happens if voice doesn't work in this room's network?"

The text assistant keeps working with zero interruption — we tested this directly, including simulating a failed voice connection in a real browser. Nothing about a voice failure blocks or breaks the rest of the app.

### 6. "Is the AI making up the eligibility answers?"

No — the answers come from deterministic, rule-based matching against the curated dataset, not from a language model inventing eligibility criteria. Where an AI provider is involved (the offline text provider), every reply is validated against the same evidence before being shown. For voice specifically, the model is instructed to call a tool for every fact rather than answer from its own memory, and the tools only ever return facts from that same curated dataset.

### 7. "How do you handle someone speaking Kannada, or mixing languages?"

The interface has full English/Kannada parity, verified by an automated test that checks every UI string exists in both languages. We do not currently support Hindi — that's a real gap, not a decision to hide it.

### 8. "What happens to my documents when I upload them?"

Nothing is uploaded in this build — we track document *metadata* (which documents you've declared as available, what's still missing), not the files themselves. There's no file storage in this version.

### 9. "Can an official approve or reject an application through this?"

That workflow is built and tested on the backend — signatures, audit trail, the works — but it isn't wired into a citizen-facing or officer-facing UI in this build. It's ready to be exposed as the next phase, not vaporware, but not demoable today.

### 10. "Is this using blockchain, or just claiming to?"

Any blockchain-style "chain anchor" language in the code is explicitly marked `simulated: true` everywhere it's used. We are not claiming a real blockchain integration in this build.

### 11. "What happens if I close the tab mid-application?"

Your application draft is saved to your device the instant you take an action — that's local and instant, no network dependency. It also syncs to our database in the background under your own protected identity. The one thing that is *not* yet locally persisted is the assistant's conversation-level profile (the chat state) — that lives only in the current tab until it's had a chance to sync; your formal submitted application is unaffected by this.

### 12. "How do you stop this racking up a huge AI bill if it goes viral?"

Honestly — that's a real gap right now. The Gemini token-minting endpoint accepts any caller holding our public anon key, which by design ships in the browser bundle. There's no per-user quota yet at our layer, so the actual safety net today would need to be a spending/quota cap set directly on the Gemini API key at Google's end. We're flagging this as a known next step, not something we've solved.

### 13. "Does this work on mobile / older browsers?"

Voice (both the Gemini Live assistant and the apply-flow speech-to-text) depends on browser APIs that are reliably available in Chrome and Edge specifically. We fixed a real bug tonight where a browser whose speech engine silently doesn't respond (we saw this in Opera GX) used to hang forever on "Listening…" — it now fails within about 7 seconds with a clear message instead. The text-based experience works anywhere a modern browser runs.

### 14. "What's actually tested versus just written?"

As of tonight: 93 test files, 922 tests, all passing, including live integration tests that run against our real hosted database with real (and fully cleaned-up) test accounts — not just mocked unit tests. The specific claims in this Q&A about cross-user isolation and persistence are backed by those live tests, not by reading the code and assuming it works.

### 15. "Why should we believe any of this is real and not just a demo facade?"

Ask us to break something on purpose. Try voice with the mic denied — you'll get a clear error, not a fake success. Ask what happens with no data.gov.in key — you'll see an honest "not configured," not invented statistics. Refresh mid-application — your data is still there. We built this specifically so that failure is visible rather than hidden, and we can show you the actual test runs and bundle scans behind every claim in this Q&A.
