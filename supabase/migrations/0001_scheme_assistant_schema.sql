-- AI Government Scheme Assistant — Supabase schema.
--
-- Minimal by design (per the actual architecture implemented, not an
-- aspirational one): two tables. No auth, no user accounts, no
-- conversation/profile persistence — the assistant's in-session state
-- (src/assistant/state/AssistantContext.tsx) already works without a
-- backend and this schema does not need to duplicate it. See README.md
-- for why profile persistence was deliberately left out.
--
-- Apply with: supabase db push   (or paste into the SQL editor)

-- ============================================================================
-- schemes — a server-side cache/mirror of scheme evidence. The app's
-- primary source of truth for scheme content is still the curated
-- TypeScript dataset (src/assistant/data/schemes.ts), which works with
-- zero backend. This table exists so a live-retrieved or admin-curated
-- scheme record can be cached here and read by the Edge Function without
-- re-fetching an external API on every chat turn — it is a cache, not a
-- replacement for the local dataset.
-- ============================================================================
create table if not exists public.schemes (
  id text primary key,                    -- matches src/assistant/data/schemes.ts scheme ids where applicable
  name text not null,
  description text not null default '',
  scope text not null check (scope in ('central', 'state')),
  state text,                             -- non-null only when scope = 'state'
  sector text[] not null default '{}',    -- normalized sector tags, see src/assistant/lexicon.ts
  eligibility jsonb not null default '{}'::jsonb,   -- mirrors SchemeEligibilityCriteria shape
  benefits jsonb not null default '{}'::jsonb,      -- loan/subsidy/interest info
  application jsonb not null default '{}'::jsonb,   -- documents + applicationSteps
  source_url text not null,
  source_name text not null,
  source_type text not null check (source_type in ('official_open_data', 'official_ministry', 'official_other')),
  verification_status text not null default 'unavailable'
    check (verification_status in ('verified_local', 'live_official', 'live_unverified', 'unavailable')),
  last_verified_at timestamptz,
  retrieved_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint schemes_source_url_https check (source_url like 'https://%')
);

comment on table public.schemes is
  'Server-side cache of scheme evidence for the AI assistant. The curated local TypeScript dataset (src/assistant/data/schemes.ts) remains the primary, always-available source; this table is optional infrastructure for caching live-retrieved records.';

-- ============================================================================
-- scheme_retrievals — an audit log of every live-retrieval attempt, so
-- "was live data actually checked, and did it work" is answerable from the
-- database, not just inferred from the chat UI. Written by the
-- live-scheme-retrieval Edge Function on every invocation, success or
-- failure.
-- ============================================================================
create table if not exists public.scheme_retrievals (
  id bigint generated always as identity primary key,
  source text not null,                   -- e.g. 'data.gov.in'
  query text not null,                    -- what was asked for (scheme ids / state), as sent to the source
  retrieved_at timestamptz not null default now(),
  status text not null check (status in ('success', 'failure', 'not_configured')),
  result_count integer not null default 0,
  error text                              -- populated only when status = 'failure'
);

comment on table public.scheme_retrievals is
  'Audit log of live-retrieval attempts (success, failure, or skipped because not configured) — one row per Edge Function invocation.';

create index if not exists scheme_retrievals_retrieved_at_idx on public.scheme_retrievals (retrieved_at desc);

-- ============================================================================
-- Row Level Security. No authentication is used anywhere in this app (see
-- README — deliberately not introduced, since nothing here requires it),
-- so both tables are readable by the anon key the frontend already ships
-- (Supabase's anon key is public-by-design, not a secret) and writable
-- only by the service role the Edge Function runs as. The frontend never
-- writes to either table directly.
-- ============================================================================
alter table public.schemes enable row level security;
alter table public.scheme_retrievals enable row level security;

create policy "schemes are publicly readable"
  on public.schemes for select
  using (true);

create policy "scheme_retrievals are publicly readable"
  on public.scheme_retrievals for select
  using (true);

-- No insert/update/delete policies are created for the anon/authenticated
-- roles on either table — by default that means no client-side writes are
-- possible. Only the service role (used exclusively inside the Edge
-- Function, never exposed to the browser) bypasses RLS to write.
