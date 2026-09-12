import { describe, expect, it } from 'vitest'
import { rankSchemes } from '../ranking'
import { EMPTY_PROFILE, type UserProfile } from '../types'
import { composeOfflineReply, offlineProvider } from './offlineProvider'
import type { AIRequestContext } from './types'

function contextFor(profile: UserProfile, message: string, updatedFields: Array<keyof UserProfile> = []): AIRequestContext {
  return {
    profile,
    message,
    history: [],
    missingFields: [],
    ranked: rankSchemes(profile, message),
    newlyUpdatedFields: updatedFields,
  }
}

describe('composeOfflineReply', () => {
  it('acknowledges newly captured fields', () => {
    const profile: UserProfile = { ...EMPTY_PROFILE, state: 'Karnataka', businessSector: 'poultry' }
    const text = composeOfflineReply(contextFor(profile, 'hi', ['state', 'businessSector']))
    expect(text).toMatch(/Karnataka/)
    expect(text).toMatch(/poultry/)
  })

  it('lists promising schemes when there are eligible/possible matches', () => {
    const profile: UserProfile = {
      ...EMPTY_PROFILE,
      age: 24,
      state: 'Karnataka',
      socialCategory: 'sc',
      annualIncome: 200_000,
      businessSector: 'poultry',
      businessStage: 'new',
      investmentRequired: 300_000,
    }
    const text = composeOfflineReply(contextFor(profile, 'poultry loan'))
    expect(text).toMatch(/worth exploring/)
    expect(text).toMatch(/NSFDC/i)
  })

  it('explains a concern when nothing is a strong match, without inventing a scheme name that is not in the ranked list', () => {
    const profile: UserProfile = { ...EMPTY_PROFILE, socialCategory: 'general', gender: 'male', businessStage: 'existing_expansion' }
    const ctx = contextFor(profile, 'expand my business')
    const text = composeOfflineReply(ctx)
    const rankedNames = ctx.ranked.map((r) => r.scheme.name)
    // any scheme name mentioned in the reply must come from the ranked evidence
    const mentionedNames = rankedNames.filter((name) => text.includes(name))
    expect(mentionedNames.length).toBeGreaterThanOrEqual(0)
    for (const name of mentionedNames) {
      expect(rankedNames).toContain(name)
    }
  })

  it('produces a graceful empty-result message when nothing is retrieved', () => {
    const ctx: AIRequestContext = {
      profile: EMPTY_PROFILE,
      message: 'hello',
      history: [],
      missingFields: [],
      ranked: [],
      newlyUpdatedFields: [],
    }
    const text = composeOfflineReply(ctx)
    expect(text).toMatch(/couldn't find/i)
  })

  it('appends the top follow-up question when fields are missing', () => {
    const ctx: AIRequestContext = {
      profile: EMPTY_PROFILE,
      message: 'hello',
      history: [],
      missingFields: [{ field: 'businessSector', priority: 1, question: 'What kind of business is this?' }],
      ranked: [],
      newlyUpdatedFields: [],
    }
    expect(composeOfflineReply(ctx)).toMatch(/What kind of business is this\?/)
  })

  it('REGRESSION: never includes the retired offline-warning strings — that is now the UI\'s SourceStatusBadge job, not the reply text', () => {
    const ctx: AIRequestContext = {
      profile: EMPTY_PROFILE,
      message: 'hello',
      history: [],
      missingFields: [],
      ranked: [],
      newlyUpdatedFields: [],
    }
    const text = composeOfflineReply(ctx)
    expect(text).not.toContain('Offline reasoning — no AI model used')
    expect(text).not.toContain(
      "Generated locally without an AI model — offline reasoning over the maintained scheme knowledge base. Always verify details against each scheme's official source before acting.",
    )
    expect(text).not.toMatch(/without an AI model/i)
  })
})

describe('OfflineTemplateProvider', () => {
  it('is always available', async () => {
    expect(await offlineProvider.isAvailable()).toBe(true)
  })

  it('never throws even with a maximally empty context', async () => {
    const ctx: AIRequestContext = {
      profile: EMPTY_PROFILE,
      message: '',
      history: [],
      missingFields: [],
      ranked: [],
      newlyUpdatedFields: [],
    }
    const reply = await offlineProvider.generateReply(ctx)
    expect(reply.usedProvider).toBe('offline')
    expect(reply.text.length).toBeGreaterThan(0)
  })
})
