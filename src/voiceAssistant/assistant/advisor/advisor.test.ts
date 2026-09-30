import { describe, expect, it } from 'vitest'
import { rankSchemes } from '../../../assistant/ranking'
import { SCHEMES } from '../../../assistant/data/schemes'
import { extractCitizenFacts } from '../../application/extraction'
import {
  chooseApplicationScheme,
  deriveAdvisorView,
  focusSearch,
  ingestUtterance,
  INITIAL_ADVISOR_STATE,
  type AdvisorState,
} from './advisor'
import { runAdvisorTool } from './advisorTools'

const extractApplicantIdentity = (text: string) => {
  const { applicantName, mobile } = extractCitizenFacts(text).details
  return { ...(applicantName ? { applicantName } : {}), ...(mobile ? { mobile } : {}) }
}

const say = (state: AdvisorState, ...lines: string[]) => lines.reduce((s, line) => ingestUtterance(s, line).state, state)
const view = (state: AdvisorState) => deriveAdvisorView(state)
const order = (state: AdvisorState) => view(state).matches.map((m) => m.id)
const percents = (state: AdvisorState) => Object.fromEntries(view(state).matches.map((m) => [m.id, m.matchPercent]))
const field = (state: AdvisorState, key: string) => view(state).application?.fields.find((f) => f.key === key)?.value

const KERALA = 'I am 26 years old and I live in Kerala.'
const DAIRY = 'I want to start a small dairy business.'
const INCOME = 'My family income is 2.5 lakh per year.'
const SC_RURAL = 'I belong to the SC category and I live in a village.'

