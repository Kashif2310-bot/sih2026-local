-- Manual verification queries (run via: npx supabase db query --file scripts/verify-supabase.sql)
-- Expect: 1 ministry MOSJE, 1 dept NSFDC, 2 schemes, 2 versions, RLS enabled.

select 'ministries' as entity, count(*)::text as n from public.ministries
union all select 'departments', count(*)::text from public.departments
union all select 'schemes', count(*)::text from public.schemes
union all select 'scheme_versions', count(*)::text from public.scheme_versions
union all select 'scheme_sources', count(*)::text from public.scheme_sources;

select d.code as department, m.code as ministry
from public.departments d
join public.ministries m on m.id = d.ministry_id;

select c.relname as table_name, c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relname in (
    'profiles', 'applicant_profiles', 'schemes', 'applications',
    'approval_requests', 'chain_anchors', 'documents'
  )
order by 1;

select * from public.v_scheme_registry_v0;
