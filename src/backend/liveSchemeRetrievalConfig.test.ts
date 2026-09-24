/**
 * Tests the self-diagnosing not_configured helper used by the DEPLOYED
 * supabase/functions/live-scheme-retrieval Edge Function (Deno) — not the
 * separate src/backend/services/officialSource/dataGovInAdapter.ts (Node),
 * which has its own, differently-named config and its own test file. See
 * docs/BACKEND_INTEGRATION.md and .env.example for why these two are kept
 * distinct.
 *
 * Imported directly from supabase/functions/ (outside src/) because the
 * helper is deliberately Deno-and-Node-portable — see missingConfig.ts's
 * own header for why it is a separate file from index.ts, which Vitest
 * could never import (it starts with a Deno-only `https://esm.sh/...` URL
 * import that Node cannot resolve).
 */
import { describe, expect, it } from 'vitest'
import { getMissingDataGovInConfigNames } from '../../supabase/functions/live-scheme-retrieval/missingConfig'

describe('getMissingDataGovInConfigNames', () => {
  it('reports both names missing when both are absent', () => {
    expect(getMissingDataGovInConfigNames(undefined, undefined)).toEqual([
      'DATA_GOV_IN_API_KEY',
      'DATA_GOV_IN_RESOURCE_ID',
    ])
  })

  it('reports only the API key missing when the resource id is present', () => {
    expect(getMissingDataGovInConfigNames(undefined, 'some-resource-id')).toEqual(['DATA_GOV_IN_API_KEY'])
  })

  it('reports only the resource id missing when the API key is present', () => {
    // This is the exact real-world mistake Phase 1 found: .env.example used
    // to document the WRONG name for this variable
    // (DATA_GOV_IN_SCHEME_RESOURCE_ID), so a caller could set an API key
    // correctly and still silently fail here with no indication why.
    expect(getMissingDataGovInConfigNames('some-api-key', undefined)).toEqual(['DATA_GOV_IN_RESOURCE_ID'])
  })

  it('reports nothing missing when both are present', () => {
    expect(getMissingDataGovInConfigNames('some-api-key', 'some-resource-id')).toEqual([])
  })

  it('treats an empty string the same as absent, for both variables', () => {
    expect(getMissingDataGovInConfigNames('', '')).toEqual(['DATA_GOV_IN_API_KEY', 'DATA_GOV_IN_RESOURCE_ID'])
  })

  it('never echoes the actual PRESENT value, even when it looks like a real secret', () => {
    // Regression guard, with the secret-looking value actually passed IN
    // this time (unlike a naive version of this test that could pass
    // vacuously by never supplying one). By construction this function only
    // ever returns the two fixed literal names, never its inputs — this
    // fails loudly if a future edit ever interpolates a value into the
    // diagnostic instead of just checking truthiness.
    const secretLookingApiKey = 'AIzaSyDEFINITELY_NOT_A_REAL_KEY_1234567890'
    const secretLookingResourceId = 'super-secret-resource-guid-should-never-appear'

    const onlyKeyPresent = getMissingDataGovInConfigNames(secretLookingApiKey, undefined)
    expect(onlyKeyPresent).toEqual(['DATA_GOV_IN_RESOURCE_ID'])
    expect(JSON.stringify(onlyKeyPresent)).not.toContain(secretLookingApiKey)
    expect(JSON.stringify(onlyKeyPresent)).not.toMatch(/AIza/)

    const bothPresent = getMissingDataGovInConfigNames(secretLookingApiKey, secretLookingResourceId)
    expect(bothPresent).toEqual([])
    expect(JSON.stringify(bothPresent)).not.toContain(secretLookingApiKey)
    expect(JSON.stringify(bothPresent)).not.toContain(secretLookingResourceId)
  })
})
