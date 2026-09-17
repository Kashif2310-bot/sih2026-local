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
