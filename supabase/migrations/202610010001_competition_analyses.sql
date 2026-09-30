-- Derived, auditable Google Places competition summaries linked to applicant facts.
-- Google place content is intentionally not retained; only the requested aggregate
-- result is stored to minimize data retention and respect Places data policies.

create table if not exists public.competition_analyses (
  id uuid primary key default gen_random_uuid(),
  applicant_profile_id uuid not null references public.applicant_profiles (id) on delete cascade,
  business_type text not null,
  competitor_count integer not null check (competitor_count >= 0),
  score integer not null check (score between 0 and 100),
  threat_level text not null check (threat_level in ('low', 'moderate', 'high')),
  radius_m integer not null check (radius_m > 0),
  analyzed_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists competition_analyses_profile_time_idx
  on public.competition_analyses (applicant_profile_id, analyzed_at desc);

alter table public.competition_analyses enable row level security;

create policy competition_analyses_public_read on public.competition_analyses
  for select using (
    exists (
      select 1 from public.applicant_profiles profile
      where profile.id = competition_analyses.applicant_profile_id
        and profile.owner_user_id is null
    )
  );

create policy competition_analyses_owner_read on public.competition_analyses
  for select to authenticated using (
    exists (
      select 1 from public.applicant_profiles profile
      where profile.id = competition_analyses.applicant_profile_id
        and profile.owner_user_id = auth.uid()
    )
  );

create policy competition_analyses_owner_insert on public.competition_analyses
  for insert to authenticated with check (
    exists (
      select 1 from public.applicant_profiles profile
      where profile.id = competition_analyses.applicant_profile_id
        and profile.owner_user_id = auth.uid()
    )
  );

-- Analyses are append-only audit evidence: no browser update/delete policies.
