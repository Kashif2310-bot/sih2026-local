# Overnight report — 2026-09-25 into 2026-09-26

Branch `overnight/2026-09-25`. Continues directly from last night's rebase-and-conflict-resolution session (see the conversation transcript / `backup/overnight-2026-09-25-pre-rebase` tag for that starting point). All four phases below were completed. Nothing was pushed to `main`, nothing was deployed, no secrets were read/printed/committed, no migration was touched, `gemini-live-token` and the WebSocket endpoint fix were left exactly as they were.

## Phase 1 — finish the approved fixes

**1. Six pre-existing tsc/lint issues inherited from `origin/main`** — verified last night, via building `origin/main`'s own tip in an isolated worktree, that all six predate this branch entirely. Fixed the smallest correct way per issue:

- `randomizedCompute.test.ts(30,67)` — genuinely-unused `category` param prefixed with `_`.
- `AuthContext.tsx` (`react/only-export-components`) — split into `AuthContext.tsx` (just `AuthProvider`), `auth-state.ts` (context + type), `useAuth.ts` (the hook) — the exact pattern already established by `AdminAuthContext.tsx`/`admin-auth-state.ts`/`useAdminAuth.ts` elsewhere in this repo. Updated the three real importers (`Shell.tsx`, `HistoryPage.tsx`, `LoginPage.tsx`).
- `AssessmentRoute.tsx` / `HistoryPage.tsx` (`react/set-state-in-effect`) — the two originally-reported lines were provably dead code (`setGate('not-found')`, `setRows(null)`) — the render already handles those cases unconditionally without reading the state being set. Removed them (verified zero behavior change by reading every usage of each variable). Fixing those exposed two further occurrences of the same rule in the same effects that oxlint doesn't report until the first one is gone. One of those (`AssessmentRoute.tsx`'s `hasAssessment(id)` check) I could genuinely derive at render time instead — added a `displayGate` value and removed the setState entirely. The other two (`HistoryPage.tsx`'s pre-fetch `setError(null)`, `AssessmentRoute.tsx`'s pre-fetch `setGate('loading')`) are real, legitimate effect-driven state with no safe render-time equivalent — left as-is with a justifying comment and a targeted `eslint-disable-next-line react/set-state-in-effect`, per your explicit instruction to suppress only when genuinely intentional and to say why.
- `AssistantContext.tsx` (`react-hooks/exhaustive-deps`, ×2) — `reset()`'s `setProfile(seed())` replaced with the exact expression `seed()` computes, inlined (`initialProfile ?? createInitialProfile()`), so the existing `[initialProfile]` dependency array is now actually correct instead of technically wrong-but-tolerated. Same root pattern inherited from `origin/main`'s own `reset()`.

