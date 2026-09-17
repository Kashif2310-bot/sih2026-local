-- LokPulse Phase 3 — official-source retrieval audit log.
-- Additive only: does not touch schemes/scheme_versions/scheme_sources.
-- This is diagnostic/operational data (source health, attempts, failures),
-- not a second scheme registry — public.schemes stays authoritative.

create table public.scheme_retrievals (
  id uuid primary key default gen_random_uuid(),
  source_adapter_id text not null,
  pass_type text not null,
  query_signature text not null,
  ok boolean not null,
  record_count integer not null default 0,
  latency_ms integer not null default 0,
  error_message text,
  attempted_at timestamptz not null default now()
);

create index scheme_retrievals_adapter_idx on public.scheme_retrievals (source_adapter_id, attempted_at desc);
create index scheme_retrievals_attempted_at_idx on public.scheme_retrievals (attempted_at desc);

alter table public.scheme_retrievals enable row level security;

-- Operational/diagnostic data: admin/service only, no public or citizen read.
create policy scheme_retrievals_admin_all on public.scheme_retrievals
  for all using (public.is_admin()) with check (public.is_admin());
