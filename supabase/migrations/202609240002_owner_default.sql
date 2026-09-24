-- Default the owner column to the calling identity.
--
-- Separate from 202609240001 because that migration is already applied and
-- applied migrations are never rewritten.
--
-- WHY A DEFAULT RATHER THAN APPLICATION CODE
--   The owner-scoped INSERT policy is `with check (owner_user_id = auth.uid())`,
--   so any insert that omits the column would be rejected. The obvious fix is
--   to make every caller pass the owner explicitly — but the caller here is
--   the EXISTING, already-tested persistence service
--   (src/backend/services/aditaApplicationPersistence.ts), which is shared
--   with the service-role backend. Threading an owner through it would mean
--   changing a service used by passing tests, for the benefit of one caller.
--
--   A column default resolves it with no code change and the right behaviour
--   for BOTH callers:
--     * authenticated browser insert -> auth.uid() is that user  -> row is owned
--     * service-role insert          -> auth.uid() is NULL       -> row is unowned
--   which is precisely the existing/legacy semantics the previous migration
--   preserved. The same persistence service therefore works, unmodified,
--   from the browser and from the backend.
--
--   An explicit owner_user_id passed by a caller still wins over the default,
--   and the INSERT policy still rejects it if it is not the caller's own id —
--   so this default is a convenience, never an authorization bypass.

alter table public.applications
  alter column owner_user_id set default auth.uid();

alter table public.applicant_profiles
  alter column owner_user_id set default auth.uid();
