-- Option A reconciled persistence schema.
-- Depends on: 0001_scheme_assistant_schema.sql (Kashif scheme CACHE — do not replace).
-- Scheme SoT remains src/assistant/data/schemes.ts (text ids: nsfdc-micro-finance, …).
-- Application identity follows Adita (LP-APP-…).
-- Approval records follow Jordan src/lib/approval/* shapes (jsonb snapshots).

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Ministry / department mapping (Prerna admin routing) — independent of scheme cache
-- ---------------------------------------------------------------------------

create table if not exists public.ministries (
  id text primary key,
  code text not null unique,
  name_en text not null,
  name_kn text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.departments (
  id text primary key,
  ministry_id text not null references public.ministries (id) on delete restrict,
  code text not null,
  name_en text not null,
  name_kn text not null default '',
  created_at timestamptz not null default now(),
  unique (ministry_id, code)
);

create table if not exists public.scheme_ministry_map (
  scheme_id text not null,                 -- schemes.ts id (not FK to cache; SoT is TS)
  ministry_id text not null references public.ministries (id) on delete restrict,
  department_id text references public.departments (id) on delete set null,
  primary key (scheme_id, ministry_id)
);

-- ---------------------------------------------------------------------------
-- Shared ApplicantProfile persistence (Kashif src/shared/applicantProfile.ts)
-- ---------------------------------------------------------------------------

create table if not exists public.applicant_profiles (
  id uuid primary key default gen_random_uuid(),
  applicant_id text unique,                -- optional external/display id
  profile jsonb not null,                  -- full ApplicantProfile envelope
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists applicant_profiles_updated_at_idx
  on public.applicant_profiles (updated_at desc)
  where deleted_at is null;

-- ---------------------------------------------------------------------------
-- Adita applications (TrackedApplication + workflow artifacts)
-- ---------------------------------------------------------------------------

create table if not exists public.applications (
  application_id text primary key,         -- LP-APP-XXXXXXXXXXXXXXXX
  scheme_id text not null,                 -- schemes.ts id
  scheme_name text not null default '',
  status text not null,
  channel text,
  outcome text,
  filed_with_government boolean not null default false,
  simulation boolean not null default false,
  tracking_id text,
  government_application_id text,
  official_portal_url text,
  honest_label text,
  detail text,
  next_steps jsonb not null default '[]'::jsonb,
  packet jsonb,
  consent jsonb,
  conversation jsonb,
  snapshot jsonb,                          -- FrozenSnapshot
  submission_package jsonb,
  status_history jsonb not null default '[]'::jsonb,
  profile_ref uuid references public.applicant_profiles (id) on delete set null,
  ministry_id text references public.ministries (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists applications_scheme_id_idx on public.applications (scheme_id);
create index if not exists applications_status_idx on public.applications (status);
create index if not exists applications_updated_at_idx on public.applications (updated_at desc);

create table if not exists public.application_documents (
  id uuid primary key default gen_random_uuid(),
  application_id text not null references public.applications (application_id) on delete cascade,
  doc_key text not null,
  label text not null default '',
  declaration text not null default 'missing',
  storage_path text,
  content_hash text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (application_id, doc_key)
);

create table if not exists public.application_events (
  id uuid primary key default gen_random_uuid(),
  application_id text not null references public.applications (application_id) on delete cascade,
  event_type text not null,
  actor_ref text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists application_events_app_created_idx
  on public.application_events (application_id, created_at);

create table if not exists public.recommendations (
  id uuid primary key default gen_random_uuid(),
  applicant_profile_id uuid references public.applicant_profiles (id) on delete cascade,
  application_id text references public.applications (application_id) on delete cascade,
  scheme_id text not null,
  rank integer,
  score numeric,
  payload jsonb not null default '{}'::jsonb,
  computed_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Jordan approval persistence (stores Jordan runtime objects as jsonb)
-- ---------------------------------------------------------------------------

create table if not exists public.approval_cases (
  application_id text primary key references public.applications (application_id) on delete cascade,
  case_json jsonb not null,                -- ApprovalCase
  status text not null,
  snapshot_digest text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.approval_signatures (
  id uuid primary key default gen_random_uuid(),
  application_id text not null references public.approval_cases (application_id) on delete cascade,
  reviewer_id text not null,
  address text not null,
  signature text not null,
  signed_at timestamptz not null,
  unique (application_id, reviewer_id)
);

create table if not exists public.approval_audit_events (
  event_id text primary key,
  application_id text not null references public.applications (application_id) on delete cascade,
  event_type text not null,
  event_timestamp bigint not null,
  actor_ref text,
  data_ref text,
  prev_event_hash text,
  event_hash text not null,
  event_json jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists approval_audit_app_idx
  on public.approval_audit_events (application_id, event_timestamp);

create table if not exists public.chain_anchors (
  id uuid primary key default gen_random_uuid(),
  application_id text not null references public.applications (application_id) on delete cascade,
  report_hash text not null,
  authorization_digest text,
  quorum_required integer,
  mentor_required boolean not null default false,
  tx_ref text,
  chain_id text,
  simulated boolean not null default true,
  payload jsonb not null default '{}'::jsonb,
  anchored_at timestamptz not null default now()
);

create index if not exists chain_anchors_application_idx on public.chain_anchors (application_id);

-- ---------------------------------------------------------------------------
-- updated_at helper
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists applicant_profiles_set_updated_at on public.applicant_profiles;
create trigger applicant_profiles_set_updated_at
  before update on public.applicant_profiles
  for each row execute function public.set_updated_at();

drop trigger if exists applications_set_updated_at on public.applications;
create trigger applications_set_updated_at
  before update on public.applications
  for each row execute function public.set_updated_at();

drop trigger if exists approval_cases_set_updated_at on public.approval_cases;
create trigger approval_cases_set_updated_at
  before update on public.approval_cases
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.ministries enable row level security;
alter table public.departments enable row level security;
alter table public.scheme_ministry_map enable row level security;
alter table public.applicant_profiles enable row level security;
alter table public.applications enable row level security;
alter table public.application_documents enable row level security;
alter table public.application_events enable row level security;
alter table public.recommendations enable row level security;
alter table public.approval_cases enable row level security;
alter table public.approval_signatures enable row level security;
alter table public.approval_audit_events enable row level security;
alter table public.chain_anchors enable row level security;

-- Public read for reference/mapping tables (demo honesty: no auth product yet).
-- Writes remain service-role only (no insert/update/delete policies for anon).
drop policy if exists ministries_public_read on public.ministries;
create policy ministries_public_read on public.ministries for select using (true);

drop policy if exists departments_public_read on public.departments;
create policy departments_public_read on public.departments for select using (true);

drop policy if exists scheme_ministry_map_public_read on public.scheme_ministry_map;
create policy scheme_ministry_map_public_read on public.scheme_ministry_map for select using (true);

-- Sensitive tables: readable in demo via anon for status UIs; writes service-role only.
-- When real auth lands, tighten these policies — do not broaden further.
drop policy if exists applications_public_read on public.applications;
create policy applications_public_read on public.applications for select using (true);

drop policy if exists application_events_public_read on public.application_events;
create policy application_events_public_read on public.application_events for select using (true);

drop policy if exists application_documents_public_read on public.application_documents;
create policy application_documents_public_read on public.application_documents for select using (true);

drop policy if exists applicant_profiles_public_read on public.applicant_profiles;
create policy applicant_profiles_public_read on public.applicant_profiles for select using (true);

drop policy if exists recommendations_public_read on public.recommendations;
create policy recommendations_public_read on public.recommendations for select using (true);

drop policy if exists approval_cases_public_read on public.approval_cases;
create policy approval_cases_public_read on public.approval_cases for select using (true);

drop policy if exists approval_signatures_public_read on public.approval_signatures;
create policy approval_signatures_public_read on public.approval_signatures for select using (true);

drop policy if exists approval_audit_public_read on public.approval_audit_events;
create policy approval_audit_public_read on public.approval_audit_events for select using (true);

drop policy if exists chain_anchors_public_read on public.chain_anchors;
create policy chain_anchors_public_read on public.chain_anchors for select using (true);

-- RLS verification helper (service role)
create or replace function public.verify_rls_enabled()
returns table(table_name text, rls_enabled boolean)
language sql
security definer
set search_path = public
as $$
  select c.relname::text, c.relrowsecurity
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and c.relname in (
      'schemes',
      'scheme_retrievals',
      'ministries',
      'departments',
      'applicant_profiles',
      'applications',
      'approval_cases',
      'chain_anchors'
    )
  order by 1;
$$;

revoke all on function public.verify_rls_enabled() from public;
grant execute on function public.verify_rls_enabled() to service_role;
