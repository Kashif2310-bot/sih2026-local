# Honesty Ledger — LokPulse / Ishaara (SIH 2026)

Every row here is traceable to a file, a test, or an observed result from this repository — not a claim about intent. Where I could not personally verify something tonight, it says **unverified**, not "should work." Compiled during the overnight run of 2026-09-25; see `docs/handoffs/overnight-2026-09-25.md` for the session that produced most of the citations below.

**How to use this document:** before saying anything to an evaluator, find the matching row. Use the "Safe wording" column verbatim or close to it. Never upgrade a status in the room.

## Status legend

- **LIVE** — actually works end-to-end against the real system right now, verified by an automated test or a real observed run.
- **BUILT, NOT CONNECTED** — the backend/service code exists, is tested, but the browser cannot reach it (confirmed by import-graph tracing, not assumption).
- **LOCAL-ONLY** — works, but entirely client-side; nothing leaves the browser.
- **NOT CONFIGURED** — deployed and reachable, but missing a credential it needs; fails honestly (a real error), never fakes success.
- **MOCKED** — none in this app. If you find something that looks mocked, it's a gap in this ledger — flag it, don't repeat a claim without a row here.

## 1. Scheme knowledge and matching

| Capability | Status | Evidence | Safe wording |
|---|---|---|---|
| Curated scheme catalog | **LOCAL-ONLY** | `src/assistant/data/schemes.ts` ships in the browser bundle; zero backend calls required | "Our scheme data comes from a curated, hand-verified dataset — not a live government API scraping schemes on the fly." |
| Eligibility ranking | **LOCAL-ONLY** | Deterministic ranking in `src/assistant/ranking.ts`, runs entirely client-side, tested in `profileExtraction.test.ts` and others | "Matching is deterministic — the same profile always produces the same ranked list, no randomness, no LLM guessing eligibility." |
| Profile extraction (age/gender/category/income/etc. from free text) | **LOCAL-ONLY** | `src/assistant/profileExtraction.ts` — regex/keyword-based, explicitly NOT an LLM call (see file header); 58 passing tests in `profileExtraction.test.ts` as of tonight | "We extract facts from what you say using deterministic rules, not a language model guessing — if it's not clearly stated, we leave it blank for you to fill in rather than assume." |
| data.gov.in live statistical retrieval | **NOT CONFIGURED** | `supabase/functions/live-scheme-retrieval` deployed (v5, ACTIVE), invoked directly tonight: returns HTTP 503 `{"error":"not_configured","missing":["DATA_GOV_IN_API_KEY","DATA_GOV_IN_RESOURCE_ID"]}` | "Live government statistics are wired up end-to-end, but we haven't found a dataset with a working, registered API key yet — until then, every reply is honestly labelled as coming from our curated dataset, not live government data." |
| Official-source "Phase 3" discovery adapter (`dataGovInAdapter.ts`) | **BUILT, NOT CONNECTED** | `src/backend/services/officialSource/*`, fully tested (`dataGovInAdapter.test.ts` etc.); confirmed via full browser import-graph trace: 0 of 165 modules reachable from `src/main.tsx` come from `src/backend/*` | "There's a second, separate discovery pipeline built and tested on the backend for broader scheme discovery — it isn't wired into the live product yet." |

## 2. AI assistant (text)

| Capability | Status | Evidence | Safe wording |
|---|---|---|---|
| Offline/local AI provider | **LIVE** | `src/assistant/ai/` offline provider, used by default; every reply passes through `ai/responseGuard.ts`'s `validateProviderReply` before being trusted | "The assistant runs on a deterministic offline provider by default — no external AI call is required for the core experience to work." |
| Hosted AI provider (a real LLM) | **BUILT, NOT CONNECTED** | `src/assistant/ai/hostedProvider.ts` exists but `HOSTED_PROXY_URL` is unset by design (see README) — no backend proxy ships in this repo | "A path to a real hosted model exists in the code, deliberately disabled until a backend proxy that keeps the API key server-side is stood up." |

## 3. Voice (Gemini Live native audio)

