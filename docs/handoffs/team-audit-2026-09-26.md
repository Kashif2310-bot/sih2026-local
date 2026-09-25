# Team audit — full merged state (2026-09-26)

Written after rebasing `overnight/2026-09-25` onto `origin/main`, combining three previously-separate workstreams into one tree for the first time. Every claim below is traceable to a file/line I actually read tonight, not inferred from a commit message. Where something is unverified, it says so.

## 0. Read this first

**This repo currently has three separate persistence paths and two real, working, mutually-incompatible auth systems, plus a third fake one for the admin surface.** None of this is broken — each path works on its own — but nothing routes citizen identity or data between them. A citizen who signs in with the FastAPI phone+OTP flow and a citizen who gets an anonymous Supabase identity via `/apply` are, today, two unrelated people as far as the code is concerned. **This is explicitly not resolved and not mine to resolve** — it needs a real conversation between whoever owns the Supabase/apply-wizard side and Prerana (FastAPI/scan side) about which becomes canonical, or whether both stay. See "Needs human decision" (§7) for the specifics.

## 1. The two citizen-facing flows

### Flow A — Scan → Pulse → Finance → Sanction (the "hyperlocal opportunity radar")

Entry: `/` (LandingPage) or `/scan`. Backed by `src/state/AppContext.tsx` and the FastAPI server under `server/`.

1. **`/scan`** (`src/pages/ScanPage.tsx`) — collects an `EntrepreneurProfile` (age, gender, community, income, business category, available margin, curated village or live geocode query). Submits via `useApp().setProfileAndScan`.
2. **`AppContext.setProfileAndScan`** (`src/state/AppContext.tsx:78-232`) — the real orchestration: resolves location (`resolveCuratedVillage`/`resolveLiveLocation`, `src/lib/resolveLocation.ts`), fetches weather (`src/lib/weather.ts`, real Open-Meteo, wrapped in `retryOnce`), fetches a mandi signal, builds the NSFDC finance plan (`buildSchemePlan`, `src/lib/finance.ts`), computes `computeLokScore` (`src/lib/lokScore.ts:112-239`), opens a real in-browser approval case with real ECDSA signing (`src/lib/approval/service.ts`, `src/lib/multisig.ts`), and **persists the assessment to the FastAPI backend** via `createAssessment` (`src/lib/api.ts`), with `readAuth()?.user.id` attached if the citizen is logged in.
3. **`/pulse/:id` → `/report/:id` → `/finance/:id` → `/sanction/:id` → `/export/:id`** — id-based routes, each wrapped in `AssessmentRoute` (`src/components/AssessmentRoute.tsx`), which re-hydrates from the FastAPI backend (`getAssessment`) if the assessment isn't already in memory, falling back to a locally cached snapshot (`src/lib/assessmentSnapshot.ts`) if the server is unreachable — an assessment never becomes unrecoverable just because the citizen refreshed mid-flow. Legacy plain paths (`/pulse`, `/report`, etc.) redirect to the id-based route for the most recent assessment (`LegacyAssessmentRedirect`).
4. **`/sanction/:id`** (`src/pages/SanctionPage.tsx`) shows real quorum progress and lets allocated reviewers sign with real secp256k1 ECDSA (`src/lib/multisig.ts:170-188`, via `ethers`). A `dataStatus`/`canSanction` gate (`src/lib/sanctionGate.ts`, `src/lib/liveSignals.ts`) blocks signing if live geocoding/competitor/weather data came back incomplete, with a visible retry banner (`src/components/IncompleteSignalsBanner.tsx`, rendered on `/pulse`, `/report`, and `/sanction`).
5. **Chain anchors are explicitly simulated** — `DisbursementAuthorization.simulated: true` (`src/lib/approval/contracts.ts`), and the in-app copy says plainly that `AdaptiveSanction.sol` is not wired and nothing moves on-chain.
6. **`/history`** (`src/pages/HistoryPage.tsx`) lists a logged-in citizen's past assessments from the FastAPI backend, newest first, linking into `/pulse/:id` for each.
7. **`/login`** (`src/pages/LoginPage.tsx`) — phone + OTP against the FastAPI backend. **The OTP is a fixed constant, `"123456"`, for every phone number** (`server/app/routers/auth.py:14`) — confirmed by reading the router directly. The UI discloses this on-screen (`auth.demoOtp` string, shown as a hint). Token issuance and session persistence (`src/lib/authSession.ts`) are real, not mocked — a real bearer token is minted and required for subsequent authenticated calls (`require_user` in the same router).

