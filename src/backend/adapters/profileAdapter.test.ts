import { describe, expect, it } from 'vitest'
import { defaultProfile } from '../../lib/demoProfile'
import { buildSchemePlan } from '../../lib/finance'
import { computeLokScore } from '../../lib/lokScore'
import { curatedLocationFromVillage } from '../../lib/resolveLocation'
import { VILLAGES } from '../../data/villages'
import { unavailableWeather } from '../../lib/weather'
import {
  applyProfilePatch,
  createEmptyApplicantProfileV2,
  fromEntrepreneurProfile,
  getMissingFields,
  toEntrepreneurProfile,
} from '../index'

describe('ApplicantProfileV2 + adapter', () => {
  it('creates an empty profile with ranked missing engine fields', () => {
    const p = createEmptyApplicantProfileV2('en')
    const missing = getMissingFields(p)
    expect(missing.length).toBeGreaterThan(5)
    expect(missing[0]!.priority).toBeGreaterThanOrEqual(missing[missing.length - 1]!.priority)
    expect(missing.some((m) => m.key === 'name')).toBe(true)
  })

  it('applyProfilePatch merges voice extracts immutably', () => {
    const p0 = createEmptyApplicantProfileV2('mixed')
    const p1 = applyProfilePatch(p0, {
      name: { value: 'Lakshmi', confidence: 'high', source: 'voice' },
      category: { value: 'dairy', confidence: 'medium', source: 'voice' },
    })
    expect(p0.name.value).toBeNull()
    expect(p1.name.value).toBe('Lakshmi')
    expect(p1.name.source).toBe('voice')
    expect(p1.category.value).toBe('dairy')
    expect(p1.locale).toBe('mixed')
  })

  it('fails adaptation until required fields are present', () => {
    const p = createEmptyApplicantProfileV2()
    const patched = applyProfilePatch(p, {
      name: { value: 'A', confidence: 'high', source: 'user' },
    })
    const result = toEntrepreneurProfile(patched)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.partial.name).toBe('A')
      expect(result.missing.some((m) => m.key === 'availableMargin')).toBe(true)
    }
  })

  it('round-trips demo EntrepreneurProfile and keeps engines green', () => {
    const v1 = defaultProfile()
    const v2 = fromEntrepreneurProfile(v1, 'en')
    const adapted = toEntrepreneurProfile(v2)
    expect(adapted.ok).toBe(true)
    if (!adapted.ok) return

    expect(adapted.profile.name).toBe(v1.name)
    expect(adapted.profile.availableMargin).toBe(100_000)
    expect(adapted.profile.villageId).toBe('dinka-mandya')
    expect(adapted.profile.category).toBe('dairy')

    const plan = buildSchemePlan(adapted.profile.availableMargin)
    expect(plan.schemeId).toBe('term_loan')
    expect(plan.projectCost).toBe(1_000_000)
    expect(plan.loanAmount).toBe(900_000)

    const location = curatedLocationFromVillage(VILLAGES[0]!, 7)
    const score = computeLokScore({
      profile: adapted.profile,
      location,
      weather: unavailableWeather(),
      mandi: null,
      plan,
    })
    expect(score.total).toBeGreaterThan(0)
    expect(score.quorumRequired).toBeGreaterThanOrEqual(2)
  })

  it('requires villageId when locationMode is curated', () => {
    const v1 = defaultProfile()
    const v2 = fromEntrepreneurProfile(v1)
    const cleared = applyProfilePatch(v2, {
      villageId: { value: null, confidence: 'unknown', source: 'system' },
    })
    const result = toEntrepreneurProfile(cleared)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.missing.some((m) => m.key === 'villageId')).toBe(true)
    }
  })
})
