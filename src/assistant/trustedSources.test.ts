import { describe, expect, it } from 'vitest'
import { isTrustedGovUrl, TRUSTED_GOV_DOMAINS } from './trustedSources'

describe('isTrustedGovUrl', () => {
  it('accepts an https URL on the allowlist', () => {
    expect(isTrustedGovUrl('https://api.data.gov.in/resource/abc123')).toBe(true)
    expect(isTrustedGovUrl('https://www.nsfdc.nic.in/')).toBe(true)
  })

  it('rejects http (non-https) even for an allowlisted domain', () => {
    expect(isTrustedGovUrl('http://data.gov.in/resource/abc123')).toBe(false)
  })

  it('rejects a domain not on the allowlist', () => {
    expect(isTrustedGovUrl('https://myscheme.gov.in/search')).toBe(false)
  })

  it('rejects a look-alike/typosquat domain', () => {
    expect(isTrustedGovUrl('https://data.gov.in.evil.example.com/resource/abc')).toBe(false)
    expect(isTrustedGovUrl('https://data-gov-in.example.com')).toBe(false)
  })

  it('rejects a malformed URL without throwing', () => {
    expect(() => isTrustedGovUrl('not a url')).not.toThrow()
    expect(isTrustedGovUrl('not a url')).toBe(false)
  })

  it('rejects a data: URI', () => {
    expect(isTrustedGovUrl('data:text/html,<script>alert(1)</script>')).toBe(false)
  })

  it('every domain in the allowlist is a plausible government-linked hostname', () => {
    for (const domain of TRUSTED_GOV_DOMAINS) {
      expect(domain).not.toMatch(/^https?:\/\//)
      expect(domain.length).toBeGreaterThan(3)
    }
  })
})
