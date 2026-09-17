-- LokPulse Phase 2 bundled apply (hosted SQL editor)
-- public.schemes seed is OPTIONAL CACHE only; TS fixture remains SoT.
begin;

-- ===== 202609160001_init_schema.sql =====

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


-- ===== 202609160002_rls.sql =====

-- LokPulse Phase 1 — RLS baseline
-- Service role bypasses RLS. Anon/authenticated must never see others' PII.

create or replace function public.current_role()
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select role from public.profiles where id = auth.uid()),
    'citizen'::public.user_role
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_role() in ('admin', 'service');
$$;

create or replace function public.is_reviewer()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_role() in ('reviewer', 'admin', 'service');
$$;

-- Enable RLS on all tenant / registry tables
alter table public.profiles enable row level security;
alter table public.applicant_profiles enable row level security;
alter table public.ministries enable row level security;
alter table public.departments enable row level security;
alter table public.schemes enable row level security;
alter table public.scheme_sources enable row level security;
alter table public.scheme_versions enable row level security;
alter table public.scheme_version_sources enable row level security;
alter table public.eligibility_rules enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_turns enable row level security;
alter table public.recommendations enable row level security;
alter table public.lok_score_snapshots enable row level security;
alter table public.applications enable row level security;
alter table public.application_versions enable row level security;
alter table public.application_fields enable row level security;
alter table public.documents enable row level security;
alter table public.application_events enable row level security;
alter table public.reviewer_pools enable row level security;
alter table public.reviewer_pool_members enable row level security;
alter table public.reviewer_assignments enable row level security;
alter table public.approval_requests enable row level security;
alter table public.approval_signatures enable row level security;
alter table public.audit_events enable row level security;
alter table public.chain_anchors enable row level security;

-- profiles
create policy profiles_select_self_or_admin on public.profiles
  for select using (id = auth.uid() or public.is_admin());

create policy profiles_update_self on public.profiles
  for update using (id = auth.uid())
  with check (id = auth.uid());

-- applicant_profiles
create policy applicant_profiles_select_own on public.applicant_profiles
  for select using (user_id = auth.uid() or public.is_admin() or public.is_reviewer());

create policy applicant_profiles_insert_own on public.applicant_profiles
  for insert with check (user_id = auth.uid() or public.is_admin());

create policy applicant_profiles_update_own on public.applicant_profiles
  for update using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

-- Registry: verified/active schemes readable by authenticated users; writes admin-only
create policy ministries_read_all on public.ministries
  for select using (auth.role() = 'authenticated' or public.is_admin());

create policy ministries_write_admin on public.ministries
  for all using (public.is_admin()) with check (public.is_admin());

create policy departments_read_all on public.departments
  for select using (auth.role() = 'authenticated' or public.is_admin());

create policy departments_write_admin on public.departments
  for all using (public.is_admin()) with check (public.is_admin());

create policy schemes_read_active on public.schemes
  for select using (
    status = 'active'
    or public.is_admin()
  );

create policy schemes_write_admin on public.schemes
  for all using (public.is_admin()) with check (public.is_admin());

create policy scheme_versions_read on public.scheme_versions
  for select using (
    verification_status in ('verified', 'prototype_indicative', 'stale')
    or public.is_admin()
  );

create policy scheme_versions_write_admin on public.scheme_versions
  for all using (public.is_admin()) with check (public.is_admin());

create policy scheme_sources_read on public.scheme_sources
  for select using (auth.role() = 'authenticated' or public.is_admin());

create policy scheme_sources_write_admin on public.scheme_sources
  for all using (public.is_admin()) with check (public.is_admin());

create policy scheme_version_sources_read on public.scheme_version_sources
  for select using (auth.role() = 'authenticated' or public.is_admin());

create policy scheme_version_sources_write_admin on public.scheme_version_sources
  for all using (public.is_admin()) with check (public.is_admin());

create policy eligibility_rules_read on public.eligibility_rules
  for select using (auth.role() = 'authenticated' or public.is_admin());

create policy eligibility_rules_write_admin on public.eligibility_rules
  for all using (public.is_admin()) with check (public.is_admin());

-- conversations
create policy conversations_own on public.conversations
  for all using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

create policy conversation_turns_own on public.conversation_turns
  for all using (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_id and (c.user_id = auth.uid() or public.is_admin())
    )
  )
  with check (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_id and (c.user_id = auth.uid() or public.is_admin())
    )
  );

