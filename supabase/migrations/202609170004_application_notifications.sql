-- Option A notification dispatch/log — additive, LP-APP-* keyed.
-- No accounts/profiles table exists in the reconciled schema, so preference
-- and log rows are scoped to application_id, not a user id. This is a
-- dispatch/log layer only: application_status here is a snapshot taken at
-- notify time for reference, never the source of truth for lifecycle state
-- (that stays derived from applications.status_history via
-- canonicalStatusForTrackedApplication()).

create table if not exists public.application_notification_preferences (
  application_id text not null references public.applications (application_id) on delete cascade,
  channel text not null,
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (application_id, channel)
);

create table if not exists public.application_notifications (
  id uuid primary key default gen_random_uuid(),
  application_id text not null references public.applications (application_id) on delete cascade,
  application_status text not null,
  template_code text not null,
  channel text not null,
  status text not null,
  recipient text,
  provider_ref text,
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists application_notifications_app_created_idx
  on public.application_notifications (application_id, created_at desc);

alter table public.application_notification_preferences enable row level security;
alter table public.application_notifications enable row level security;

-- Same demo-honesty pattern as every other Option A table: public read,
-- service-role-only writes. Tighten when real auth lands.
drop policy if exists application_notification_preferences_public_read on public.application_notification_preferences;
create policy application_notification_preferences_public_read on public.application_notification_preferences for select using (true);

drop policy if exists application_notifications_public_read on public.application_notifications;
create policy application_notifications_public_read on public.application_notifications for select using (true);
