-- Canonical, persisted ApplicationStatus (Option A) — additive column on
-- the existing applications table.
--
-- Deliberately NOT a reuse of applications.status: that column already
-- holds Adita's raw WorkflowStep/outcome text and is read with that exact
-- meaning by AditaApplicationPersistence.listByStatus() (backend, not
-- schema-owned by her, but its existing behavior for any current caller) —
-- overwriting it with the 4-value canonical status would silently break
-- that method. application_status is a new, separate column.
--
-- Written exactly once per applications write, by the backend's
-- ApplicationStatusStore (services/applicationStatus/), immediately after
-- AditaApplicationPersistence.save() succeeds — never recomputed from
-- status_history on read. `submitted` reflects that a submission attempt /
-- application id was issued by the workflow, not a government confirmation.
--
-- Existing rows created before this migration will read 'draft' (the
-- column default) until they are next saved, at which point the backend
-- write-time hook recomputes and persists their real status.

alter table public.applications
  add column if not exists application_status text not null default 'draft'
  check (application_status in ('draft', 'awaiting_consent', 'submitted', 'tracked'));

create index if not exists applications_application_status_idx
  on public.applications (application_status);