-- recommendations: owner of applicant profile
create policy recommendations_own on public.recommendations
  for select using (
    exists (
      select 1 from public.applicant_profiles ap
      where ap.id = applicant_profile_id
        and (ap.user_id = auth.uid() or public.is_admin() or public.is_reviewer())
    )
  );

create policy recommendations_insert_own on public.recommendations
  for insert with check (
    exists (
      select 1 from public.applicant_profiles ap
      where ap.id = applicant_profile_id
        and (ap.user_id = auth.uid() or public.is_admin())
    )
  );

-- applications
create policy applications_select_own_or_staff on public.applications
  for select using (
    user_id = auth.uid()
    or public.is_admin()
    or (
      public.is_reviewer()
      and exists (
        select 1 from public.reviewer_assignments ra
        where ra.application_id = id and ra.reviewer_id = auth.uid()
      )
    )
  );

create policy applications_insert_own on public.applications
  for insert with check (user_id = auth.uid() or public.is_admin());

create policy applications_update_own_or_admin on public.applications
  for update using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

create policy application_versions_via_app on public.application_versions
  for select using (
    exists (
      select 1 from public.applications a
      where a.id = application_id
        and (
          a.user_id = auth.uid()
          or public.is_admin()
          or public.is_reviewer()
        )
    )
  );

create policy application_versions_insert_via_app on public.application_versions
  for insert with check (
    exists (
      select 1 from public.applications a
      where a.id = application_id and (a.user_id = auth.uid() or public.is_admin())
    )
  );

create policy application_fields_via_version on public.application_fields
  for select using (
    exists (
      select 1
      from public.application_versions av
      join public.applications a on a.id = av.application_id
      where av.id = application_version_id
        and (a.user_id = auth.uid() or public.is_admin() or public.is_reviewer())
    )
  );

create policy documents_via_app on public.documents
  for all using (
    exists (
      select 1 from public.applications a
      where a.id = application_id
        and (a.user_id = auth.uid() or public.is_admin() or public.is_reviewer())
    )
  )
  with check (
    exists (
      select 1 from public.applications a
      where a.id = application_id and (a.user_id = auth.uid() or public.is_admin())
    )
  );

create policy application_events_select on public.application_events
  for select using (
    exists (
      select 1 from public.applications a
      where a.id = application_id
        and (a.user_id = auth.uid() or public.is_admin() or public.is_reviewer())
    )
  );

-- Append-only events: insert allowed for owner/admin; no update/delete policies (denied by default)
create policy application_events_insert on public.application_events
  for insert with check (
    exists (
      select 1 from public.applications a
      where a.id = application_id and (a.user_id = auth.uid() or public.is_admin() or public.is_reviewer())
    )
  );

create policy lok_score_snapshots_select on public.lok_score_snapshots
  for select using (
    public.is_admin()
    or public.is_reviewer()
    or (
      applicant_profile_id is not null
      and exists (
        select 1 from public.applicant_profiles ap
        where ap.id = applicant_profile_id and ap.user_id = auth.uid()
      )
    )
    or (
      application_id is not null
      and exists (
        select 1 from public.applications a
        where a.id = application_id and a.user_id = auth.uid()
      )
    )
  );

-- Reviewer / approval tables: staff read; admin write; citizens read own app approvals
create policy reviewer_pools_staff on public.reviewer_pools
  for select using (public.is_reviewer() or public.is_admin());

create policy reviewer_pools_admin_write on public.reviewer_pools
  for all using (public.is_admin()) with check (public.is_admin());

create policy reviewer_pool_members_staff on public.reviewer_pool_members
  for select using (public.is_reviewer() or public.is_admin());

create policy reviewer_pool_members_admin_write on public.reviewer_pool_members
  for all using (public.is_admin()) with check (public.is_admin());

create policy reviewer_assignments_visible on public.reviewer_assignments
  for select using (
    reviewer_id = auth.uid()
    or public.is_admin()
    or exists (
      select 1 from public.applications a
      where a.id = application_id and a.user_id = auth.uid()
    )
  );

create policy reviewer_assignments_admin_write on public.reviewer_assignments
  for all using (public.is_admin()) with check (public.is_admin());

create policy approval_requests_visible on public.approval_requests
  for select using (
    public.is_admin()
    or public.is_reviewer()
    or exists (
      select 1 from public.applications a
      where a.id = application_id and a.user_id = auth.uid()
    )
  );