### Flow B — Assistant + guided Apply wizard

Entry: `/assistant` or `/apply`. Backed by `src/assistant/**` and `src/backend/**` (Supabase), independent of Flow A's `AppContext`/FastAPI.

1. **`/assistant`** (`src/pages/AssistantPage.tsx`) — a text+voice scheme-matching assistant. Text path: deterministic ranking (`src/assistant/ranking.ts` — real composite scoring, `eligibility.score*0.7 + relevance*0.3`, sorted; not just eligible/ineligible filtering — verified via `ranking.test.ts`'s cross-profile ordering assertions). Voice path: real Gemini Live native-audio WebSocket (`src/assistant/voice/geminiLiveVoiceSession.ts`), ephemeral-token minted by the deployed `gemini-live-token` Supabase Edge Function (untouched tonight, as instructed), with a real English/Kannada language selector added last night (`src/assistant/voice/voiceLanguageSelection.ts`) that sets `speechConfig.languageCode: 'kn-IN'` and appends a "respond in Kannada" system-instruction directive when selected.
2. **`/assistant/:id`** — if the assistant is opened from a completed Flow-A scan, `AssistantPage.tsx:24-31` calls `profileFromAssessment()` (`src/assistant/fromAssessment.ts`) to seed the conversation with that scan's profile/location/plan/score, and shows a "answering about this scan" banner (`assistant.caseBanner`). **This is the one real cross-flow bridge that exists today** — it's one-directional (Flow A → Flow B seeding only) and doesn't touch either backend; it's pure client-side state mapping.
3. **`/apply`** (`src/pages/apply/VoicePage.tsx`) and the rest of the guided wizard — browser-native `SpeechRecognition` for dictation (separate from Gemini Live; fixed in an earlier session to fail with a clear message instead of hanging on unsupported browsers), profile confirmation, scheme recommendations, document declaration, consent, submission. Submission persists a `TrackedApplication` to **Supabase**, under the citizen's own anonymous Supabase identity (`src/platform/remotePersistence.ts`, RLS-scoped, proven via `ownership.integration.test.ts` with two real accounts). The assistant's own conversational profile also syncs to Supabase now (`src/platform/remoteProfilePersistence.ts`, added last night).
4. **`/apply/hub`, `/apply/start/:schemeId`, `/apply/track/:trackingId`** (`src/pages/ApplyPage.tsx`) — Adita's canonical `LP-APP-*` application workflow (`src/apply/*`), a different, more structured application model than the guided wizard above; both exist and both write through the same underlying `src/apply/store.ts`.

## 2. Three persistence paths — do not assume any two of these talk to each other

| Path | Used by | Identity model | Real? |
|---|---|---|---|
| **FastAPI + SQLAlchemy** (`server/`, Alembic-migrated) | Flow A: `/scan` assessments, `/history`, `/login` | Phone + OTP (OTP fixed at `123456`), real bearer token | Yes — real DB, real endpoints, `server/tests/` cover it |
| **Supabase (Postgres + RLS)** (`src/backend/**`) | `/apply` wizard's `TrackedApplication`, the assistant's `ApplicantProfile` sync, `gemini-live-token`/`live-scheme-retrieval` Edge Functions | Anonymous Supabase Auth (`signInAnonymously()`) | Yes — real RLS, proven with live cross-identity integration tests |
| **localStorage / in-memory only** (`src/platform/store.ts`, `src/lib/approval/*`, `src/admin/**`) | The entire `/admin/*` dashboard, the `/sanction` approval/quorum/ECDSA UI, `src/apply/store.ts`'s `TrackedApplication` cache | None (or the fake admin login below) | The crypto is real (`ethers`); the storage is same-browser-only, explicitly documented as "NOT a real backend" (`src/platform/store.ts`) |

A fourth, Supabase-backed approval/admin service exists (`src/backend/services/jordanApprovalPersistence.ts`, `adminApplicationQueries.ts`) but is **not reachable from the browser at all** — confirmed by import-graph tracing, unchanged since the last audit. It's real, tested, and unused by any current UI.

## 3. Auth systems

- **FastAPI phone+OTP** (`server/app/routers/auth.py`) — demo OTP, real token/session. Governs Flow A only.
- **Supabase anonymous auth** — governs `/apply` and the assistant's Supabase sync only. A citizen gets a new anonymous identity per browser/device; nothing links it to a FastAPI account.
- **Admin login** (`src/admin/AdminAuthContext.tsx`) — accepts any non-empty password for one of 3 hardcoded demo identities. Not a real auth system at all, and doesn't call either backend above. Governs `/admin/*` only.

**None of the three currently interoperate.** Signing in on `/login` does not affect `/apply`'s Supabase identity or `/admin`'s session, and vice versa.

## 4. What works end-to-end today (verified, file:line above) — summary

LokScore computation and its UI, the NSFDC finance/EMI engine, real Nominatim/Overpass/Open-Meteo geo lookups, real ECDSA multisig signing and adaptive quorum, deterministic scheme ranking (not just filtering), Gemini Live voice with a real Kannada mode, RLS-isolated Supabase persistence for applications and the assistant profile, FastAPI-backed scan history and phone+OTP login, and the one-way scan→assistant profile bridge.

## 5. Built but not fully live

- Supabase-backed `jordanApprovalPersistence`/`adminApplicationQueries` — real, tested, unreachable from any UI (the `/admin`/`/sanction` UI uses the separate localStorage/in-memory path instead — see §2).
- `data.gov.in` Phase-3 discovery adapter (`src/backend/services/officialSource/*`) — built, tested, wired into `createBackendServices`'s `discovery` field, but nothing in the browser's import graph reaches it (confirmed again during tonight's rebase of `createBackendServices.ts`).
- Notification infrastructure (`src/backend/services/notifications/*`) — built, tested, not wired to any UI, and by design `application_notifications` has no client-writable policy.
- Hosted (non-local) AI provider for the assistant's text path — code exists, deliberately disabled (no proxy URL configured).

## 6. Doesn't exist yet

- Any real bridge between the FastAPI and Supabase identity systems, or between either and the admin dashboard's data.
- Real blockchain settlement — explicitly and consistently simulated in both the Supabase-backed and localStorage-backed approval paths.
- File upload/storage (document tracking is metadata only, in both flows).
- A Hindi locale (only `en`/`kn` exist, enforced by `src/i18n/parity.test.ts`).
- A per-user/per-IP quota on the Gemini token-minting endpoint (still just the anon key as bearer credential).

## 7. Needs human decision

- **The big one, per your explicit instruction not to touch it**: which auth/persistence model is canonical going into the demo — FastAPI phone+OTP + SQLAlchemy (Flow A), Supabase anonymous + RLS (Flow B), both kept separate and just clearly narrated as two different demo paths, or a real merge. This needs Prerana in the room. I did not attempt any part of this.
- Whether the admin dashboard should eventually be wired to the real Supabase-backed `adminApplicationQueries`/`jordanApprovalPersistence` services, or stay a same-browser demo — same underlying decision, deferred.
- The `presentationLockdown.test.ts` localhost-policy question from last night is now resolved (added `src/lib/api.ts` to the allowlist, matching the Ollama exception's justification) — mentioning here only so it doesn't look like an open item; it's closed.

## 8. First 15 minutes for a new teammate

1. Read `docs/HONESTY_LEDGER.md` first — it's the source of truth for what to say to an evaluator, corrected as of last night to reflect the real admin/approval reachability situation.
2. Run `npm install && npm run dev` for the frontend. Flow A (`/scan`) needs the FastAPI server running separately (`server/`, see `server/README.md`) or it'll silently fall back to local-only caching. Flow B (`/apply`, `/assistant`) needs `.env.local` Supabase keys (`npm run supabase:probe` to check) or voice/sync will report itself unavailable — never fake success either way.
3. Pick ONE flow to work in first depending on what you're touching — check §2's table before assuming a change to persistence affects "the app"; it very likely only affects one of the three paths.
4. If your task touches auth or which backend is canonical, stop and read §7 before writing code — that decision isn't made yet.
5. Full gate before any commit: `npx vitest run && npx tsc -b && npm run lint && npm run build` — all four, every time; this repo now genuinely needs all four to catch cross-workstream regressions (see the overnight rebase report for why).
