# LokPulse — SIH26091

**Hyperlocal Opportunity Radar + NSFDC Financial Structuring for Rural Micro-Entrepreneurs**
Ministry of Social Justice & Empowerment · NSFDC schemes · English + Kannada

> **This branch (`ai-assistant-dev`)** additionally includes a prototype **AI Government Scheme Assistant** at `/assistant`, built on top of everything below without changing any existing route or logic. See [AI Government Scheme Assistant](#ai-government-scheme-assistant-prototype) further down for what it does and how to run it — it is not yet on `main`.

LokPulse answers one question before money moves: *what should this person start, in this village, in the next 14 days, with this margin capital — and who must co-sign before disbursement?* It combines a hyperlocal opportunity scan (weather, mandi prices, festival demand, competitor density) with an exact NSFDC loan router and an adaptive multi-signature sanction flow, instead of being another eligibility-checklist chatbot.

## Run

```bash
npm install
npm run dev        # dev server (Vite prints the URL)
npm run build      # production build (tsc -b && vite build)
npm test           # Vitest unit tests
npm run test:e2e   # Playwright end-to-end tests (needs a dev/preview server; see note below)
```

**Demo path:** `/scan` starts empty (name field has a placeholder, no Lakshmi S. prefill). Click **Load demo case** for the reference profile — SC woman, Dinka village, dairy, ₹1,00,000 available margin — or use `/scan?demo=1`. Then **Run hyperlocal scan** → walk **Pulse → Report → Finance → Sanction**. This should always produce: project cost **₹10,00,000**, max loan **₹9,00,000**, **NSFDC Term Loan Scheme**, and a LokScore-driven signing quorum on `/sanction`. From `/sanction`, **Export** produces a single printable report (`window.print()` → Save as PDF) combining every screen's output plus a document checklist. Assistant lives at `/assistant` (empty) and `/assistant/:id` (this scan).

> **Port:** Vite may already find **5173** held by an older build. The app that just started is the URL Vite prints (often `http://127.0.0.1:5174/`). Always open that printed URL — a remembered 5173 tab can be stale. Startup also logs `LokPulse UI: http://127.0.0.1:<port>/` and `app_version`.

> **Presenting live? Flip on "Offline Demo Mode"** (top-right corner of `/scan`) if venue wifi is unreliable. It forces the seeded-village path and skips every live network call (weather, geocoding, competitor lookup) entirely, so the scan completes near-instantly with zero network dependency — a safe fallback while the live-lookup feature (real Nominatim geocoding + Overpass competitor data for any Indian town) stays available to show off when connectivity is good. Even with it off, every live call times out at 2.5s, retries once with backoff, and falls through to an honest "unavailable" / `incomplete` state rather than hanging. An incomplete assessment cannot be signed on `/sanction`.

> **Playwright note:** `playwright.config.ts` targets port 5173 by default. If something else on your machine is already bound to that port, run `npm run dev -- --port <free-port>` and point a local Playwright config's `baseURL`/`webServer` at it instead. Same rule as above: the printed Vite URL is canonical.

## AI Government Scheme Assistant (prototype)

An experimental, conversational scheme-matching assistant at **`/assistant`** (empty visit) and **`/assistant/:id`** (this scan's profile is passed in). It is not a general chatbot — it only matches government livelihood schemes against a profile.

**Prerequisites:** Node.js (see `package.json`'s tooling versions) and npm. No API keys, accounts, or `.env` file are required to run it — it works fully out of the box.

```bash
npm install
npm run dev        # then open the printed URL and click "Assistant" in the nav, or go straight to /assistant
```

**Pipeline:** message → regex/keyword profile extraction (no AI call needed) → retrieval + filtering against the scheme knowledge base (`src/assistant/data/schemes.ts`) → a deterministic eligibility/ranking engine (`src/assistant/eligibility.ts`, `src/assistant/ranking.ts` — a match score and status like "possible match" is *computed*, never invented by a model) → an AI provider explains that evidence in plain language. Every AI reply is checked against the evidence (`src/assistant/ai/responseGuard.ts`) before being shown, rejecting anything that cites a URL or claims an outcome the evidence doesn't support.

## Application automation (Adita)

The assistant advises. **`/apply` helps you actually apply**, using one shared workflow for every last-mile channel:

Citizen profile + selected scheme → application schema → field mapping → missing fields → document requirements → validation → generated application → user review → corrections → explicit consent → submission adapter → tracking id → status tracking.

| Channel | What "submit" means | When it may say the government received it |
| --- | --- | --- |
| **Real government API** | `POST` to `VITE_GOV_APPLY_API_URL` | Only if that API returns an application id. If the env var is unset (the default), the result is **"Government API not configured — not submitted"**. |
| **Assisted** | Packet for bank / SCA / local agency | Never. Outcome is `assisted_packet_ready`. |
| **Guided** | Packet + official portal link | Never. You still file on the portal. |
| **Simulation** | Explicit checkbox | Never. Banner: **"Simulation only — nothing was filed"**. |

Start from **Apply** in the nav, or from a scheme's **Start application** button in `/assistant`. Tracked packets are stored on this device (`localStorage`); they are not a government register.

```bash
# optional — only if you actually have a government apply endpoint
# VITE_GOV_APPLY_API_URL=https://example.gov/apply
```


**Offline fallback (what you get by default):** no AI provider is configured out of the box, so every reply comes from a deterministic, template-based explanation of the same retrieved evidence — never a live model — and is clearly labelled **"Offline reasoning — no AI model used"** on every such message in the chat.

**Testing the local LLM (Ollama) path — optional:**
1. Install [Ollama](https://ollama.com) and run `ollama serve`.
2. Pull a chat model: `ollama pull llama3.1` (the default model name the app looks for; see `OLLAMA_MODEL`/`OLLAMA_BASE_URL` in `src/assistant/aiConfig.ts` to point at a different local model or port).
3. Reload `/assistant` — it auto-detects a reachable local Ollama server (a ~1.2s health check) and uses it instead of the offline fallback. Nothing leaves your machine, no key needed.

A hosted-model provider abstraction exists (`src/assistant/ai/hostedProvider.ts`) but is intentionally disabled (`HOSTED_PROXY_URL` unset) — a hosted model must only ever be called through a backend proxy that holds its API key server-side, never directly from the browser, and no such proxy is included in this repo.

**Important — this is reference data, not live retrieval:** the scheme knowledge base (`src/assistant/data/schemes.ts`) is a small, manually curated set of real, source-cited central/state schemes (NSFDC, PMEGP, PM Mudra Yojana, Stand-Up India, PM Vishwakarma, NBCFDC, Kudumbashree), each with its official source URL and a `lastVerifiedDate`. **It is not a live feed from any government system.** Every scheme shown in `/assistant` displays its source and a reminder to verify before applying. Do not add live web retrieval or scraping to this without a deliberate, separate decision — that architecture is intentionally deferred, not started.

**EN/KN:** all assistant UI chrome (labels, buttons, statuses) follows the existing app's English/Kannada toggle. Scheme content itself (names, descriptions, eligibility text) is deliberately kept English-only to avoid mistranslating financial/legal specifics.

**Tests:** `npm test` (138 tests) and `npm run test:e2e` (`e2e/assistant.spec.ts`, 8 tests) both cover the assistant alongside the existing LokPulse suite — see [Run](#run) above and the note on Playwright ports.

## Exact NSFDC figures implemented

These are the real scheme constants (`src/lib/config.ts`'s `NSFDC` object) — a Vitest test (`finance.test.ts`) locks them so no future change silently drifts:

| Rule | Value |
| --- | --- |
| Margin capital → project cost | project cost = margin ÷ 10% |
| Loan ratio | 90% of project cost |
| Micro Finance scheme | project cost ≤ **₹1,40,000** |
| Micro Finance loan cap | **₹1,25,000** |
| Micro Finance rate / tenure / moratorium | **6.5% p.a. / 3 years / 3 months** |
| Term Loan scheme | ₹1,40,000 < project cost ≤ **₹50,00,000** |
| Term Loan loan cap | **₹45,00,000** |
| Term Loan rate / tenure / moratorium | **8% p.a. / 7 years / 6 months** |
| Max supported margin capital | **₹5,00,000** (above this, project cost would exceed the ₹50L Term Loan cap — rejected with a clear message, not silently clamped) |

Repayment is a real **reducing-balance quarterly annuity EMI** (not equal-principal, not a rough calculator), computed with exact BigInt rational arithmetic so there's no floating-point drift in the compounding. All money math runs in integer paise internally; the final installment absorbs any rounding residue so every schedule closes to exactly ₹0.00. Moratorium interest accrues and is capitalised into principal at the start of repayment (the `capitalize_into_principal` policy, named and displayed on-screen — not silently assumed).

**LokScore** (`src/lib/config.ts`'s `LOKSCORE_WEIGHTS`) blends five 0–100 components — demand 25%, competition gap 20%, weather fit 15%, financial coverage 25%, eligibility 15% — into a 0–100 total that drives an **adaptive multi-sig quorum**: ≥80 → 2-of-3 verifiers, ≥60 → 3-of-5, below 60 → 4-of-5 plus a mandatory mentor. Every signature is a real secp256k1 ECDSA signature (`ethers.js`), not a checkbox — see `src/lib/multisig.ts`.

## What makes this not "another chatbot"

| Typical SIH build | LokPulse |
| --- | --- |
| NLP Q&A chatbot | **Temporal Opportunity Graph** — jatra × weather × mandi × competition |
| Generic SWOT text | Village-level feasibility with live map reach rings, real geocoded locations, and a document export |
| Rough EMI calculator | **Exact NSFDC router** with a real reducing-balance annuity schedule |
| Scheme dump | Eligibility-aware **LokScore** → **adaptive multi-sig quorum** with real ECDSA signatures |

## Working pieces (live, not mocked)

1. **Live weather** from Open-Meteo for any resolved location (seeded village or free-text search) — an honest "unavailable" state on failure, never a fabricated reading.
2. **Live geocoding + competitor lookup** beyond the 5 seeded villages: free-text place search via Nominatim, nearby-business density via the Overpass API, with an honest "limited data" fallback if either call returns nothing usable.
3. **NSFDC financial engine** matching the SIH26091 scheme rules above, including the quarterly repayment schedule and an itemised working-capital breakdown.
4. **Real ECDSA multi-sig attestations** (`ethers.js` secp256k1) — the attestation hash and signed message both commit to the applicant, project cost, scheme, loan amount, and LokScore at signing time; a wrong-key or tampered-data signature is provably rejected (see `multisig.test.ts`).
5. **EN / KN** toggle across the full flow, key-parity-tested (`i18n/parity.test.ts`).
6. **Consolidated report export** (`/export`) — one printable document combining location, feasibility, finance, LokScore, and a scheme-specific document checklist, with a generation timestamp and data-provenance note.

## Clearly simulated / not live

- **Escrow release** on `/sanction` is a UI simulation ("Simulated release — no blockchain transaction") — no chain call is made.
- **Verifier identities** are demo/fixture wallets, labeled as such on-screen, not real government officer accounts.
- `contracts/AdaptiveSanction.sol` is a Solidity sketch for a future on-chain sanction + DBT event rail — it is not deployed or wired into the app.

See `docs/PRESENTATION_NOTES.md` for the full honest breakdown of what's live vs. simulated vs. deliberately deferred, and `docs/MASTER_SPEC.md` / `docs/AUTONOMOUS_RUN_LOG.md` for the detailed build history and verification record.

## Product thesis (judges)

Rural failure is rarely "no loan". It is **wrong activity, wrong timing, wrong structure**. LokPulse answers: *what should this person start, in this gram panchayat, in the next 14 days, with this margin — and who must co-sign before money moves.*
