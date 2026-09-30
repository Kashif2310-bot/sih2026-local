# Scheme assistant, live retrieval and application workflow — technical notes

> Moved out of the README on 2026-09-30 and re-checked against the code that day. Statements from the old README that no longer matched the code were corrected or removed. For the current status of every capability, [`HONESTY_LEDGER.md`](HONESTY_LEDGER.md) is the source of truth.

## Pipeline

1. **Profile extraction.** `src/assistant/profileExtraction.ts` extracts a profile from the message using deterministic regex and keyword rules; no model is called. It is English-only: Hindi or Kannada input leaves fields blank rather than guessed (`src/citizen/profileFormDraft.test.ts`).
2. **Retrieval.** The profile is matched against the curated catalog (`src/assistant/data/schemes.ts`).
3. **Live retrieval (optional).** If Supabase is configured, the assistant attempts live official-source retrieval (`src/assistant/liveRetrieval.ts`).
4. **Evidence merge.** Live evidence is merged in without changing any eligibility rule (`src/assistant/evidenceMerge.ts`).
5. **Eligibility and ranking.** `src/assistant/eligibility.ts` and `src/assistant/ranking.ts` apply deterministic rules. The match score and status are computed, never produced by a model.
6. **Explanation.** An AI provider explains the evidence. Every reply passes `validateProviderReply` (`src/assistant/ai/responseGuard.ts`) before it is shown.

## AI providers

Providers are tried in order (`src/assistant/ai/index.ts`); the first one available answers.

