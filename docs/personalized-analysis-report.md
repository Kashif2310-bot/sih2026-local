# Personalized Analysis & Report Intelligence

**Location:** [`src/assistant/conversation/`](../src/assistant/conversation/)
**Status:** implemented Prompt 7 (2026-09-16). Structured analysis only — no React report page.

## Flow

```
ApplicantProfile + RankedScheme[] + readiness + action plan
        ↓
DeterministicAnalysis     (deterministicAnalysis.ts)
        ↓
PersonalizedReport        (report.ts) — language-neutral, deep-frozen snapshot
        ↓
guarded explanation       (explanationProvider.ts + ai/responseGuard.ts)
        ↓
UI                        (Prerna — out of scope)
```

## What this layer does

Assembles an evidence-grounded personalized analysis answering:

> Given THIS person, THIS business idea, THIS location, THIS situation — what does LokPulse recommend, why, what is uncertain, what should happen next, and how close are they to applying?

It distinguishes:

1. user-provided facts  
2. verified government evidence  
3. deterministic system analysis  
4. uncertainty  
5. assumptions/inferences  
6. missing information  

## What it does NOT do

- Compute new eligibility, ranking, EMI, subsidy, or LokScore formulas  
- Invent schemes, URLs, approvals, profits, or demand  
- Build the visual report UI  
- Submit applications  
- Scrape live government sources (Vamshi)

## Snapshot immutability

Each `buildPersonalizedReport()` returns a **new deep-frozen** object with:

- `reportId` — stable across refreshes when `previous` is passed  
- `version` — increments on every rebuild  

Later conversation turns must never mutate a previously emitted report in place.

## Explanation seam

`attachGuardedExplanation()` may use an offline template or a future AI provider. Every narrative is validated with the **existing** `validateProviderReply` + `findUnapprovedAmounts` before attachment. Failures fall back to deterministic safe text.

## Cross-team boundaries

| Owner | Concern |
|---|---|
| Prerna | Visual report page consuming `PersonalizedReport` |
| Vamshi | Live government-source registry / ingestion feeding evidence |
| Adita | Application submission after `ready_for_application` |
| Jordan | Blockchain/multisig (LokScore quorum) — optional `lokScore` passthrough only |
