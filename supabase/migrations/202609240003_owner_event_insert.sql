-- Let an owner append events to their own application.
--
-- Separate migration because 202609240001/0002 are already applied and
-- applied migrations are never rewritten.
--
-- WHY THIS IS REQUIRED, NOT OPTIONAL
--   createSupabaseAditaApplicationPersistence().save() does two writes: the
--   application upsert, and an 'application_saved' row in
--   public.application_events. 202609240001 gave application_events
--   owner-scoped SELECT policies but no INSERT policy, so an authenticated
--   browser save would succeed on the first write and then throw on the
--   second — leaving the application row persisted but the save reported as
--   failed. The service role was unaffected (it bypasses RLS), which is why
--   the existing backend tests never surfaced this.
--
--   The policy mirrors the SELECT rule exactly: you may write an event for
--   an application you own, and for no other.

create policy application_events_owner_insert on public.application_events
  for insert to authenticated
  with check (
    exists (
      select 1 from public.applications a
      where a.application_id = application_events.application_id
        and a.owner_user_id = auth.uid()
    )
  );

-- Documents follow the same rule, so the document service works from an
-- owner's session too. Notifications deliberately get no client INSERT
-- policy: a notification log that the recipient can forge is not an audit
-- trail, and nothing in the browser writes one today.
create policy application_documents_owner_insert on public.application_documents
  for insert to authenticated
  with check (
    exists (
      select 1 from public.applications a
      where a.application_id = application_documents.application_id
        and a.owner_user_id = auth.uid()
    )
  );