| Capability | Status | Evidence | Safe wording |
|---|---|---|---|
| Ephemeral token minting | **LIVE** | `gemini-live-token` deployed (v11, ACTIVE, `verify_jwt=true`); invoked live tonight and in prior sessions: mints a real, single-use token, HTTP 200, no long-lived key ever returned | "The browser never holds a Gemini API key. It asks our backend for a short-lived, single-use token, then talks to Google directly." |
| WebSocket connection to Gemini Live | **LIVE (protocol level)** | Tonight's real-server check: minted a real token, sent the app's FULL setup message (5 tools, full system instruction, VAD config, session resumption) through the real transport, and `session.status` reached `"listening"` — `setupComplete` genuinely arrived from Google | "The voice connection to Gemini genuinely establishes and the model is ready to converse." |
| Blob/ArrayBuffer frame decoding | **LIVE** | Real, previously-shipped bug (`geminiLiveTransport.ts` only accepted text frames; Gemini sends binary) found and fixed tonight; 10 tests including two full vertical-slice tests using the real transport | — (implementation detail, not a demo claim) |
| Full spoken back-and-forth with a real human and a real microphone | **unverified** | No microphone is available in this environment; every check tonight and previously was either a scripted Node client or a fake-media-device Playwright browser session | "I have verified the connection and protocol handshake are real and working. I have not personally tested a live, spoken conversation with a real microphone in a real browser — that's the one thing I'd ask you to try live, or take on faith from the architecture." |
| Text fallback when voice fails | **LIVE** | Verified in a real browser (fake mic) tonight and previously: text assistant continues to work, no crash, when voice is unavailable/errors | "If voice doesn't work for any reason — network, browser, microphone — the text assistant keeps working with zero interruption." |
| Gemini API quota protection | **NOT CONFIGURED (gap)** | `gemini-live-token` accepts any caller holding the project's public anon key as its bearer credential (confirmed: `requireCaller()` only checks a well-formed bearer token exists, and Supabase's platform-level `verify_jwt=true` gate accepts the anon key itself as a valid JWT) — there is no per-user or per-IP rate limit on token minting | "Anyone with our public anon key (which ships in the browser bundle by design) can currently request a token — there's no per-user quota cap yet, so the Gemini key needs its own spending/quota limit set on Google's side as the real safety net." |

## 4. Application persistence

| Capability | Status | Evidence | Safe wording |
|---|---|---|---|
| Local application draft (`TrackedApplication`) | **LIVE (local)** | `src/apply/store.ts`, localStorage-backed, always the authoritative immediate write | "Your application is saved on your device the instant you submit it — nothing waits on the network." |
| Remote sync of applications | **LIVE** | `src/platform/remotePersistence.ts`, fire-and-forget to Supabase under the citizen's own anonymous identity; `ownership.integration.test.ts` — 11/11 passing live against Ishara_26 | "Applications also sync to our database, protected so only you can read or change your own record." |
| Cross-citizen isolation on applications | **LIVE** | Same test file: a second authenticated identity cannot read, update, or forge ownership of another's application — proven directly, not assumed from the RLS policy text | "We tested this directly: one citizen's session genuinely cannot read another's application, even with database-level tools." |
| Shared ApplicantProfile persistence | **LIVE** | Added tonight: `src/platform/remoteProfilePersistence.ts`; `sharedProfileOwnership.integration.test.ts` — 7/7 passing live, using real anonymous sign-in, including cross-identity isolation and forge-prevention | "The same protection now covers your assistant profile, not just your formal application." |
| Local persistence of the assistant conversation profile | **unverified as a claim — confirmed absent** | Checked directly tonight: `AssistantContext.tsx`'s `applicantProfile` state has no `localStorage` calls anywhere; it is plain in-memory React state | "Your conversation profile lives in the current browser tab and is now also backed up to our database — but a hard refresh before that sync completes can lose in-progress, not-yet-submitted chat state. Your formal application draft is safe regardless." |
| Reading your own persisted application after a refresh | **LIVE** | `ownership.integration.test.ts`'s "readable again from a BRAND NEW session" test | "If you close the tab and come back, your submitted application is still there." |

## 5. Approvals, admin, notifications (backend-only surfaces)

