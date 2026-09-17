# ApplicantProfile — shared interoperability contract

**Location:** [`src/shared/applicantProfile.ts`](../src/shared/applicantProfile.ts)
**Status:** approved architecture decision, implemented 2026-09-15. Interoperability contract only — not a migration.

## Purpose

LokPulse has two independent, working "who is this citizen" models:

- **`UserProfile`** ([`src/assistant/types.ts`](../src/assistant/types.ts)) — the AI government-scheme assistant's own profile, built up turn-by-turn from free-text conversation.
- **`EntrepreneurProfile`** ([`src/lib/lokScore.ts`](../src/lib/lokScore.ts)) — the NSFDC cockpit's own profile, filled in via the `/scan` form and used to compute LokScore, finance, and multisig sanction.

Both are correct and working for their own subsystem, and **neither is being replaced or migrated by this change.** `ApplicantProfile` is a third, neutral type that either side can project into (and, where honest, back out of) so that a future cross-workstream consumer — a persistence layer, an application-assembly engine, a voice pipeline — has **one** contract to read instead of reverse-engineering two subsystem-internal types.

Think of it as a translation layer, not a source of truth. `UserProfile` and `EntrepreneurProfile` remain the sources of truth for their own subsystems.

## Ownership boundary

`ApplicantProfile` is owned by the AI/intelligence workstream as a shared artifact, but it is **not** an AI-only concept — any workstream may read it, and any workstream may propose new fields via a PR, following the rules below. It lives in `src/shared/`, not `src/assistant/`, precisely so it doesn't read as assistant-owned.

Nobody should:
- Add fields to `UserProfile` or `EntrepreneurProfile` just to satisfy `ApplicantProfile` — extend `ApplicantProfile` instead, and add an adapter mapping when the source type actually gains that fact.
- Fork a second "canonical profile" type elsewhere in the repo. If existing fields don't cover a new need, extend this file.

## What belongs in ApplicantProfile

Facts *about the applicant* that are useful across more than one subsystem:

- Identity (name, age, gender, phone)
- Location (state, district, village/town, area type, coordinates, raw text before geocoding)
- Social/category (SC/ST/OBC/General)
- Business intent (description, sector, stage, experience)
- Financial context (income, investment need, own contribution/margin money, financing need, existing loans)
- Assets/resources (education, land/assets)
- Conversationally-discovered free text not yet mapped to a structured field (`rawNotes`)
- **Provenance** for each populated field: who/what supplied it (`user_provided` / `system_derived` / `ai_extracted` / `government_verified` / `imported_unknown`) and, optionally, a confidence level and the raw text it was extracted from.

Every field is optional except `rawNotes` — a profile is expected to start empty and be enriched progressively across many turns, forms, or sessions. Nothing is ever defaulted or guessed to fill a gap; an unknown fact stays absent.

## What does NOT belong in ApplicantProfile

Deliberately excluded, and any future field addition should be checked against this list:

- **Government scheme facts** (scheme names, eligibility criteria, loan ceilings, interest rates). Those live in `src/assistant/data/schemes.ts` and the retrieval/eligibility pipeline — an applicant profile describes the citizen, not the schemes they might match.
- **Approval/eligibility decisions.** `EligibilityResult` (assistant) and any future sanction/approval state are outputs *computed from* a profile plus scheme rules — never stored on the profile itself. Storing a decision on the input would blur "what we know about the citizen" with "what we've decided about their application."
- **LokScore or any of its component scores.** `LokScoreBreakdown` ([`src/lib/lokScore.ts`](../src/lib/lokScore.ts)) stays the single place a score is computed and owned. `ApplicantProfile` supplies *inputs* a score calculator might use (income, margin, category, location) — it never carries a score value itself, so there is exactly one LokScore implementation, not a second one hiding inside the shared contract.
- **Execution-only configuration** — which seeded village dataset to query, search radius, demo-mode flags (`EntrepreneurProfile.locationMode`, `.radiusKm`, `.demoMode`, `.villageId`). These describe *how a subsystem should look something up*, not a fact about the citizen, so they're intentionally left off.

If you're unsure whether a new field belongs here, ask: "is this true about the citizen regardless of which subsystem is asking?" If yes, it likely belongs. If it's an output of a computation or a subsystem's own lookup key, it doesn't.

## Shape

```ts
interface ApplicantProfile {
  applicantId?: string                 // set once a backend persists this profile
  data: ApplicantProfileData           // the flat fact bag — see the file for the full field list
  fieldProvenance: Partial<Record<ApplicantProfileFieldKey, FieldProvenance>>
  updatedAt: string                    // ISO timestamp, last change
}
```

`data` is deliberately flat (not nested per domain) to mirror `UserProfile`'s existing shape and keep every adapter a simple field-by-field copy. `fieldProvenance` is a sibling map, not inlined onto `data`, so an applicant's own field values can never collide with envelope metadata.

## Progressive enrichment