create policy approval_requests_staff_write on public.approval_requests
  for all using (public.is_admin() or public.is_reviewer())
  with check (public.is_admin() or public.is_reviewer());

create policy approval_signatures_visible on public.approval_signatures
  for select using (
    public.is_admin()
    or public.is_reviewer()
    or exists (
      select 1
      from public.approval_requests ar
      join public.applications a on a.id = ar.application_id
      where ar.id = approval_request_id and a.user_id = auth.uid()
    )
  );

create policy approval_signatures_reviewer_insert on public.approval_signatures
  for insert with check (reviewer_id = auth.uid() or public.is_admin());

create policy audit_events_admin on public.audit_events
  for select using (public.is_admin());

create policy audit_events_insert_staff on public.audit_events
  for insert with check (public.is_admin() or public.is_reviewer());

create policy chain_anchors_visible on public.chain_anchors
  for select using (
    public.is_admin()
    or public.is_reviewer()
    or exists (
      select 1 from public.applications a
      where a.id = application_id and a.user_id = auth.uid()
    )
  );

create policy chain_anchors_staff_write on public.chain_anchors
  for insert with check (public.is_admin() or public.is_reviewer());


-- ===== 202609160003_registry_public_read.sql =====

-- Allow anonymous / public read of the verified scheme catalog.
-- Writes remain admin-only. Citizen app can list schemes before login.

drop policy if exists ministries_read_all on public.ministries;
create policy ministries_read_all on public.ministries
  for select using (true);

drop policy if exists departments_read_all on public.departments;
create policy departments_read_all on public.departments
  for select using (true);

drop policy if exists schemes_read_active on public.schemes;
create policy schemes_read_active on public.schemes
  for select using (status = 'active' or public.is_admin());

drop policy if exists scheme_versions_read on public.scheme_versions;
create policy scheme_versions_read on public.scheme_versions
  for select using (
    verification_status in ('verified', 'prototype_indicative', 'stale')
    or public.is_admin()
  );

drop policy if exists scheme_sources_read on public.scheme_sources;
create policy scheme_sources_read on public.scheme_sources
  for select using (true);

drop policy if exists scheme_version_sources_read on public.scheme_version_sources;
create policy scheme_version_sources_read on public.scheme_version_sources
  for select using (true);

drop policy if exists eligibility_rules_read on public.eligibility_rules;
create policy eligibility_rules_read on public.eligibility_rules
  for select using (true);

-- Helper view for ops verification (security_invoker so RLS still applies)
create or replace view public.v_scheme_registry_v0
with (security_invoker = true)
as
select
  s.code as scheme_code,
  s.name_en,
  s.status,
  d.code as department_code,
  m.code as ministry_code,
  sv.version,
  sv.verification_status,
  sv.loan_terms
from public.schemes s
join public.departments d on d.id = s.owning_department_id
join public.ministries m on m.id = s.owning_ministry_id
left join lateral (
  select *
  from public.scheme_versions v
  where v.scheme_id = s.id
  order by v.effective_from desc
  limit 1
) sv on true;


-- ===== 202609160004_profile_on_signup.sql =====

-- Auto-create public.profiles when a new auth user signs up.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, role, display_name, locale)
  values (
    new.id,
    'citizen',
    coalesce(new.raw_user_meta_data->>'display_name', new.email),
    coalesce(new.raw_user_meta_data->>'locale', 'en')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ===== 202609160005_verify_rls_fn.sql =====

-- Verify RLS is enabled on tenant/sensitive tables (used by scripts + ops).

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
      'profiles',
      'applicant_profiles',
      'schemes',
      'scheme_versions',
      'applications',
      'documents',
      'approval_requests',
      'approval_signatures',
      'chain_anchors',
      'audit_events'
    )
  order by 1;
$$;

revoke all on function public.verify_rls_enabled() from public;
grant execute on function public.verify_rls_enabled() to service_role;


-- ===== seed/nsfdc_schemes_v0.sql =====

-- NSFDC registry v0 seed — optional write-through / enrichment cache ONLY.
-- Authoritative scheme facts for the running prototype remain in TypeScript:
--   src/backend/registry/fixtureSchemeRegistry.ts (and future assistant scheme modules).
-- public.schemes here is NOT the multi-source government registry of record.
-- Stable UUIDs for cross-workstream fixtures.

