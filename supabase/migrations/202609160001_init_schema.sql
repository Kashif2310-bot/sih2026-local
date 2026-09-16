-- LokPulse Phase 1 — core schema
-- Sensitive citizen PII must stay off-chain; chain_anchors hold hashes only.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Roles / profiles (auth.users is managed by Supabase Auth)
-- ---------------------------------------------------------------------------

create type public.user_role as enum ('citizen', 'reviewer', 'admin', 'service');
create type public.verification_status as enum (
  'unverified',
  'prototype_indicative',
  'verified',
  'stale',
  'rejected'
);
create type public.jurisdiction_level as enum ('central', 'state', 'ministry', 'department');
create type public.scheme_status as enum ('active', 'draft', 'retired');
create type public.application_status as enum (
  'draft',
  'profile_incomplete',
  'recommended',
  'fields_pending',
  'documents_pending',
  'citizen_review',
  'consent_pending',
  'ready_to_submit',
  'submitted',
  'under_review',
  'approval_pending',
  'approved',
  'rejected',
  'disbursement_pending',
  'disbursed',
  'withdrawn'
);
create type public.submission_mode as enum ('authorized_api', 'assisted', 'none');
create type public.approval_status as enum ('open', 'quorum_met', 'released', 'cancelled');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role public.user_role not null default 'citizen',
  display_name text,
  locale text not null default 'en',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.applicant_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  conversation_id uuid,
  locale text not null default 'en',
  -- Structured V2 profile JSON (field wrappers with confidence). Avoid raw Aadhaar here.
  profile jsonb not null default '{}'::jsonb,
  sensitivity_tier smallint not null default 1 check (sensitivity_tier between 1 and 3),
  consent_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index applicant_profiles_user_id_idx on public.applicant_profiles (user_id)
  where deleted_at is null;

-- ---------------------------------------------------------------------------
-- Government scheme registry
-- ---------------------------------------------------------------------------

create table public.ministries (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name_en text not null,
  name_kn text not null,
  level public.jurisdiction_level not null default 'central',
  created_at timestamptz not null default now()
);

create table public.departments (
  id uuid primary key default gen_random_uuid(),
  ministry_id uuid not null references public.ministries (id) on delete restrict,
  code text not null,
  name_en text not null,
  name_kn text not null,
  created_at timestamptz not null default now(),
  unique (ministry_id, code)
);

create table public.schemes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name_en text not null,
  name_kn text not null,
  jurisdiction public.jurisdiction_level not null,
  owning_department_id uuid not null references public.departments (id) on delete restrict,
  owning_ministry_id uuid not null references public.ministries (id) on delete restrict,
  status public.scheme_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.scheme_sources (
  id uuid primary key default gen_random_uuid(),
  source_type text not null,
  title_en text not null,
  url text,
  publisher text not null,
  published_at timestamptz,
  retrieved_at timestamptz not null default now(),
  confidence numeric(4, 3) not null default 0.5 check (confidence >= 0 and confidence <= 1),
  status public.verification_status not null default 'unverified',
  notes_en text not null default '',
  created_at timestamptz not null default now()
);

create table public.scheme_versions (
  id uuid primary key default gen_random_uuid(),
  scheme_id uuid not null references public.schemes (id) on delete cascade,
  version text not null,
  effective_from timestamptz not null,
  effective_to timestamptz,
  benefits jsonb not null default '[]'::jsonb,
  loan_terms jsonb,
  subsidies jsonb not null default '[]'::jsonb,
  procedure_summary_en text not null default '',
  procedure_summary_kn text not null default '',
  official_urls jsonb not null default '[]'::jsonb,
  documents jsonb not null default '[]'::jsonb,
  eligibility_summary_en text not null default '',
  eligibility_summary_kn text not null default '',
  eligibility_hints jsonb not null default '{}'::jsonb,
  verification_status public.verification_status not null default 'unverified',
  published_at timestamptz,
  retrieved_at timestamptz not null default now(),
  freshness_score numeric(4, 3) not null default 0 check (freshness_score >= 0 and freshness_score <= 1),
  created_at timestamptz not null default now(),
  unique (scheme_id, version)
);

create index scheme_versions_scheme_id_idx on public.scheme_versions (scheme_id);

create table public.scheme_version_sources (
  scheme_version_id uuid not null references public.scheme_versions (id) on delete cascade,
  source_id uuid not null references public.scheme_sources (id) on delete restrict,
  is_primary boolean not null default false,
  primary key (scheme_version_id, source_id)
);

create table public.eligibility_rules (
  id uuid primary key default gen_random_uuid(),
  scheme_version_id uuid not null references public.scheme_versions (id) on delete cascade,
  rule_ast jsonb not null,
  human_label_en text not null,
  human_label_kn text not null default '',
  created_at timestamptz not null default now()
);

create index eligibility_rules_version_idx on public.eligibility_rules (scheme_version_id);

-- ---------------------------------------------------------------------------
-- Conversations (Kashif) — store extracts; raw audio stays in Storage if kept
-- ---------------------------------------------------------------------------

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  applicant_profile_id uuid references public.applicant_profiles (id) on delete set null,
  locale text not null default 'en',
  status text not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.conversation_turns (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  role text not null check (role in ('citizen', 'assistant', 'system')),
  text text,
  extract_patch jsonb,
  created_at timestamptz not null default now()
);

create index conversation_turns_conversation_id_idx
  on public.conversation_turns (conversation_id, created_at);

-- ---------------------------------------------------------------------------
-- Recommendations + LokScore snapshots
-- ---------------------------------------------------------------------------