**2. `presentationLockdown.test.ts` allowlist** — added `src/lib/api.ts` (the FastAPI client's hardcoded `http://127.0.0.1:8000` local-dev default), with a comment explicitly matching the existing Ollama exception's justification. `api.ts` itself untouched.

**3. Full gate** — ran clean after both fixes: 103 files / 951 tests, tsc clean, lint clean, build succeeds.

**4. Commits:**
- `f7d767d` — `fix: resolve 6 pre-existing tsc/lint issues inherited from origin/main`
- `06abc2b` — `test: allow src/lib/api.ts's local FastAPI default in presentationLockdown`

## Phase 2 — push

`git fetch origin` confirmed `origin/overnight/2026-09-25` did not exist yet — this branch had never been pushed before. Plain `git push -u origin overnight/2026-09-25`, no force of any kind needed or used. **Pushed successfully.** (Every subsequent phase's commits were also pushed immediately after, so the remote is fully up to date as of this report.)

## Phase 3 — full audit for teammates

Saved to `docs/handoffs/team-audit-2026-09-26.md` (commit `e27693d`). Reproduced in full below, per your instruction to print it in this report too.

---

### [BEGIN team-audit-2026-09-26.md]

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
2. **`/assistant/:id`** — if the assistant is opened from a completed Flow-A scan, `AssistantPage.tsx:24-31` calls `profileFromAssessment()` (`src/assistant/fromAssessment.ts`) to seed the conversation with that scan's profile/location/plan/score, and shows a "answering about this scan" banner (`assistant.caseBanner`). **This is the one real cross-flow bridge that exists today** — it's one-directional (Flow A → Flow B seeding only) and doesn't touch either backend; it's pure client-side state mapping. (A small bug in this bridge — a missing Karnataka district in its state-lookup table — was found and fixed tonight; see Phase 4 below.)
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

### [END team-audit-2026-09-26.md]

---

## Phase 4 — safe, additive improvements (time permitted for two)

Explicitly avoided anything touching auth, either backend, or which flow is canonical, per the hard rule.

**1. Reviewed `fromAssessment.ts`** (the Flow A → Flow B seeding bridge) as requested — no test existed for it. Found a real, small bug: `DISTRICT_STATE` hardcodes 4 of the 5 curated village districts (Mandya, Dharwad, Belagavi, Hassan → Karnataka) but was missing **Tumakuru** (the "Kunigal" curated village, `src/data/villages.ts`) — an equally real Karnataka district, sibling to the other four. A citizen scanning in Tumakuru and opening the assistant from that scan would have silently gotten an undefined `state` in their seeded profile, unlike every other curated village. Fixed by mirroring the existing four entries exactly (same confidence, no new districts invented), and added `fromAssessment.test.ts` (6 tests: field mapping for every business category, state resolution for every curated district including a named regression test for Tumakuru, the "leave undefined rather than guess" behavior for a genuinely unmapped district, the state-name-as-district edge case, and the `rawNotes` summary content). Commit `c9b81de`.

**2. Unit-tested `src/lib/geo.ts` and `src/lib/resolveLocation.ts`'s pure logic** (previously e2e-only, flagged in an earlier audit) — mocked `fetch`/the `./geo` module boundary, zero real network calls, 30 new tests total. Covers: Nominatim/Overpass response parsing, the single-retry behavior, "never fabricate on failure" (null/neutral values rather than a guess, checked explicitly), the two-mirror Overpass race succeeding with only one live mirror, demo mode making zero network calls, curated seed density never being overwritten by live enrichment either way, and — the one I'd flag as most worth a second look — the real, deliberate asymmetry between a failed forward geocode (bails with a clear error, nothing to fall back to) and a failed reverse geocode (proceeds using the raw coordinates, `geocodeOk: false`), which I verified directly from the code rather than assumed. Commit `447b89d`.

**Full gate after every commit in this phase, every time**: passed cleanly. Final state: 106 files / 987 tests, tsc clean, lint clean, build succeeds.

### Further Phase-4-appropriate candidates I did NOT get to (listing per your instruction)

- `src/lib/weather.ts` — same shape as `geo.ts` (real Open-Meteo calls, wrapped in `retryOnce`), no unit test yet, only e2e coverage.
- `src/lib/authSession.ts` — small read/write session-storage helper for the FastAPI token, no test yet.
- `src/lib/api.ts` — the FastAPI client itself; no unit test, though its callers (`AppContext.tsx`, `AssessmentRoute.tsx`, `HistoryPage.tsx`, `AuthContext.tsx`) are exercised indirectly by whatever component tests exist for them.
- `src/citizen/ApplicationDraftContext.tsx` — no direct test found; used throughout the `/apply` wizard, so any bug here would be high-impact, worth a look even though I didn't find evidence of a specific problem.

None of these looked urgent enough to pull in without a specific reason (no e2e-only coverage the way `geo.ts` had, no reported bug the way `fromAssessment.ts` had) — flagging them as reasonable next candidates, not as known issues.

## Needs human decision (consolidated)

1. **Auth/persistence canonicalization** (FastAPI phone+OTP vs Supabase anonymous vs keeping both) — see the audit's §0/§7. Needs Prerana. Not touched.
2. Whether `/admin`/`/sanction` should eventually be wired to the real Supabase-backed approval services, or stay a same-browser demo — same decision, deferred.
3. (Informational, not blocking) The two justified `eslint-disable` suppressions added in Phase 1 (`HistoryPage.tsx`'s pre-fetch error clear, `AssessmentRoute.tsx`'s pre-fetch loading reset) are correct as far as I can verify, but worth a second pair of eyes since they're suppressing a real linter rule rather than satisfying it outright.

## Final gate status

`npx vitest run`: **106 files / 987 tests, all passing.**
`npx tsc -b`: **clean.**
`npm run lint`: **clean.**
`npm run build`: **succeeds** (only the pre-existing large-chunk warning, unrelated to anything tonight).

## Push confirmation

`origin/overnight/2026-09-25` created fresh tonight (didn't exist before), kept up to date after every commit. No force push of any kind was used or needed. Backup tag `backup/overnight-2026-09-25-pre-rebase` (from last night, before the rebase) is still present and untouched, in case you ever need to compare against the pre-rebase state.

## All commits made tonight (this session), oldest first

1. `f7d767d` — fix: resolve 6 pre-existing tsc/lint issues inherited from origin/main
2. `06abc2b` — test: allow src/lib/api.ts's local FastAPI default in presentationLockdown
3. `e27693d` — docs: full-merged-state team audit covering Supabase/FastAPI/localStorage
4. `c9b81de` — fix(assistant): fromAssessment.ts was missing Tumakuru in its district->state map
5. `447b89d` — test(lib): unit-test geo.ts and resolveLocation.ts pure logic

(These sit on top of the 46 commits from last night's rebase, which are also already pushed — the branch is 51 commits ahead of `origin/main`, 0 behind, as of this report.)

## First 15 minutes for you, this morning

1. Read this whole file once, then `docs/handoffs/team-audit-2026-09-26.md` (same content, embedded above too) if you want the full merged-state picture on its own.
2. `git log --oneline origin/main..overnight/2026-09-25 | wc -l` should say 51; `git status` on this branch should be clean.
3. Open a PR from `overnight/2026-09-25` if you're ready to merge into `main` — nothing was pushed to `main`, and given `origin/main` has its own unmerged FastAPI/OTP/history work that this branch also now includes (via the rebase), that merge should be a clean fast-forward or very close to one; double-check before assuming so.
4. Decide on the auth/persistence question with Prerana before anyone builds more UI that assumes one identity system — see "Needs human decision" §1.
5. If you want the two Phase-1 lint suppressions double-checked, they're `src/pages/HistoryPage.tsx` and `src/components/AssessmentRoute.tsx` — search for `eslint-disable-next-line react/set-state-in-effect`, each has a comment explaining why.
6. Nothing was deployed and no secrets were touched — if you want to deploy anything from tonight's work, that's a command you run yourself; none of tonight's changes require a new migration or Edge Function deploy.

Stopping here, as instructed. Did not push to `main`, did not deploy anything.
