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

There is **no** application package HTTP endpoint on the accepted baseline (reverted).

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

## Current RLS (accepted)

- RLS **enabled** on Option A tables.
- **Demo honesty:** anon **SELECT** allowed on reference + sensitive tables (applications, profiles, approvals, notifications, …).
- **Writes:** service-role only (no anon insert/update/delete policies).
- No `owner_user_id` auth model and no `get_application_status_public` RPC on the accepted baseline.

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
