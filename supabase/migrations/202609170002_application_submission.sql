-- LokPulse Phase 5 — application submission: government reference id +
-- idempotency guard. Purely additive columns on public.applications.

alter table public.applications
  add column government_reference_id text,
  add column submission_idempotency_key text;

-- Lets submit() use `.is('submission_idempotency_key', null)` as an atomic
-- guard against concurrent double-submission (see supabaseApplicationServices.ts#submit).
create index applications_submission_idempotency_key_idx
  on public.applications (submission_idempotency_key)
  where submission_idempotency_key is not null;