describe('advisor pipeline (main-prototype engine)', () => {
  it('shows nothing before any fact, and real results from a partial profile', () => {
    expect(view(INITIAL_ADVISOR_STATE).matches).toEqual([])
    const state = say(INITIAL_ADVISOR_STATE, KERALA)
    const v = view(state)
    expect(v.profile).toMatchObject({ age: 26, state: 'Kerala' })
    expect(v.matches.length).toBeGreaterThan(0)
    expect(v.top).not.toBeNull()
    expect(v.application).not.toBeNull()
  })

  it('uses the real matcher and data: same order and scores as rankSchemes, only ids from the curated dataset', () => {
    const state = say(INITIAL_ADVISOR_STATE, KERALA, DAIRY)
    const ranked = rankSchemes(state.profile)
    expect(order(state)).toEqual(ranked.map((r) => r.scheme.id))
    expect(view(state).matches.map((m) => m.matchPercent)).toEqual(ranked.map((r) => r.rankScore))
    const known = new Set(SCHEMES.map((s) => s.id))
    for (const id of order(state)) expect(known.has(id)).toBe(true)
  })

  it('a second fact changes the ranking and a new #1 emerges', () => {
    const one = say(INITIAL_ADVISOR_STATE, KERALA)
    const two = say(one, DAIRY)
    expect(order(two)).not.toEqual(order(one))
    expect(view(two).top?.id).not.toBe(view(one).top?.id)
    const three = say(two, INCOME, SC_RURAL)
    expect(view(three).top?.id).not.toBe(view(two).top?.id)
  })

  it('match percentages change as facts arrive, and never go stale', () => {
    const one = say(INITIAL_ADVISOR_STATE, KERALA)
    const two = say(one, DAIRY)
    expect(percents(two)).not.toEqual(percents(one))
    const again = deriveAdvisorView(two)
    expect(view(two).matches).toEqual(again.matches)
    expect(view(two).revision).toBeGreaterThan(view(one).revision)
  })

  it('is deterministic: the same conversation always gives the same results', () => {
    const lines = [KERALA, DAIRY, INCOME, SC_RURAL, 'I need a loan of 2 lakh.']
    const a = view(say(INITIAL_ADVISOR_STATE, ...lines))
    const b = view(say(INITIAL_ADVISOR_STATE, ...lines))
    expect(a.matches).toEqual(b.matches)
    expect(a.application).toEqual(b.application)
    for (const match of a.matches) expect(Number.isInteger(match.matchPercent)).toBe(true)
  })

  it('keeps the main status-first order, and percentages descend within a status tier', () => {
    const matches = view(say(INITIAL_ADVISOR_STATE, KERALA, DAIRY, INCOME, SC_RURAL)).matches
    const weight = { likely_eligible: 3, possibly_eligible: 2, insufficient_data: 1, likely_ineligible: 0 }
    for (let i = 1; i < matches.length; i++) {
      const [prev, cur] = [matches[i - 1], matches[i]]
      expect(weight[prev.status]).toBeGreaterThanOrEqual(weight[cur.status])
      if (prev.status === cur.status) expect(prev.matchPercent).toBeGreaterThanOrEqual(cur.matchPercent)
    }
  })

  it('a question with no new facts does not reshuffle the list', () => {
    const state = say(INITIAL_ADVISOR_STATE, KERALA, DAIRY, INCOME)
    const asked = ingestUtterance(state, 'What scheme matches me best right now?')
    expect(asked.updatedFields).toEqual([])
    expect(asked.state).toBe(state)
    expect(order(focusSearch(state, undefined).state)).toEqual(order(state))
  })

  it('fills the application draft incrementally, including name and mobile', () => {
    let state = say(INITIAL_ADVISOR_STATE, KERALA)
    expect(field(state, 'age')).toBe(26)
    expect(field(state, 'state')).toBe('Kerala')
    expect(field(state, 'applicant_name')).toBeUndefined()
    const filled1 = view(state).application!.readiness.fieldsDone

    state = say(state, 'My name is Rahul.')
    expect(field(state, 'applicant_name')).toBe('Rahul')
    state = say(state, DAIRY, INCOME)
    expect(field(state, 'business_sector')).toBe('dairy')
    expect(field(state, 'business_stage')).toBe('new')
    expect(field(state, 'annual_income')).toBe(250000)
    state = say(state, 'My mobile number is 98765 43210.', 'I need a loan of 2 lakh.')
    expect(field(state, 'mobile')).toBe('9876543210')
    expect(field(state, 'loan_amount_requested')).toBe(200000)
    expect(view(state).application!.readiness.fieldsDone).toBeGreaterThan(filled1)
  })

  it('the application follows a new #1, unless the citizen chose a scheme', () => {
    const before = say(INITIAL_ADVISOR_STATE, KERALA)
    const after = say(before, DAIRY)
    expect(view(before).application?.schemeId).toBe(view(before).top?.id)
    expect(view(after).application?.schemeId).toBe(view(after).top?.id)
    expect(view(after).application?.schemeId).not.toBe(view(before).application?.schemeId)

    const pinned = chooseApplicationScheme(after, view(after).matches[2].id)
    const moved = say(pinned, SC_RURAL)
    expect(view(moved).application?.schemeId).toBe(view(after).matches[2].id)
    expect(view(moved).application?.basis).toBe('chosen')
  })

  it('later statements correct earlier ones, and the old value never lingers', () => {
    const state = say(INITIAL_ADVISOR_STATE, 'I live in Karnataka.', 'Actually I live in Kerala, not Karnataka.')
    expect(view(state).profile.state).toBe('Kerala')
    expect(field(state, 'state')).toBe('Kerala')
  })

  it('reads the old sandbox test sentences through the main extractor', () => {
    const p = (text: string) => view(say(INITIAL_ADVISOR_STATE, text)).profile
    expect(p("I'm twenty six years old")).toMatchObject({ age: 26 })
    expect(p('I have 5 cows').age).toBeUndefined()
    expect(p('I am not from Kerala, I live in Karnataka').state).toBe('Karnataka')
    expect(p('I lived in Bihar but now I live in Tamil Nadu').state).toBe('Tamil Nadu')
    expect(p('I belong to the SC category').socialCategory).toBe('sc')
    expect(p('I finished 1st in class').socialCategory).toBeUndefined()
    expect(p('my income is 2.5 lakh per year').annualIncome).toBe(250000)
    expect(ingestUtterance(INITIAL_ADVISOR_STATE, 'Hello, how are you?').updatedFields).toEqual([])
  })
})

describe('applicant identity', () => {
  it('reads a name and an Indian mobile number, and nothing from ordinary sentences', () => {
    expect(extractApplicantIdentity('My name is Rahul')).toEqual({ applicantName: 'Rahul' })
    expect(extractApplicantIdentity('my name is priya nair and I am from Kerala')).toEqual({ applicantName: 'Priya Nair' })
    expect(extractApplicantIdentity('call me +91 98765-43210')).toEqual({ mobile: '9876543210' })
    expect(extractApplicantIdentity(KERALA)).toEqual({})
    expect(extractApplicantIdentity(INCOME)).toEqual({})
    expect(extractApplicantIdentity('I did it myself and it worked')).toEqual({})
  })
})

