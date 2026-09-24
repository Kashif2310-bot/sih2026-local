-- Application ownership (additive) — the authorization model that makes
-- browser-side persistence safe.
--
-- WHY THIS EXISTS
--   Until now every write to public.applications required the service role,
--   because there was no way to tell one citizen from another: RLS allowed
--   anon SELECT on every row and there were no anon write policies at all.
--   That is safe (nobody can write) but it also means the browser cannot
--   persist anything. Simply adding anon write policies would let any
--   visitor read, alter, or destroy every other citizen's application —
--   which is strictly worse than not persisting at all.
--
--   This migration introduces the missing piece: a row owner. With an owner
--   column, Postgres itself can enforce "you may only touch your own
--   application", so the browser can write directly under its own identity
--   and the service role stops being the only way in.
--
-- BACKWARD COMPATIBILITY — this is deliberately non-breaking:
--   * owner_user_id is NULLABLE. Every row that already exists (integration
--     test rows, seeded demo data) keeps owner_user_id = NULL.
--   * A NULL-owner row stays publicly readable, exactly as before, so the
--     existing demo/admin read path and every current test keep working.
--   * Only rows created WITH an owner become private to that owner.
--   * The service role bypasses RLS entirely, so src/backend/* and the
--     existing live integration tests are unaffected.
--
-- WHAT THIS MIGRATION DOES NOT DO
--   It does not enable any auth provider — that is a project setting, not
--   schema. Until an auth provider is enabled the new owner-scoped policies
--   simply never match (auth.uid() is null for an anon caller), and the
--   system behaves exactly as it does today. See docs/BACKEND_INTEGRATION.md.

-- ---------------------------------------------------------------------------
-- Owner columns
-- ---------------------------------------------------------------------------

alter table public.applications
  add column if not exists owner_user_id uuid references auth.users (id) on delete set null;

alter table public.applicant_profiles
  add column if not exists owner_user_id uuid references auth.users (id) on delete set null;

-- Partial indexes: only owned rows are ever filtered by owner, and leaving
-- the NULL-owner legacy rows out keeps these small.
create index if not exists applications_owner_user_id_idx
  on public.applications (owner_user_id)
  where owner_user_id is not null;

create index if not exists applicant_profiles_owner_user_id_idx
  on public.applicant_profiles (owner_user_id)
  where owner_user_id is not null;

comment on column public.applications.owner_user_id is
  'Supabase auth user that owns this application. NULL means an unowned legacy/demo row, which stays publicly readable. Owned rows are readable and writable only by their owner (RLS).';

-- ---------------------------------------------------------------------------
-- applications — ownership-aware RLS
--
-- The previous policy was `for select using (true)`: every row readable by
-- anyone holding the anon key. That is replaced (not merely supplemented) by
-- a pair of policies, because leaving the blanket policy in place would make
-- ownership decorative — Postgres ORs permissive policies together, so one
-- `using (true)` defeats every other SELECT rule on the table.
-- ---------------------------------------------------------------------------

drop policy if exists applications_public_read on public.applications;

create policy applications_public_read on public.applications
  for select using (owner_user_id is null);

create policy applications_owner_read on public.applications
  for select to authenticated using (owner_user_id = auth.uid());

create policy applications_owner_insert on public.applications
  for insert to authenticated with check (owner_user_id = auth.uid());

create policy applications_owner_update on public.applications
  for update to authenticated
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());

-- Deliberately NO delete policy: nothing in the product deletes an
-- application, and an accidental client-side delete of a submitted
-- government application is not a recoverable mistake.

-- ---------------------------------------------------------------------------
-- applicant_profiles — same shape
-- ---------------------------------------------------------------------------

drop policy if exists applicant_profiles_public_read on public.applicant_profiles;

create policy applicant_profiles_public_read on public.applicant_profiles
  for select using (owner_user_id is null);

create policy applicant_profiles_owner_read on public.applicant_profiles
  for select to authenticated using (owner_user_id = auth.uid());

create policy applicant_profiles_owner_insert on public.applicant_profiles
  for insert to authenticated with check (owner_user_id = auth.uid());

create policy applicant_profiles_owner_update on public.applicant_profiles
  for update to authenticated
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Child tables — ownership is inherited from the parent application.
--
-- Partial ownership would be a false sense of security: an owned, private
-- application whose documents and events are world-readable leaks exactly
-- the information the owner column was added to protect. Each child table
-- therefore resolves the owner through its parent row.
-- ---------------------------------------------------------------------------

drop policy if exists application_documents_public_read on public.application_documents;

create policy application_documents_public_read on public.application_documents
  for select using (
    exists (
      select 1 from public.applications a
      where a.application_id = application_documents.application_id
        and a.owner_user_id is null
    )
  );

create policy application_documents_owner_read on public.application_documents
  for select to authenticated using (
    exists (
      select 1 from public.applications a
      where a.application_id = application_documents.application_id
        and a.owner_user_id = auth.uid()
    )
  );

drop policy if exists application_events_public_read on public.application_events;

create policy application_events_public_read on public.application_events
  for select using (
    exists (
      select 1 from public.applications a
      where a.application_id = application_events.application_id
        and a.owner_user_id is null
    )
  );

create policy application_events_owner_read on public.application_events
  for select to authenticated using (
    exists (
      select 1 from public.applications a
      where a.application_id = application_events.application_id
        and a.owner_user_id = auth.uid()
    )
  );

drop policy if exists application_notifications_public_read on public.application_notifications;

create policy application_notifications_public_read on public.application_notifications
  for select using (
    exists (
      select 1 from public.applications a
      where a.application_id = application_notifications.application_id
        and a.owner_user_id is null
    )
  );

create policy application_notifications_owner_read on public.application_notifications
  for select to authenticated using (
    exists (
      select 1 from public.applications a
      where a.application_id = application_notifications.application_id
        and a.owner_user_id = auth.uid()
    )
  );

-- Indexes supporting the EXISTS lookups above (the child side of each join).
create index if not exists application_documents_application_id_idx
  on public.application_documents (application_id);
create index if not exists application_notifications_application_id_idx
  on public.application_notifications (application_id);