1. **Local Ollama (optional).** Used when a local server answers the `/api/tags` health check at `http://localhost:11434` within 1.2 s. The default model is `llama3.1` (`src/assistant/aiConfig.ts`). To try it:
   1. Install [Ollama](https://ollama.com) and run `ollama serve`.
   2. Run `ollama pull llama3.1`.
   3. Reload `/assistant`.
2. **Hosted model (disabled).** `src/assistant/ai/hostedProvider.ts` exists, but `HOSTED_PROXY_URL` is unset. A hosted model must only ever be called through a backend proxy that keeps its key server-side. No such proxy ships in this repo.
3. **Deterministic offline provider (the default).** Makes no external AI call.

## Source-status line

Every assistant reply shows what happened to live retrieval that turn (`src/components/assistant/SourceStatusBadge.tsx`; logic in `src/assistant/orchestrator.ts`):

| Label | Meaning |
|---|---|
| **Verified scheme knowledge base** | Live retrieval is not configured, so it was never attempted. The curated catalog was used. |
| **Official live sources checked · ⟨time⟩** | Live retrieval is configured and at least one source was queried successfully this turn. |
| **Live government sources unavailable · showing verified scheme data** | Live retrieval is configured, but every source failed or timed out. The curated catalog was used, and the ranking is unchanged. |

## Curated scheme catalog

`src/assistant/data/schemes.ts` holds 9 hand-curated central and state schemes:
- NSFDC Micro Finance Scheme
- NSFDC Term Loan Scheme
- PMEGP
- PM Mudra Yojana
- Stand-Up India
- PM Vishwakarma
- NBCFDC Term Loan Scheme
- Kudumbashree Microenterprise Support
- PMMSY

Each entry carries its official source URL and a `lastVerifiedDate`, and is marked `confidence: 'reference'`, meaning it must be re-verified against the official source before being relied on.

Live retrieval only ever **adds** clearly sourced context to a scheme already in the catalog. It never creates a scheme, and never changes an eligibility rule, a loan amount or a document requirement.

Scheme content (names, descriptions, eligibility text) is English-only, to avoid mistranslating financial and legal specifics. The interface around it follows the app's English/Kannada toggle.

## Live government-source retrieval

**Current state: not configured.** The `live-scheme-retrieval` Edge Function is deployed, but it returns `503 not_configured` until `DATA_GOV_IN_API_KEY` and `DATA_GOV_IN_RESOURCE_ID` are set as Supabase secrets.

**Sources investigated when this was built:**
- **[data.gov.in](https://data.gov.in)** has a genuine self-service API: free registration and a real key. It is the one live source implemented.
- **myScheme.gov.in** prohibits automated access in its Terms of Use. Its only sanctioned integration route, API Setu, is a partner-approval process. It is not scraped or called anywhere in this codebase.
- **Individual ministries** (PMEGP/KVIC, Mudra, NSFDC and others): no public self-service API was found.

**What data.gov.in provides:** the PMEGP/MSME datasets found are statistical data, such as units sanctioned or subsidy disbursed by state and year. They contain no eligibility rules, loan tables or scheme identifiers. So this evidence is classified `live_contextual`: useful context, but never proof about one specific scheme. It never changes eligibility, loan amounts or the computed match score.

**Evidence layer (`src/assistant/evidence/`)**

| Step | File | What it does |
|---|---|---|
| Fetch and normalize | `dataGovInConnector.ts` | Fetches and normalizes records |
| Deduplicate | `dedup.ts` | Removes duplicates; never merges across states |
| Bind to a scheme | `schemeBinding.ts` | Binds a record to one scheme only when the record itself carries an explicit scheme id or a matching official application URL |
| Report coverage | `coverage.ts` | Reports coverage honestly; `claimsAllGovernmentSchemesChecked` is hard-coded `false` |

Records that cannot be bound surface separately as contextual evidence.

**Timing:** calls are real-time per chat turn. The frontend times out at 4 s (`LIVE_RETRIEVAL_TIMEOUT_MS`) and the Edge Function at 6 s. Nothing is pre-fetched or refreshed on a schedule.

**Audit log:** every attempt is written to `scheme_retrievals`, including "not configured" attempts. The `schemes` table exists as cache infrastructure, but the Edge Function does not write to it.

**Trust model.** Every piece of evidence carries a `verification_status` (`src/assistant/types.ts`):

| Status | Meaning |
|---|---|
| `verified_local` | From the curated catalog, or live retrieval was not attempted this turn |
| `live_official` | Fetched this turn from an allowlisted official domain **and** deterministically bound to one scheme |
| `live_contextual` | Fetched from an allowlisted official domain but not bindable to one scheme; context only |
| `live_unverified` | Reserved; not currently produced (anything that fails validation is dropped) |
| `unavailable` | Live retrieval was attempted and failed |

**Allowlist:** every live source URL must be `https://` and on the official-domain allowlist, `src/assistant/trustedSources.ts`. That list is mirrored for the Edge Function in `supabase/functions/_shared/trustedDomains.ts`. Anything else is dropped. Field-level validation lives in `validateLiveEvidenceItems()` (`src/assistant/liveRetrieval.ts`) and `isWellFormedRecord()` (`src/assistant/evidence/governmentEvidenceOrchestrator.ts`). A malformed item is dropped, never repaired or guessed at.

## Supabase setup

Supabase backs:
- the `/apply` application sync;
- the assistant profile sync;
- voice token minting;
- live retrieval.

Without it, the text assistant still works fully on the curated catalog.

1. Create a project at [supabase.com](https://supabase.com).
2. Copy `.env.example` to `.env.local` and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. The anon key is public by design; access is enforced by row-level security. Never put a service-role key in a `VITE_` variable.
3. Link the project and apply every migration in `supabase/migrations/`: `npx supabase db push`.
4. Deploy the Edge Functions:
   - `npx supabase functions deploy gemini-live-token`
   - `npx supabase functions deploy live-scheme-retrieval`
5. Set the secrets:
   - `npx supabase secrets set GEMINI_API_KEY=...` for voice.
   - Optionally, `DATA_GOV_IN_API_KEY=...` and `DATA_GOV_IN_RESOURCE_ID=...` for live retrieval.
6. Check the hosted schema: `npm run supabase:probe`.

For a local Supabase stack, use `npm run supabase:start`, `supabase:status` and `supabase:stop` (see `package.json`).

**Data isolation.** `applications` and `applicant_profiles` have owner-scoped row-level security, under each citizen's anonymous Supabase identity (migrations `202609240001`–`202609240003`). Tests with two real, separate identities prove that one citizen cannot read, update or forge ownership of another's records. `application_notifications` deliberately has no client INSERT policy.

## Application workflow channels (`/apply/hub`)

`src/apply/channels.ts` defines four ways to "submit". Only one of them can ever mark an application as filed with the government:

| Channel | What happens | Filed with the government? |
|---|---|---|
| **Government API** | POSTs the packet to `VITE_GOV_APPLY_API_URL` | Only if that API returns an application id (`submitted_to_government`). If the URL is unset or unreachable, the result is `government_api_unavailable`; a response without an id gives `government_api_rejected`. |
| **Assisted** | Prepares the packet and routes it through the Ishara review workflow | Never (`assisted_packet_ready`) |
| **Guided** | Prepares the packet, with the scheme's official portal link | Never (`guided_packet_ready`) |
| **Simulation** | Explicitly chosen; creates an `LP-SIM-…` tracking id labelled "Simulation recorded" | Never (`simulation_recorded`) |

Tracked applications are written to the device first (`src/apply/store.ts`), then synced to Supabase. They are not a government register.
