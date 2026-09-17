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