| Capability | Status | Evidence | Safe wording |
|---|---|---|---|
| Approval workflow (Jordan's `ApprovalCase`, signatures, audit events, chain anchors) | **BUILT, NOT CONNECTED** | `src/backend/services/jordanApprovalPersistence.ts`, Supabase-backed, tested; confirmed unreachable from the browser (import-graph trace) | "The approval/authorization workflow is built and tested on the backend but isn't exposed to the citizen-facing app — it's an admin/officer capability that hasn't been wired to a UI yet." |
| Chain anchors (blockchain-style record) | **BUILT, NOT CONNECTED — always simulated** | Same service; every chain anchor is written with `simulated: true` by design, never a real blockchain transaction | "Any blockchain/anchor language you see in the code is explicitly marked simulated — we do not claim a real chain integration." |
| Admin queries (Prerna's cross-citizen views/routing) | **BUILT, NOT CONNECTED** | `src/backend/services/adminApplicationQueries.ts`, tested; not in the browser's import graph | "There's a tested admin query layer on the backend for officials to review applications across citizens — not wired to a UI in this build." |
| Notifications (dispatch log + preferences) | **BUILT, NOT CONNECTED** | `src/backend/services/notifications/*`, both memory and Supabase implementations, tested; not in the browser's import graph. Even if wired up, `application_notifications` deliberately has no client INSERT policy — a notification log the recipient could forge is not an audit trail | "Notification infrastructure exists and is tested but doesn't send anything today — no SMS/email provider is wired in, and by design a citizen's own browser could never be allowed to write its own 'notification sent' record." |
| Official-source retrieval audit logging | **LIVE (for what's deployed)** | `public.scheme_retrievals` — real rows from real invocations of `live-scheme-retrieval` tonight and in prior sessions, confirmed via direct query: honest `status`/`result_count`, never a key or URL-with-key | "Every live-retrieval attempt — including 'not configured' ones — is logged for audit, and we checked directly that no secret ever lands in that log." |

## 6. Documents

| Capability | Status | Evidence | Safe wording |
|---|---|---|---|
| Document tracking (which documents are required/declared) | **LIVE (metadata only)** | `src/backend/services/documents/*`, `public.application_documents` table, RLS owner-scoped (verified via migration) | "We track which documents you've declared as available and what's still missing." |
| Actual file upload/storage | **NOT IMPLEMENTED** | No Supabase Storage bucket, no upload UI, no upload code path found anywhere in this repository | "This is metadata only — we don't store your actual documents/files anywhere in this build. There's no upload feature." |

## 7. Internationalization

| Capability | Status | Evidence | Safe wording |
|---|---|---|---|
| English / Kannada parity | **LIVE** | `src/i18n/parity.test.ts` — passing, real CI gate | "The interface is fully available in English and Kannada, kept in sync by an automated test." |
| Hindi | **NOT IMPLEMENTED** | Checked directly tonight: `src/i18n/index.ts` has only `en` and `kn` top-level locale objects; no `hi` key exists anywhere | "Hindi is not implemented in this build — only English and Kannada." Do not claim Hindi support. |

## 8. Speech-to-text on the guided /apply flow (separate from Gemini Live)

| Capability | Status | Evidence | Safe wording |
|---|---|---|---|
| Browser-native speech-to-text on /apply | **LIVE, with honest failure handling** | `src/pages/apply/VoicePage.tsx`, uses `window.SpeechRecognition`/`webkitSpeechRecognition` (Chrome-family browsers). Fixed tonight: a 7-second response timeout plus specific error messages for network/not-allowed/service-not-allowed/no-speech, so a browser whose recognition backend never responds (observed in Opera GX) no longer hangs on "Listening..." forever | "Voice input on the apply form works in Chrome/Edge; if your browser's speech engine doesn't respond, you'll now see a clear message and can type instead — it used to hang silently." |

## 9. Data safety

| Capability | Status | Evidence | Safe wording |
|---|---|---|---|
| Service-role credential isolation | **LIVE** | Verified across multiple sessions: bundle scans of `dist/` find no service-role key, no `service_role`-claim JWT, no Gemini/data.gov.in key literal, anywhere in the shipped browser bundle | "The privileged database credential never reaches the browser — we've scanned the actual production bundle to confirm this, not just reviewed the code." |
| Row-level security on citizen data | **LIVE** | `applications` and `applicant_profiles` both have owner-scoped RLS (migrations 202609240001-3), proven with real cross-identity tests, not just policy review | "Row-level security is real and independently tested with two separate real accounts, not just configured and assumed to work." |
