# Backend integration contracts

Accepted baseline: **`feat/backend-option-a-rework` @ `6c541d8`**

Factory:

```ts
import { createBackendServices } from './backend'
const backend = createBackendServices({ mode: 'auto' })
```

Modes: `memory` | `hybrid` | `supabase`. Browser defaults to hybrid (scheme reads may use anon; writes stay memory unless a service/session client is injected).

---

## Who calls what

| Teammate | Call | Accepts | Returns | Auth |
|---|---|---|---|---|
| **Kashif (AI/voice)** | `backend.sharedProfiles.*` | `ApplicantProfile` (`src/shared/applicantProfile.ts`) | persisted profile | service role for writes |
| **Kashif (live evidence)** | `backend.liveRetrieval.retrieve({ schemeIds, state? })` | schemes.ts ids only | `{ ok, items, errorCode? }` — never invents facts | Edge Function via anon; secrets stay server-side |
| **Anyone (schemes)** | `backend.schemeCatalog.get/list` | text scheme id | `GovernmentScheme` from **schemes.ts** | none (local SoT) |
| **Adita** | `backend.aditaApplications.save/get/list` | `TrackedApplication`, `LP-APP-*` | same | service role for writes |
| **Prerna** | `backend.admin.listRecent/getDetail/routeForCategory` | status filters / category | summaries + ministry routing | service role preferred; demo RLS currently allows anon SELECT of full rows |
| **Jordan** | `backend.jordanApprovals.*` | Jordan `ApprovalCase` / signatures / audit / anchors | persisted copies | service role; chain anchors always `simulated: true` |
| **Canonical status** | ApplicationStatusStore / `withCanonicalStatusPersistence` | Adita saves | persists `applications.application_status` ∈ `draft\|awaiting_consent\|submitted\|tracked` | service role |
| **Notifications** | notification services | LP-APP keyed prefs/log | dispatch log only | service role writes; demo public read |
| **Phase 3 discovery** | `backend.discovery` | discovery query | candidates + honesty notes | server-only `DATA_GOV_IN_*`; does **not** replace Edge Function |

Legacy UUID `profiles` / `schemes` / `applications` on `BackendServices` are **compat only**.

There is **no** application package HTTP endpoint on the accepted baseline (reverted in `6c541d8`; it was a read-only `GET .../package` that returned any application by id to any caller, with no ownership check). Browser persistence now goes direct-to-Postgres under RLS instead — see **Browser persistence** below.

---

## Stable IDs & statuses

| Kind | Values |
|---|---|
| Scheme ids | From `src/assistant/data/schemes.ts` (e.g. `nsfdc-micro-finance`) |
| Application ids | `LP-APP-` + 16 hex (`isApplicationId`) |
| Adita workflow/outcome | `status_history` / `outcome` on TrackedApplication; DB `applications.status` holds that raw text |
| Canonical status | Separate column `applications.application_status`: `draft`, `awaiting_consent`, `submitted`, `tracked` |
| Approval status | Jordan `open` \| `collecting` \| `quorum_met` \| `authorized` \| `blocked` |
| Ministry ids | Prerna `MinistryId` (`social_justice`, `msme`, …) |

---

## Current RLS

- RLS **enabled** on Option A tables.
- **Ownership (migrations `202609240001`–`202609240003`):** `applications` and
  `applicant_profiles` carry `owner_user_id uuid` defaulting to `auth.uid()`.
  - An **authenticated** caller may SELECT/INSERT/UPDATE **only their own** rows.
    Ownership cannot be forged (the INSERT check compares against `auth.uid()`),
    and there is deliberately **no DELETE policy**.
  - `application_events` / `application_documents` inherit ownership through
    their parent application, and allow an owner to INSERT for applications they
    own. `application_notifications` has **no** client INSERT policy — a
    notification log the recipient can forge is not an audit trail.
- **Backward compatible:** rows with `owner_user_id IS NULL` (everything created
  before this, plus every service-role write) remain publicly readable exactly as
  before. Only owned rows are private.
- **Service role** bypasses RLS, so `src/backend/*` is unaffected.
- Still no `get_application_status_public` RPC.

**Proven, not asserted:** `src/backend/supabase/ownership.integration.test.ts`
runs two real authenticated users against the live project and asserts
cross-user read/update isolation, anon lockout, and unforgeable ownership.

### Browser persistence

`src/platform/remotePersistence.ts` mirrors each saved `TrackedApplication` to
Supabase under the citizen's **own** identity, reusing
`createSupabaseAditaApplicationPersistence` rather than duplicating it. It is
best-effort and fire-and-forget: localStorage remains the authoritative
immediate write, so a failure loses nothing.

**Gated on an auth provider.** It calls `signInAnonymously()`, and anonymous
sign-ins are a *project setting* that is currently **disabled** on Ishara_26
(`anonymous_provider_disabled`), so every sync is a no-op today. Enabling that
one toggle activates the whole path with no code change.

---

## Simulated vs real

| Surface | Reality |
|---|---|
| Scheme facts | Curated `schemes.ts` (+ optional `public.schemes` cache) |
| Live evidence | Real only when Edge Function + secrets configured; else explicit failure |
| Government filing | Not claimed unless Adita outcome is truly `submitted_to_government` |
| Chain anchors | Always `simulated: true` |
| Canonical `submitted` | Means workflow issued an application id / submission attempt — **not** government confirmation |

---

## Sensitive fields / secrets

Never put `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_SECRET_KEY` in `VITE_*` vars.  
Service-role clients must not be constructed in the browser.
