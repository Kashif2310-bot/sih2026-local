# Archived — DO NOT APPLY on the Option A database.

These Phase 1/2 Backend migrations defined a conflicting `public.schemes`
UUID relational registry. Under Option A:

- Scheme SoT = `src/assistant/data/schemes.ts`
- Scheme cache = Kashif `0001_scheme_assistant_schema.sql` (text ids)
- Persistence = `202609170001_option_a_reconciled.sql`

Applying files in this folder against a DB that already has Kashif's
`public.schemes` will break the project.
