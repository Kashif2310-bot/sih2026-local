# Prerna's Brief — User + Admin Experience (Citizen app + `/admin`)

**How to use this file:** this is the onboarding doc for whichever agent (Cursor, Claude Code, etc.) builds Prerna's half of the team's split. Open a fresh session in `sih2026/` and say:

> Read `docs/PRERNA_HANDOFF.md` in full, then `docs/MASTER_SPEC.md`, `src/App.tsx`, `src/state/AppContext.tsx`, `src/lib/lokScore.ts`, `src/lib/multisig.ts`, and `src/assistant/orchestrator.ts`. Report your understanding of what exists vs. what's net-new for the citizen wizard + `/admin` before writing any code.

This doc does not hand you a finished spec — Part 5 lists real open decisions the team (not the agent) needs to make first. Don't guess past them.

---

## 1. Where you actually are

- Real project root: `sih2026/` (the outer `LokPulse/` folder is just a wrapper — `.git` lives in `sih2026/`).
- GitHub: `github.com/Kashif2310-bot/sih2026`, branches `main` and `ai-assistant-dev` (currently checked out). `ai-assistant-dev` is ahead of `main` with an experimental `/assistant` chatbot feature.
- Stack: Vite + React 19 + TypeScript (`strict: true`) + Tailwind 4 + react-router-dom 7 + i18next (EN/KN) + framer-motion + recharts + react-leaflet + ethers v6.
- Quality bar already in place: Vitest unit tests, Playwright e2e, `oxlint --deny-warnings`, an i18n EN/KN key-parity test. `npm run build && npm run lint && npm test` should stay green through anything you add.
- **100% client-side today. No backend, no database, no auth, no persistence.** Everything lives in React context for the duration of one browser session.

## 2. What already exists (don't rebuild these)

The current product, "LokPulse," is a **pre-disbursement-only** flow, unrelated in shape to the citizen journey below but with real, reusable engines underneath:

| Route | What it does |
|---|---|
| `/` | Landing |
| `/scan` | Onboarding form — location, margin capital, business category, SC/women flags |
| `/pulse` | Live signals cockpit (weather, mandi prices, competitor density) |
| `/report` | Feasibility report (SWOT, market reach radius, pricing) |
| `/finance` | NSFDC scheme router — project cost, loan amount, EMI schedule, working capital |
| `/sanction` | LokScore-driven adaptive multi-sig approval with **real ECDSA signing** (ethers.js), simulated escrow release |
| `/export` | One printable consolidated report |
| `/assistant` | Experimental chatbot: free-text profile extraction → deterministic scheme retrieval/eligibility/ranking → AI-explained results (offline template fallback by default, optional local Ollama) |

Reusable engines (pure TS, already tested):

- **`src/lib/lokScore.ts`** — the LokScore engine (demand/competition/weather/finance/eligibility weighted breakdown, 0–100). **This is what the task calls "LokScore" on the admin side — reuse it, don't reinvent a second scoring system.**
- **`src/lib/multisig.ts`** — real secp256k1 signing/verification (`Wallet`, `signAttestation`, `verifySignature`, `quorumMet`), quorum derived from LokScore (≥80 → 2-of-3, ≥60 → 3-of-5, <60 → 4-of-5 + mandatory mentor). **This is the closest thing to the admin "Multisig Approval" step already working end-to-end.** Jordan owns extending this mechanism; you consume it.
- **`src/assistant/`** — a full pipeline (types, retrieval, eligibility, ranking, orchestrator, chat UI components in `src/components/assistant/`) that is structurally very close to the citizen "Conversation" → "Recommendations" → "Schemes" steps. Read `src/assistant/orchestrator.ts` and `src/assistant/types.ts` before designing those three screens from scratch — you may be extending this rather than starting over.
- **`src/lib/documentChecklist.ts`** — per-scheme document checklist (EN/KN), a starting point for the citizen "Documents" step and the admin "Required Documents" step.
- **`src/i18n/index.ts`** + `parity.test.ts` — EN/KN string tables with a CI-enforced parity test. Every new screen's strings go in both languages in the same commit, no exceptions (repo-wide rule, not a suggestion).
- **`src/components/Shell.tsx`** — the citizen nav/header pattern (desktop nav + mobile scroll-nav + language toggle). `/admin` should almost certainly get its **own** shell/layout, not this one — it's a "completely separate application area" per the task.

## 3. What does NOT exist yet (all net-new for you)

