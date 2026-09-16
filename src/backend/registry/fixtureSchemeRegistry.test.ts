import { describe, expect, it } from 'vitest'
import { NSFDC } from '../../lib/config'
import {
  FIXTURE_IDS,
  createFixtureSchemeRegistry,
  createRecommendationService,
  fromEntrepreneurProfile,
} from '../index'
import { defaultProfile } from '../../lib/demoProfile'

describe('fixture scheme registry v0', () => {
  it('lists only NSFDC Micro + Term with honesty envelope', async () => {
    const registry = createFixtureSchemeRegistry()
    const list = await registry.listSchemes()
    expect(list.data).toHaveLength(2)
    expect(list.data.map((s) => s.code).sort()).toEqual([
      'NSFDC_MICRO_FINANCE',
      'NSFDC_TERM_LOAN',
    ])
    expect(list.honestyNoteEn.toLowerCase()).toContain('fixture')
    expect(list.stale).toBe(false)
    expect(list.sourceIds.length).toBeGreaterThan(0)
  })

  it('returns version-pinned loan terms matching config.ts NSFDC constants', async () => {
    const registry = createFixtureSchemeRegistry()
    const micro = await registry.getLatestVerifiedVersion(FIXTURE_IDS.schemeMicro)
    const term = await registry.getLatestVerifiedVersion(FIXTURE_IDS.schemeTerm)
    expect(micro).not.toBeNull()
    expect(term).not.toBeNull()
    expect(micro!.data.loanTerms?.loanCapRupees).toBe(NSFDC.microLoanCapRupees)
    expect(micro!.data.loanTerms?.interestRatePercent).toBe(NSFDC.microRate)
    expect(term!.data.loanTerms?.loanCapRupees).toBe(NSFDC.termLoanCapRupees)
    expect(term!.data.loanTerms?.interestRatePercent).toBe(NSFDC.termRate)
    expect(micro!.data.documents.every((d) => d.indicative)).toBe(true)
  })

  it('maps ministry → NSFDC department', async () => {
    const registry = createFixtureSchemeRegistry()
    const ministries = await registry.listMinistries()
    expect(ministries[0]!.code).toBe('MOSJE')
    const depts = await registry.listDepartments(FIXTURE_IDS.ministryMosje)
    expect(depts).toHaveLength(1)
    expect(depts[0]!.code).toBe('NSFDC')
  })
})

describe('recommendation service v0', () => {
  it('ranks Term Loan for demo ₹1L margin profile and marks eligible', async () => {
    const svc = createRecommendationService(createFixtureSchemeRegistry())
    const profile = fromEntrepreneurProfile(defaultProfile())
    const result = await svc.recommend({ profile })
    expect(result.data.length).toBe(2)
    const top = result.data[0]!
    expect(top.eligible).toBe(true)
    expect(top.schemeCode).toBe('NSFDC_TERM_LOAN')
    expect(top.schemeVersion).toBe('v0.1.0')
    expect(result.honestyNoteEn.toLowerCase()).toContain('deterministic')
  })

  it('marks non-SC as not eligible for NSFDC core schemes', async () => {
    const svc = createRecommendationService(createFixtureSchemeRegistry())
    const profile = fromEntrepreneurProfile({
      ...defaultProfile(),
      community: 'general',
    })
    const result = await svc.recommend({ profile })
    expect(result.data.every((r) => r.eligible === false)).toBe(true)
  })
})