insert into public.ministries (id, code, name_en, name_kn, level)
values (
  '11111111-1111-4111-8111-111111111101',
  'MOSJE',
  'Ministry of Social Justice and Empowerment',
  'ಸಾಮಾಜಿಕ ನ್ಯಾಯ ಮತ್ತು ಸಬಲೀಕರಣ ಸಚಿವಾಲಯ',
  'central'
)
on conflict (code) do nothing;

insert into public.departments (id, ministry_id, code, name_en, name_kn)
values (
  '11111111-1111-4111-8111-111111111102',
  '11111111-1111-4111-8111-111111111101',
  'NSFDC',
  'National Scheduled Castes Finance and Development Corporation',
  'ರಾಷ್ಟ್ರೀಯ ಪರಿಶಿಷ್ಟ ಜಾತಿ ಹಣಕಾಸು ಮತ್ತು ಅಭಿವೃದ್ಧಿ ನಿಗಮ'
)
on conflict (ministry_id, code) do nothing;

insert into public.scheme_sources (id, source_type, title_en, url, publisher, retrieved_at, confidence, status, notes_en)
values
(
  '44444444-4444-4444-8444-444444444402',
  'prototype_fixture',
  'LokPulse NSFDC constants (src/lib/config.ts)',
  null,
  'LokPulse SIH26091',
  '2026-09-16T00:00:00Z',
  1.0,
  'verified',
  'Authoritative numeric ladder for this prototype from SIH26091 / config.ts. Not live-scraped.'
),
(
  '44444444-4444-4444-8444-444444444401',
  'official_website',
  'NSFDC — official corporation site (reference)',
  'https://nsfdc.nic.in/',
  'NSFDC',
  '2026-09-16T00:00:00Z',
  0.7,
  'prototype_indicative',
  'Official domain reference only. Loan numbers come from locked PS constants, not a live scrape.'
)
on conflict (id) do nothing;

insert into public.schemes (
  id, code, name_en, name_kn, jurisdiction, owning_department_id, owning_ministry_id, status
) values
(
  '22222222-2222-4222-8222-222222222201',
  'NSFDC_MICRO_FINANCE',
  'NSFDC Micro Finance Scheme',
  'ಎನ್‌ಎಸ್‌ಎಫ್‌ಡಿಸಿ ಮೈಕ್ರೋ ಫೈನಾನ್ಸ್ ಯೋಜನೆ',
  'central',
  '11111111-1111-4111-8111-111111111102',
  '11111111-1111-4111-8111-111111111101',
  'active'
),
(
  '22222222-2222-4222-8222-222222222202',
  'NSFDC_TERM_LOAN',
  'NSFDC Term Loan Scheme',
  'ಎನ್‌ಎಸ್‌ಎಫ್‌ಡಿಸಿ ಟರ್ಮ್ ಲೋನ್ ಯೋಜನೆ',
  'central',
  '11111111-1111-4111-8111-111111111102',
  '11111111-1111-4111-8111-111111111101',
  'active'
)
on conflict (code) do nothing;

