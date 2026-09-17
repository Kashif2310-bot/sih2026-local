-- Option A verification queries (accepted schema on feat/backend-option-a-rework).
-- Run via: npm run supabase:verify
--   or paste into Supabase SQL Editor after migrations 0001–0005 + seed.
--
-- Expect:
--   ministries / departments / scheme_ministry_map present
--   schemes cache seeded with nsfdc-micro-finance / nsfdc-term-loan (optional but expected after seed)
--   applications.application_status column exists (draft|awaiting_consent|submitted|tracked)
--   notification tables present
--   RLS enabled on core tables
--
-- Does NOT expect: get_application_status_public, owner_user_id, Phase 1/2 scheme_versions.

select 'ministries' as entity, count(*)::text as n from public.ministries
union all select 'departments', count(*)::text from public.departments
union all select 'schemes_cache', count(*)::text from public.schemes
union all select 'scheme_ministry_map', count(*)::text from public.scheme_ministry_map
union all select 'applicant_profiles', count(*)::text from public.applicant_profiles
union all select 'applications', count(*)::text from public.applications
union all select 'approval_cases', count(*)::text from public.approval_cases
union all select 'chain_anchors', count(*)::text from public.chain_anchors
union all select 'application_notifications', count(*)::text from public.application_notifications
union all select 'application_notification_preferences', count(*)::text from public.application_notification_preferences
union all select 'official_discovery_retrievals', count(*)::text from public.official_discovery_retrievals
union all select 'scheme_retrievals', count(*)::text from public.scheme_retrievals;

select id, code, name_en from public.ministries order by id;

select scheme_id, ministry_id, department_id
from public.scheme_ministry_map
order by scheme_id;

select id, verification_status, source_url
from public.schemes
where id in ('nsfdc-micro-finance', 'nsfdc-term-loan')
order by id;

-- Canonical status column (migration 202609170005)
select column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'applications'
  and column_name in ('application_id', 'status', 'application_status', 'government_reference_id', 'submission_idempotency_key')
order by column_name;

select * from public.verify_rls_enabled();
