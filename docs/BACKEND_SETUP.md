# Backend setup (accepted Option A)

Accepted baseline: **`feat/backend-option-a-rework` @ `6c541d8`**

## Prerequisites

- Node 20+
- Hosted Supabase project with migrations already applied (shared team DB), **or** local Docker + `supabase start`
- Never put service-role / secret keys in `VITE_*` variables

## Environment

Copy `.env.example` → `.env.local` (gitignored):

| Variable | Where | Purpose |
|---|---|---|
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | browser | Public client |
| `SUPABASE_URL` + anon/publishable | server/tests | Same project |
| `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_SECRET_KEY` | server/tests only | Bypasses RLS |
| `SUPABASE_INTEGRATION` | tests | `1` to run hosted integration tests |
| `DATA_GOV_IN_*` | Edge / server | Optional live OGD (Kashif Edge + Phase 3 discovery) |

## Migration order (accepted)

1. `0001_scheme_assistant_schema.sql` — Kashif schemes cache + `scheme_retrievals`
2. `202609170001_option_a_reconciled.sql` — profiles, Adita apps (`LP-APP-*`), Jordan tables, ministries, demo public-read RLS
3. `202609170002_official_discovery_retrievals.sql` — Phase 3 discovery audit
4. `202609170003_application_submission.sql` — submission columns
5. `202609170004_application_notifications.sql` — notification prefs/log
6. `202609170005_canonical_application_status.sql` — `applications.application_status`
7. Seed: `supabase/seed/scheme_cache_v0.sql`

Do **not** apply archived Phase 1/2 UUID registry migrations.  
Do **not** apply unapproved RLS-hardening proposals (e.g. a conflicting `202609170004_rls_hardening`).

Shared hosted DB is expected to already have 0001–0005 + seed.

## Identity & status (do not reinvent)

- Application identity: Adita **`LP-APP-*`** / `TrackedApplication`
- Raw workflow text: `applications.status` / `status_history`
- Canonical persisted status: **`applications.application_status`** (`draft` \| `awaiting_consent` \| `submitted` \| `tracked`)
- No package exposure endpoint on this baseline
- No new auth / owner_user_id product on this baseline

## Current RLS

- Enabled on core tables
- Anon **read** allowed (demo); writes service-role only
- Tighten only after an explicit team auth decision

## Commands

```bash
npm install
npm run supabase:probe      # read-only table reachability
npm run supabase:verify     # SQL checks (needs db query access)
npm test
npm run lint
npm run build
# after keys + schema:
#   SUPABASE_INTEGRATION=1 npm run test:integration
npm run test:e2e
```

Local Docker (optional):

```bash
npm run supabase:start
npm run supabase:env
npm run supabase:reset
```

## Teammate verification

```bash
git fetch origin
git checkout feat/backend-option-a-rework   # or a PR that ports safe Vamshi commits
npm install
npm test && npm run lint && npm run build
npm run supabase:probe
```