insert into public.scheme_versions (
  id, scheme_id, version, effective_from, loan_terms, benefits, subsidies,
  procedure_summary_en, procedure_summary_kn, official_urls, documents,
  eligibility_summary_en, eligibility_summary_kn, eligibility_hints,
  verification_status, published_at, retrieved_at, freshness_score
) values
(
  '33333333-3333-4333-8333-333333333301',
  '22222222-2222-4222-8222-222222222201',
  'v0.1.0',
  '2026-09-16T00:00:00Z',
  '{"projectCostMinRupees":1,"projectCostMaxRupees":140000,"loanRatio":0.9,"loanCapRupees":125000,"interestRatePercent":6.5,"tenureYears":3,"moratoriumMonths":3,"marginRatio":0.1}'::jsonb,
  '[{"kind":"loan","summaryEn":"Concessional micro finance loan up to 90% of project cost (cap ₹1.25 lakh).","summaryKn":"ಯೋಜನಾ ವೆಚ್ಚದ 90% ವರೆಗೆ ರಿಯಾಯಿತಿ ಮೈಕ್ರೋ ಫೈನಾನ್ಸ್ ಸಾಲ (ಗರಿಷ್ಠ ₹1.25 ಲಕ್ಷ)."}]'::jsonb,
  '[]'::jsonb,
  'Apply via NSFDC channelizing agency (SCA) / bank partner. Confirm exact process with local SCA — no live application API claimed.',
  'NSFDC SCA / ಬ್ಯಾಂಕ್ ಪಾರ್ಟ್‌ನರ್ ಮೂಲಕ ಅರ್ಜಿ. ನಿಖರ ಪ್ರಕ್ರಿಯೆಯನ್ನು ಸ್ಥಳೀಯ SCA ಯಿಂದ ದೃಢೀಕರಿಸಿ.',
  '["https://nsfdc.nic.in/"]'::jsonb,
  '[{"docType":"aadhaar","required":true,"labelEn":"Aadhaar card","labelKn":"ಆಧಾರ್","indicative":true}]'::jsonb,
  'NSFDC core schemes target Scheduled Caste beneficiaries; typical income ceiling ≤ ₹5 lakh.',
  'ಎನ್‌ಎಸ್‌ಎಫ್‌ಡಿಸಿ ಮುಖ್ಯ ಯೋಜನೆಗಳು ಪರಿಶಿಷ್ಟ ಜಾತಿಗೆ; ಆದಾಯ ಮಿತಿ ≤ ₹5 ಲಕ್ಷ.',
  '{"communitiesPreferred":["sc"],"maxAnnualIncomeRupees":500000,"womenPriority":true,"minAge":18,"maxAge":null,"businessCategories":null,"states":null}'::jsonb,
  'verified',
  '2026-09-16T00:00:00Z',
  '2026-09-16T00:00:00Z',
  1.0
),
(
  '33333333-3333-4333-8333-333333333302',
  '22222222-2222-4222-8222-222222222202',
  'v0.1.0',
  '2026-09-16T00:00:00Z',
  '{"projectCostMinRupees":140001,"projectCostMaxRupees":5000000,"loanRatio":0.9,"loanCapRupees":4500000,"interestRatePercent":8,"tenureYears":7,"moratoriumMonths":6,"marginRatio":0.1}'::jsonb,
  '[{"kind":"loan","summaryEn":"Concessional term loan up to 90% of project cost (cap ₹45 lakh).","summaryKn":"90% ವರೆಗೆ ಟರ್ಮ್ ಲೋನ್ (ಗರಿಷ್ಠ ₹45 ಲಕ್ಷ)."}]'::jsonb,
  '[]'::jsonb,
  'Apply via NSFDC channelizing agency (SCA) / bank partner. Confirm exact process with local SCA — no live application API claimed.',
  'NSFDC SCA / ಬ್ಯಾಂಕ್ ಪಾರ್ಟ್‌ನರ್ ಮೂಲಕ ಅರ್ಜಿ.',
  '["https://nsfdc.nic.in/"]'::jsonb,
  '[{"docType":"aadhaar","required":true,"labelEn":"Aadhaar card","labelKn":"ಆಧಾರ್","indicative":true}]'::jsonb,
  'NSFDC core schemes target Scheduled Caste beneficiaries; typical income ceiling ≤ ₹5 lakh.',
  'ಎನ್‌ಎಸ್‌ಎಫ್‌ಡಿಸಿ ಮುಖ್ಯ ಯೋಜನೆಗಳು ಪರಿಶಿಷ್ಟ ಜಾತಿಗೆ; ಆದಾಯ ಮಿತಿ ≤ ₹5 ಲಕ್ಷ.',
  '{"communitiesPreferred":["sc"],"maxAnnualIncomeRupees":500000,"womenPriority":true,"minAge":18,"maxAge":null,"businessCategories":null,"states":null}'::jsonb,
  'verified',
  '2026-09-16T00:00:00Z',
  '2026-09-16T00:00:00Z',
  1.0
)
on conflict (scheme_id, version) do nothing;

insert into public.scheme_version_sources (scheme_version_id, source_id, is_primary) values
  ('33333333-3333-4333-8333-333333333301', '44444444-4444-4444-8444-444444444402', true),
  ('33333333-3333-4333-8333-333333333301', '44444444-4444-4444-8444-444444444401', false),
  ('33333333-3333-4333-8333-333333333302', '44444444-4444-4444-8444-444444444402', true),
  ('33333333-3333-4333-8333-333333333302', '44444444-4444-4444-8444-444444444401', false)
on conflict do nothing;


commit;