describe('advisor tools have real effects', () => {
  it('recordCitizenDetail updates the one authoritative profile and reports the new top match', () => {
    const { state, outcome } = runAdvisorTool(INITIAL_ADVISOR_STATE, { name: 'recordCitizenDetail', args: { detail: KERALA } })
    expect(state.profile).toMatchObject({ age: 26, state: 'Kerala' })
    expect(state).toEqual(ingestUtterance(INITIAL_ADVISOR_STATE, KERALA).state)
    expect(outcome.ok).toBe(true)
    const data = (outcome as { data: Record<string, any> }).data
    expect(data.recorded).toEqual(['age', 'state'])
    expect(data.topMatch.schemeId).toBe(view(state).top?.id)
  })

  it('recordCitizenDetail with nothing recognisable says so instead of claiming it saved', () => {
    const { state, outcome } = runAdvisorTool(INITIAL_ADVISOR_STATE, { name: 'recordCitizenDetail', args: { detail: 'hmm okay' } })
    expect(state).toBe(INITIAL_ADVISOR_STATE)
    expect((outcome as { data: Record<string, any> }).data.recorded).toEqual([])
    expect((outcome as { data: Record<string, any> }).data.note).toMatch(/nothing was saved/)
  })

  it('recordCitizenDetail for a detail the transcript already captured confirms it is on file', () => {
    const heard = ingestUtterance(INITIAL_ADVISOR_STATE, KERALA).state
    const { state, outcome } = runAdvisorTool(heard, { name: 'recordCitizenDetail', args: { detail: KERALA } })
    const data = (outcome as { data: Record<string, any> }).data
    expect(state).toBe(heard)
    expect(data.recorded).toEqual([])
    expect(data.alreadyOnFile).toEqual(['age', 'state'])
    expect(data.note).toMatch(/already on file/)
  })

  it('findSchemes returns the real ranking with the displayed percentages and an honest source label', () => {
    const base = say(INITIAL_ADVISOR_STATE, KERALA, DAIRY)
    const { outcome } = runAdvisorTool(base, { name: 'findSchemes', args: {} })
    const data = (outcome as { data: Record<string, any> }).data
    expect(data.matches.map((m: { schemeId: string }) => m.schemeId)).toEqual(order(base).slice(0, 5))
    expect(data.matches[0].matchPercent).toBe(view(base).matches[0].matchPercent)
    expect(data.sourceStatus).toMatch(/not_live/)
  })

  it('findSchemes with nothing known asks for details instead of guessing', () => {
    const { outcome } = runAdvisorTool(INITIAL_ADVISOR_STATE, { name: 'findSchemes', args: {} })
    expect((outcome as { data: Record<string, any> }).data.matches).toEqual([])
  })

  it('getSchemeDetails returns dataset details and shows the scheme without moving the application; unknown ids fail honestly', () => {
    const base = say(INITIAL_ADVISOR_STATE, KERALA, DAIRY)
    const id = view(base).matches[1].id
    const { state, outcome } = runAdvisorTool(base, { name: 'getSchemeDetails', args: { schemeId: id } })
    const scheme = SCHEMES.find((s) => s.id === id)!
    const data = (outcome as { data: Record<string, any> }).data
    expect(data.name).toBe(scheme.name)
    expect(data.documents).toEqual(scheme.documents)
    expect(data.lastVerifiedDate).toBe(scheme.lastVerifiedDate)
    expect(state.detailSchemeId).toBe(id)
    expect(view(state).detailSchemeId).toBe(id)
    expect(view(state).application?.schemeId).toBe(view(base).application?.schemeId)
    expect(state.applicationSchemeId).toBeNull()

    const missing = runAdvisorTool(base, { name: 'getSchemeDetails', args: { schemeId: 'made-up-yojana' } })
    expect(missing.outcome).toMatchObject({ ok: false, error: 'scheme_not_found' })
  })

  it('getCitizenProfile and getApplicationReadiness read the same state the UI shows', () => {
    const base = say(INITIAL_ADVISOR_STATE, 'My name is Rahul.', KERALA, DAIRY)
    const profile = (runAdvisorTool(base, { name: 'getCitizenProfile', args: {} }).outcome as { data: Record<string, any> }).data
    expect(profile.known).toMatchObject({ applicantName: 'Rahul', age: 26, state: 'Kerala', businessSector: 'dairy' })
    expect(profile.stillNeeded.map((m: { item: string }) => m.item)).toEqual(view(base).application?.missing.map((m) => m.label))
    expect(profile.nextToAsk).toBe(view(base).nextQuestion?.question)

    const readiness = (runAdvisorTool(base, { name: 'getApplicationReadiness', args: {} }).outcome as { data: Record<string, any> }).data
    expect(readiness.application.schemeId).toBe(view(base).application?.schemeId)
    expect(readiness.missingFields.map((m: { field: string }) => m.field)).toEqual(
      view(base).application?.missing.filter((m) => m.kind === 'field').map((m) => m.label),
    )
  })

  it('rejects malformed and unknown tool calls without changing state', () => {
    expect(runAdvisorTool(INITIAL_ADVISOR_STATE, { name: 'recordCitizenDetail', args: { detail: 42 } }).outcome).toMatchObject({
      ok: false,
      error: 'invalid_arguments',
    })
    expect(runAdvisorTool(INITIAL_ADVISOR_STATE, { name: 'submitApplication', args: {} }).outcome).toMatchObject({
      ok: false,
      error: 'unknown_tool',
    })
  })
})
