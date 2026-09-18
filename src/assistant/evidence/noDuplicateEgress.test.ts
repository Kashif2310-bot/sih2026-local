import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Mechanical guard for Prompt 8's "one canonical government-data network
 * egress" invariant: supabase/functions/live-scheme-retrieval is the only
 * place this app calls an external government API from. This test asserts
 * the active assistant runtime's source never imports a second one —
 * specifically src/backend/services/officialSource/dataGovInAdapter.ts
 * (a separate, backend-only data.gov.in adapter — confirmed legacy/unused
 * by the assistant runtime, left untouched, never wired in here) and never
 * imports anything under src/backend/* at all, since that whole tree is a
 * different workstream's module graph.
 *
 * A real static import-graph check would need a bundler; reading the
 * source text is a deliberately simple, dependency-free proxy for it that
 * still catches the actual mistake this guards against (a new `import
 * ... from '../../backend/...'` landing in the assistant runtime).
 */
function sourceOf(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')
}

describe('no duplicate government-data network egress in the active assistant runtime', () => {
  it('orchestrator.ts never imports from src/backend/*', () => {
    const src = sourceOf('../orchestrator.ts')
    expect(src).not.toMatch(/from\s+['"].*\/backend\//)
  })

  it('the evidence layer never imports from src/backend/*', () => {
    for (const file of [
      '../evidence/governmentEvidenceOrchestrator.ts',
      '../evidence/dataGovInConnector.ts',
      '../evidence/schemeBinding.ts',
    ]) {
      const src = sourceOf(file)
      expect(src).not.toMatch(/from\s+['"].*\/backend\//)
    }
  })

  it('AssistantContext.tsx never imports from src/backend/*', () => {
    const src = sourceOf('../state/AssistantContext.tsx')
    expect(src).not.toMatch(/from\s+['"].*\/backend\//)
  })

  it('the assistant runtime only ever invokes the canonical Edge Function name', () => {
    const src = sourceOf('../liveRetrieval.ts')
    expect(src).toMatch(/live-scheme-retrieval/)
    // No second Edge Function / external data.gov.in URL literal anywhere in the retriever.
    expect(src).not.toMatch(/api\.data\.gov\.in/)
  })
})
