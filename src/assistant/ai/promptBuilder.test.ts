import { describe, expect, it } from 'vitest'
import { SCHEMES } from '../data/schemes'
import { rankSchemes } from '../ranking'
import { EMPTY_PROFILE, type UserProfile } from '../types'
import { ASSISTANT_SYSTEM_PROMPT, buildUserTurn } from './promptBuilder'
import type { AIRequestContext } from './types'

describe('ASSISTANT_SYSTEM_PROMPT — anti-hallucination contract', () => {
  it('explicitly forbids inventing schemes, amounts, and eligibility', () => {
    expect(ASSISTANT_SYSTEM_PROMPT).toMatch(/Only ever discuss schemes/i)
    expect(ASSISTANT_SYSTEM_PROMPT).toMatch(/never state or imply a loan amount/i)
    expect(ASSISTANT_SYSTEM_PROMPT).toMatch(/do not recompute/i)
    expect(ASSISTANT_SYSTEM_PROMPT).toMatch(/never say a user is "approved"/i)
  })
})

describe('buildUserTurn — evidence block only contains supplied schemes', () => {
  const profile: UserProfile = {
    ...EMPTY_PROFILE,
    state: 'Karnataka',
    socialCategory: 'sc',
    businessSector: 'poultry',
    businessStage: 'new',
  }

  it('lists exactly the top schemes passed in ranked, and no others from the full dataset', () => {
    const ranked = rankSchemes(profile, 'poultry loan')
    const context: AIRequestContext = {
      profile,
      message: 'poultry loan',
      history: [],
      missingFields: [],
      ranked,
      newlyUpdatedFields: [],
    }
    const turn = buildUserTurn(context)

    const shownNames = ranked.slice(0, 5).map((r) => r.scheme.name)
    for (const name of shownNames) {
      expect(turn).toContain(name)
    }
    const hiddenNames = SCHEMES.map((s) => s.name).filter((n) => !shownNames.includes(n))
    for (const name of hiddenNames) {
      expect(turn).not.toContain(name)
    }
  })

  it('says plainly that nothing matched when ranked is empty, rather than omitting the section', () => {
    const context: AIRequestContext = {
      profile: EMPTY_PROFILE,
      message: 'hi',
      history: [],
      missingFields: [],
      ranked: [],
      newlyUpdatedFields: [],
    }
    expect(buildUserTurn(context)).toMatch(/No schemes in the knowledge base matched/i)
  })

  it('includes the official info URL for every shown scheme so the model can point to it instead of guessing', () => {
    const ranked = rankSchemes(profile, 'poultry loan')
    const context: AIRequestContext = {
      profile,
      message: 'poultry loan',
      history: [],
      missingFields: [],
      ranked,
      newlyUpdatedFields: [],
    }
    const turn = buildUserTurn(context)
    for (const r of ranked.slice(0, 5)) {
      expect(turn).toContain(r.scheme.officialInfoUrl)
    }
  })

  it('surfaces the deterministic eligibility status so the model is told, not asked to guess', () => {
    const ranked = rankSchemes(profile, 'poultry loan')
    const context: AIRequestContext = {
      profile,
      message: 'poultry loan',
      history: [],
      missingFields: [],
      ranked,
      newlyUpdatedFields: [],
    }
    const turn = buildUserTurn(context)
    for (const r of ranked.slice(0, 5)) {
      expect(turn).toContain(r.eligibility.status)
    }
  })

  it('includes live evidence as a distinct, clearly-sourced line when present', () => {
    const ranked = rankSchemes(profile, 'poultry loan')
    ranked[0] = {
      ...ranked[0],
      liveEvidence: [
        {
          schemeId: ranked[0].scheme.id,
          sourceName: 'data.gov.in (Open Government Data Platform)',
          sourceUrl: 'https://api.data.gov.in/resource/live123',
          sourceType: 'official_open_data',
          verificationStatus: 'live_official',
          retrievedAt: '2026-09-12T10:00:00.000Z',
          summary: '1,204 units sanctioned in Karnataka in FY2023-24.',
        },
      ],
    }
    const context: AIRequestContext = {
      profile,
      message: 'poultry loan',
      history: [],
      missingFields: [],
      ranked,
      newlyUpdatedFields: [],
    }
    const turn = buildUserTurn(context)
    expect(turn).toContain('Live official data')
    expect(turn).toContain('1,204 units sanctioned in Karnataka in FY2023-24.')
    expect(turn).toContain('https://api.data.gov.in/resource/live123')
  })
})
