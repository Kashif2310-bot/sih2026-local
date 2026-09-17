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