create table public.recommendations (
  id uuid primary key default gen_random_uuid(),
  applicant_profile_id uuid not null references public.applicant_profiles (id) on delete cascade,
  scheme_id uuid not null references public.schemes (id) on delete restrict,
  scheme_version_id uuid not null references public.scheme_versions (id) on delete restrict,
  rank integer not null,
  score numeric(6, 2) not null,
  eligible boolean not null,
  reasons jsonb not null default '[]'::jsonb,
  computed_at timestamptz not null default now()
);

create index recommendations_applicant_idx on public.recommendations (applicant_profile_id, computed_at desc);

create table public.lok_score_snapshots (
  id uuid primary key default gen_random_uuid(),
  application_id uuid,
  applicant_profile_id uuid references public.applicant_profiles (id) on delete set null,
  total integer not null check (total between 0 and 100),
  grade text not null check (grade in ('A', 'B', 'C', 'D')),
  breakdown jsonb not null,
  quorum_required integer not null,
  quorum_pool integer not null,
  mentor_required boolean not null default false,
  input_hash text not null,
  weights jsonb not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Applications
-- ---------------------------------------------------------------------------

create table public.applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  applicant_profile_id uuid references public.applicant_profiles (id) on delete set null,
  scheme_id uuid references public.schemes (id) on delete set null,
  scheme_version_id uuid references public.scheme_versions (id) on delete set null,
  status public.application_status not null default 'draft',
  submission_mode public.submission_mode not null default 'none',
  submission_label_en text,
  submission_label_kn text,
  consent_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index applications_user_status_idx
  on public.applications (user_id, status)
  where deleted_at is null;

-- late FK for lok_score_snapshots.application_id
alter table public.lok_score_snapshots
  add constraint lok_score_snapshots_application_id_fkey
  foreign key (application_id) references public.applications (id) on delete set null;

create table public.application_versions (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications (id) on delete cascade,
  version_number integer not null,
  payload_hash text not null,
  payload jsonb not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (application_id, version_number)
);

create table public.application_fields (
  id uuid primary key default gen_random_uuid(),
  application_version_id uuid not null references public.application_versions (id) on delete cascade,
  key text not null,
  value jsonb,
  source text not null check (source in ('voice', 'user', 'system', 'adapter')),
  updated_at timestamptz not null default now(),
  unique (application_version_id, key)
);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications (id) on delete cascade,
  doc_type text not null,
  storage_path text,
  content_hash text,
  validation_status text not null default 'not_uploaded'
    check (validation_status in ('pending', 'valid', 'invalid', 'not_uploaded')),
  indicative_requirement boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index documents_application_idx on public.documents (application_id)
  where deleted_at is null;

create table public.application_events (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications (id) on delete cascade,
  type text not null,
  actor_id uuid references public.profiles (id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index application_events_app_created_idx
  on public.application_events (application_id, created_at);

-- ---------------------------------------------------------------------------
-- Reviewers / approvals / chain anchors (Jordan consumes; Backend stores)
-- ---------------------------------------------------------------------------

create table public.reviewer_pools (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  jurisdiction text,
  scheme_scope text,
  created_at timestamptz not null default now()
);

create table public.reviewer_pool_members (
  pool_id uuid not null references public.reviewer_pools (id) on delete cascade,
  reviewer_id uuid not null references public.profiles (id) on delete cascade,
  primary key (pool_id, reviewer_id)
);

create table public.reviewer_assignments (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications (id) on delete cascade,
  reviewer_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'verifier',
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

create index reviewer_assignments_app_idx on public.reviewer_assignments (application_id);

create table public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications (id) on delete cascade,
  lok_score_snapshot_id uuid references public.lok_score_snapshots (id) on delete set null,
  quorum_required integer not null check (quorum_required between 2 and 5),
  quorum_pool integer not null check (quorum_pool between 2 and 5),
  mentor_required boolean not null default false,
  status public.approval_status not null default 'open',
  report_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.approval_signatures (
  id uuid primary key default gen_random_uuid(),
  approval_request_id uuid not null references public.approval_requests (id) on delete cascade,
  reviewer_id uuid not null references public.profiles (id) on delete cascade,
  address text not null,
  signature text not null,
  signed_at timestamptz not null default now(),
  valid boolean not null default false,
  unique (approval_request_id, reviewer_id)
);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid not null,
  action text not null,
  actor_id uuid references public.profiles (id) on delete set null,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index audit_events_entity_idx on public.audit_events (entity_type, entity_id, created_at);

create table public.chain_anchors (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications (id) on delete cascade,
  approval_request_id uuid references public.approval_requests (id) on delete set null,
  report_hash text not null,
  quorum_required integer not null,
  mentor_required boolean not null default false,
  tx_ref text,
  chain_id text,
  anchored_at timestamptz not null default now()
);

create index chain_anchors_application_idx on public.chain_anchors (application_id);

-- ---------------------------------------------------------------------------
-- updated_at trigger helper
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

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create trigger applicant_profiles_set_updated_at
  before update on public.applicant_profiles
  for each row execute function public.set_updated_at();

create trigger schemes_set_updated_at
  before update on public.schemes
  for each row execute function public.set_updated_at();

create trigger applications_set_updated_at
  before update on public.applications
  for each row execute function public.set_updated_at();

create trigger approval_requests_set_updated_at
  before update on public.approval_requests
  for each row execute function public.set_updated_at();

create trigger conversations_set_updated_at
  before update on public.conversations
  for each row execute function public.set_updated_at();

create trigger documents_set_updated_at
  before update on public.documents
  for each row execute function public.set_updated_at();