- **Voice** anything — no speech-to-text/text-to-speech in the repo at all. "Voice landing" is greenfield.
- **Application lifecycle** — Documents upload, Review, Consent, Submission, Tracking, Final report. The current product stops at "sanction"; there is no concept of a submitted application persisting anywhere, no status machine, no tracking timeline.
- **`/admin` entirely** — no admin route, login, dashboard, or any of the 12 steps in the task (Admin Login → Dashboard → Incoming Applications → Ministry/Department Routing → Application Details → Required Documents → Applicant Profile → LokScore → Approval Requirement → Assigned Reviewers → Multisig Approval → Application Status → Audit Trail).
- **Ministry/department metadata and routing logic** — the seeded 5-village dataset (`src/data/villages.ts`) has nothing resembling ministries (Agriculture, Animal Husbandry & Dairying, MSME, Rural Development, Finance, Women & Child Development, Social Justice). This is Vamshi's data model to define (see Part 4).
- **Any persistence** — since applications must move from citizen submission → admin review, "session-only React context" (today's architecture) stops being sufficient the moment "Submission" and "Tracking" are real. Someone needs a store applications survive in (see open decision in Part 5).
- **Auth** — no login exists anywhere in the app today, citizen or admin.

## 4. Interfaces you need from your teammates (don't build past these blind)

You own the *visual experience* on both sides; Vamshi owns routing/data API; Jordan owns the approval mechanism. Concretely, that means:

- **From Vamshi:** a data contract for `Application`, `Ministry`/`Department`, `Document` (metadata, not necessarily blob storage), and the routing rule (which scheme/department metadata sends an application to which ministry queue). You need this shape *before* building "Incoming Applications," "Ministry/Department Routing," and "Application Details" — build against a typed mock that matches whatever shape you two agree on, so swapping in Vamshi's real API later is a data-layer swap, not a UI rewrite.
- **From Jordan:** the actual approval/multisig API surface for "Assigned Reviewers" and "Multisig Approval" — ideally an extension of `src/lib/multisig.ts`'s existing `Verifier` / `Attestation` / `SignatureRecord` types rather than a parallel mechanism, since that code already does real ECDSA signing and is a working differentiator. Confirm with Jordan whether they're extending it or replacing it before you wire the admin approval screen to a shape that might change.
- **Until those land:** mock both behind a typed interface (e.g. `src/admin/api/` or similar) with realistic fixture data, exactly like the existing repo already mocks/labels other things (fixture verifier wallets, seeded villages) — see the honesty discipline in Part 6.

## 5. Open decisions the team needs to make (flag these, don't silently pick one)

1. **Does the new citizen wizard replace `/scan → /pulse → /report → /finance → /sanction → /export`, or wrap them as steps inside it?** The task's citizen flow (Voice landing → Profile → Conversation → Recommendations → Business analysis → Schemes → Financial plan → Application → Documents → Review → Consent → Submission → Tracking → Final report) overlaps in *concept* with the existing flow (Business analysis ≈ `/report`, Financial plan ≈ `/finance`) but is a different shape and order. Reusing the existing pages as steps (vs. rebuilding parallel ones) is a real architecture choice with a real time cost either way.
2. **Persistence.** The moment "Submission" and "Tracking" are real, in-memory-only React state can't carry an application from the citizen side to the admin side in a real demo. Minimum options: (a) a small backend Vamshi's API already implies, (b) `localStorage`/`IndexedDB` as a hackathon-scoped simulation with an honest on-screen label, (c) keep citizen and admin as two disconnected demos with canned admin-side fixture data. Pick one before building "Submission."
3. **Admin auth.** Real login or a labeled demo/mock login (matching how `/sanction`'s verifier identities are already explicitly labeled "demo/fixture, not real government accounts")? Given no auth exists anywhere in the repo, a mock login consistent with that existing honesty pattern is the low-risk default — confirm with the team.
4. **Voice scope.** Browser-native `SpeechRecognition`/`speechSynthesis` (free, no key, consistent with this repo's "no API keys required" ethos) vs. a third-party STT/TTS service. Which language(s) — the app is EN/KN today; does voice need to support Kannada, or English-only for the prototype?
5. **Document uploads.** Real file storage needs a backend. For a prototype, is this simulated (accept a file, show it in a list, never actually persist/transmit it — labeled as such) or does it depend on Vamshi's API providing real storage?

Don't resolve these by picking silently — they cross into Vamshi's and Jordan's territory and the team's overall scope/time budget. Surface them explicitly.

## 6. Conventions to keep (this repo is opinionated, follow the grain)

- **Honesty labeling.** Anything simulated, seeded, or mocked gets a plain on-screen label, not just a code comment — see `/sanction`'s "Simulated release — no blockchain transaction" and the demo-verifier labels. Apply the same to mock admin login, mock ministry routing (until Vamshi's API lands), and simulated document storage.
- **i18n parity is a CI gate.** Any new string ships in EN and KN in the same commit; `src/i18n/parity.test.ts` will fail otherwise.
- **Route-level code splitting.** New heavy routes get `React.lazy(...)` in `src/App.tsx`, following the existing pattern for `PulsePage`/`ReportPage` (recharts, react-leaflet) and `SanctionPage` (ethers).
- **Don't break the existing demo path.** `README.md`'s demo path (Scan → Pulse → Report → Finance → Sanction, SC woman/Dinka/dairy/₹1L margin → ₹10L project cost / ₹9L Term Loan) is asserted by a Playwright e2e test. If the citizen wizard subsumes these pages, that test needs a deliberate update, not silent breakage.
- **Test what you add.** Vitest for any new pure logic (routing rules, application state machine transitions), Playwright for any new critical path (e.g., a full citizen submission → admin approval demo path), matching the existing coverage culture.

## 7. Suggested first steps (not a full plan — a starting order)

1. Get the three open interface/architecture questions in Part 5 answered by the team (or at least provisionally decided) before writing UI code that assumes an answer.
2. Stand up `/admin` as its own route subtree in `src/App.tsx` with its own `AdminShell` layout (separate nav from the citizen `Shell.tsx`), gated behind whatever mock login Part 5.3 decides.
3. Define the typed mock data layer for `Application`/`Ministry`/`ReviewerAssignment` (Part 4) so both the citizen "Submission" step and every admin screen build against the same shape from day one.
4. Build admin screens in the task's listed order (they're already a sensible top-to-bottom flow: Login → Dashboard → Incoming Applications → Routing → Details → Documents → Profile → LokScore → Approval Requirement → Assigned Reviewers → Multisig Approval → Status → Audit Trail), reusing `lokScore.ts`'s breakdown rendering (it already has a "per-component reason" pattern from `/pulse`) and `multisig.ts`'s signature flow for the approval screen.
5. Decide citizen-side reuse-vs-rebuild (Part 5.1) before touching `/scan` etc., then build Voice landing and Conversation as the two genuinely new pieces, wiring Recommendations/Schemes to `src/assistant/` where it fits.