Use `createEmptyApplicantProfile()` to start, then `withApplicantField` / `withApplicantFields` to add facts as they're learned — each call records the value and its provenance atomically, so the two can never drift apart. `withApplicantField(profile, field, undefined, ...)` is a no-op by design: this contract never records "unknown" as if it were a captured fact. `withRawNote` appends a free-text fragment that hasn't been mapped to a structured field yet (mirrors `UserProfile.rawNotes`).

All mutator functions are pure — they return a new `ApplicantProfile` and never modify the one passed in, matching the immutable-merge style already used by `src/assistant/profileExtraction.ts`'s `mergeProfile`.

## How existing profiles relate to it

| | `UserProfile` → `ApplicantProfile` | `ApplicantProfile` → `UserProfile` | `EntrepreneurProfile` → `ApplicantProfile` | `ApplicantProfile` → `EntrepreneurProfile` |
|---|---|---|---|---|
| Function | `applicantProfileFromUserProfile` | `applicantProfileToUserProfile` | `applicantProfileFromEntrepreneurProfile` | `applicantProfileToEntrepreneurProfileDraft` |
| Completeness | Full | Full (total, never partial) | Full for what `EntrepreneurProfile` has | **Partial draft only** |
| Notes | Provenance defaults to `imported_unknown` (see below) | `occupation` and other UserProfile-only fields are dropped | Optionally takes a `ResolvedLocation` to fill in place name/coordinates `EntrepreneurProfile` itself doesn't carry | Never fills `villageId`, `locationMode`, `radiusKm` — see below |

**Why the reverse cockpit adapter returns a `Partial<EntrepreneurProfile>`, not a full one:** `EntrepreneurProfile` requires fields that describe *how to run a cockpit query* (`villageId`, `locationMode`, `radiusKm`), not facts about the applicant. `ApplicantProfile` has nothing honest to put there. Rather than invent a default (e.g. silently picking the first seeded village), the adapter returns only what it can honestly derive; a caller (e.g. a future "pre-fill my `/scan` form from what I already told the voice assistant" flow) merges the draft into its own form defaults and the citizen/form supplies the rest.

**Why `applicantProfileFromUserProfile`/`applicantProfileFromEntrepreneurProfile` default provenance to `imported_unknown`:** neither `UserProfile` nor `EntrepreneurProfile` tracks per-field provenance today, so at adapter time we genuinely don't know whether a given value was directly stated, deterministically extracted, or derived. Marking it `imported_unknown` is more honest than guessing `user_provided`. A caller that *does* know the finer-grained truth for a specific call (e.g. the assistant orchestrator, which knows a field was just parsed from this turn's message) can pass `{ source: 'user_provided' }` (or another source) as an override.

**Known gaps, left unmapped rather than guessed** (see inline comments in `applicantProfileFromEntrepreneurProfile` for the full reasoning):
- `state` — neither `EntrepreneurProfile` nor `ResolvedLocation` carries an explicit state field today.
- `areaType` — "rural" is LokPulse's product framing, not a field either source type states.
- `businessStage`/`businessStatus` — `experienceYears` alone isn't a reliable signal for idea vs. new vs. existing-expansion.

## How other teams should consume it

- **Read-only today.** Nothing currently writes `ApplicantProfile` into a shared store — there is no persistence layer yet (Vamshi's future backend concern). Treat it as an in-memory projection you can build on demand from whichever legacy profile you have.
- **Don't reach into `UserProfile`/`EntrepreneurProfile` internals from a new cross-cutting feature** (e.g. a future application-assembly engine) — reach into `ApplicantProfile` via the adapters instead, so that feature stays decoupled from either subsystem's internal shape.
- **If you need a fact this contract doesn't have**, add it to `ApplicantProfileData` in `src/shared/applicantProfile.ts` (remember to add it to `APPLICANT_FIELD_KEY_MAP` too — TypeScript enforces this list stays exhaustive) and extend the relevant adapter(s). Don't add a parallel field to `UserProfile`/`EntrepreneurProfile` that duplicates it unless that subsystem independently needs it for its own logic.
- **Sector/category taxonomy is intentionally not unified.** `ApplicantProfileData.businessSector` is an open string (the assistant's vocabulary, `src/assistant/lexicon.ts`, is larger than the cockpit's 6-value `BusinessCategory` enum). `applicantProfileToEntrepreneurProfileDraft` only maps a sector across when it's an exact match to a valid `BusinessCategory` value; anything else (e.g. `"tailoring"`) is left unmapped rather than guessed at. If your workstream needs a unified sector taxonomy, that's a separate decision to raise, not something this contract should paper over silently.

## Tests

[`src/shared/applicantProfile.test.ts`](../src/shared/applicantProfile.test.ts) covers: empty-profile invariants, field/provenance atomicity, immutability, the `undefined`-is-a-no-op rule, both adapter directions (including round-tripping a full `UserProfile`), the `ResolvedLocation`-enriched and bare `EntrepreneurProfile` cases, and the "never invent `villageId`/`locationMode`/`radiusKm`, never guess an invalid sector" guarantees on the reverse cockpit draft.
