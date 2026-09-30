import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FeasibilityInputs, FeasibilityReport, FeasibilityResult } from '../../application/feasibility'
import { ApplicationStore, type StorageLike } from '../../application/store'
import type { ReportSnapshotPayload } from '../../application/submission'
import { AdvisorSession } from './advisorSession'

function memory(): StorageLike {
  const data = new Map<string, string>()
  return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => void data.set(key, value) }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

const report = (inputs: FeasibilityInputs, total: number): FeasibilityResult => ({
  ok: true,
  report: {
    signature: inputs.signature,
    inputs: {
      experienceYears: inputs.profile.experienceYears,
      category: inputs.profile.category,
      gender: inputs.profile.gender,
      community: inputs.profile.community,
    },
    lokScore: { total, grade: 'B' },
  } as unknown as FeasibilityReport,
})

const FACTS: Array<[string, string]> = [
  ['applicant_name', 'Lakshmi Devi'],
  ['mobile', '9845012345'],
  ['age', '32'],
  ['gender', 'female'],
  ['social_category', 'SC'],
  ['annual_income', '1.8 lakh'],
  ['state', 'Karnataka'],
  ['district', 'Mandya'],
  ['area_type', 'rural'],
  ['business_sector', 'dairy'],
  ['business_stage', 'new'],
  ['loan_amount_requested', '12 lakh'],
  ['experience_years', '3'],
]

function fill(session: AdvisorSession, facts = FACTS) {
  for (const [key, value] of facts) expect(session.correctField(key, value), key).toBeUndefined()
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('AdvisorSession', () => {
  it('waits for a pause before the live feasibility lookup, and runs it once per set of inputs', async () => {
    const compute = vi.fn(async (inputs: FeasibilityInputs) => report(inputs, 70))
    const session = new AdvisorSession(() => {}, { store: null, computeFeasibility: compute, feasibilityDebounceMs: 1000 })
    fill(session)
    expect(session.getView().feasibility.status).toBe('computing')
    await vi.advanceTimersByTimeAsync(999)
    expect(compute).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(compute).toHaveBeenCalledTimes(1)
    expect(session.getView().feasibility).toMatchObject({ status: 'ready', report: { lokScore: { total: 70 } } })

    session.correctField('proposed_business', 'two cows')
    await vi.advanceTimersByTimeAsync(2000)
    expect(compute).toHaveBeenCalledTimes(1)
  })

  it('a result for inputs that have since changed is discarded', async () => {
    const runs: Array<{ inputs: FeasibilityInputs; done: ReturnType<typeof deferred<FeasibilityResult>> }> = []
    const compute = vi.fn((inputs: FeasibilityInputs) => {
      const done = deferred<FeasibilityResult>()
      runs.push({ inputs, done })
      return done.promise
    })
    const session = new AdvisorSession(() => {}, { store: null, computeFeasibility: compute, feasibilityDebounceMs: 10 })
    fill(session)
    await vi.advanceTimersByTimeAsync(10)
    session.correctField('experience_years', '5')
    await vi.advanceTimersByTimeAsync(10)
    expect(runs).toHaveLength(2)

    runs[0].done.resolve(report(runs[0].inputs, 40))
    await vi.advanceTimersByTimeAsync(0)
    expect(session.getView().feasibility.status).toBe('computing')

    runs[1].done.resolve(report(runs[1].inputs, 75))
    await vi.advanceTimersByTimeAsync(0)
    expect(session.getView().feasibility).toMatchObject({ status: 'ready', report: { lokScore: { total: 75 }, inputs: { experienceYears: 5 } } })
  })

  it('submitting seals the finished LokScore report instead of a pending one, and saves one package', async () => {
    const store = new ApplicationStore(memory())
    const compute = vi.fn(async (inputs: FeasibilityInputs) => report(inputs, 66))
    const session = new AdvisorSession(() => {}, { store, computeFeasibility: compute, feasibilityDebounceMs: 5000 })
    fill(session)
    for (const doc of session.getView().application!.documents) if (doc.kind && doc.status === 'missing') session.setDocument(doc.kind, 'declared_available')
    expect(session.getView().application?.readiness.canSubmit).toBe(true)

    const outcome = await session.submit(true)
    if (!outcome.ok) throw new Error(outcome.reason)
    expect(compute).toHaveBeenCalledTimes(1)
    const payload = outcome.application.reportSnapshot.payload as unknown as ReportSnapshotPayload
    expect(payload.feasibility).toMatchObject({ status: 'ready', report: { lokScore: { total: 66 } } })
    expect(store.list().map((a) => a.applicationId)).toEqual([outcome.application.applicationId])
    expect(session.getSubmission().status).toBe('submitted')
  })

  it("a loan below the scheme form's minimum blocks submission and is asked again", () => {
    const session = new AdvisorSession(() => {}, { store: null, computeFeasibility: null })
    fill(session)
    const form = session.getView().application!
    const min = form.prepared.scheme.fields.find((f) => f.key === 'loan_amount_requested')?.minValue ?? 0
    if (min <= 1) return
    session.correctField('loan_amount_requested', String(min - 1))
    const blocked = session.getView()
    expect(blocked.application?.readiness.canSubmit).toBe(false)
    expect(blocked.nextQuestion?.key).toBe('loan_amount_requested')
  })

  it('without consent nothing is saved', async () => {
    const store = new ApplicationStore(memory())
    const session = new AdvisorSession(() => {}, { store, computeFeasibility: null })
    fill(session)
    for (const doc of session.getView().application!.documents) if (doc.kind) session.setDocument(doc.kind, 'declared_available')
    expect(await session.submit(false)).toMatchObject({ ok: false })
    expect(store.list()).toEqual([])
  })

  it('the offline demo computes no LokScore and cannot submit', async () => {
    const session = new AdvisorSession(() => {}, {
      store: null,
      computeFeasibility: null,
      feasibilityDisabledReason: 'Demo mode makes no live calls.',
      submitDisabledReason: 'Demo mode does not submit.',
    })
    fill(session)
    expect(session.getView().feasibility).toEqual({ status: 'disabled', reason: 'Demo mode makes no live calls.' })
    expect(await session.submit(true)).toEqual({ ok: false, reason: 'Demo mode does not submit.' })
  })

  it('speech, typed text and corrections all write the one state the form reads', () => {
    const session = new AdvisorSession(() => {}, { store: null, computeFeasibility: null })
    session.ingest('My name is Lakshmi Devi and I want a 12 lakh loan for a dairy')
    const view = session.getView()
    expect(view.details.applicantName).toBe('Lakshmi Devi')
    expect(view.profile.financingRequired).toBe(1_200_000)
    expect(view.profile.existingLoans).toBeUndefined()
    expect(view.application?.fields.find((f) => f.key === 'loan_amount_requested')?.value).toBe(1_200_000)

    expect(session.correctField('loan_amount_requested', '8 lakh')).toBeUndefined()
    expect(session.getView().application?.fields.find((f) => f.key === 'loan_amount_requested')?.value).toBe(800_000)
    expect(session.getState().profile.financingRequired).toBe(800_000)
    expect(session.correctField('mobile', '123')).toMatch(/10 digits/)
  })

  it('when the top match changes mid-application, the form switches scheme and keeps every fact', () => {
    const session = new AdvisorSession(() => {}, { store: null, computeFeasibility: null })
    fill(session)
    session.setDocument('aadhaar', 'declared_available')
    const before = session.getView()
    const firstScheme = before.application!.schemeId
    session.runTool({ name: 'getApplicationReadiness', args: {} })

    session.ingest('Actually I already run a small dairy and I want to expand it')
    const after = session.getView()
    expect(after.profile.businessStage).toBe('existing_expansion')
    expect(after.application?.schemeId).toBe(after.top?.id)
    expect(after.application?.schemeId).not.toBe(firstScheme)
    expect(after.documents.aadhaar).toBe('declared_available')
    for (const key of ['applicant_name', 'mobile', 'age', 'gender', 'social_category', 'annual_income', 'state', 'business_sector']) {
      expect(after.application?.fields.find((f) => f.key === key)?.value, key).toEqual(before.application?.fields.find((f) => f.key === key)?.value)
    }

    const outcome = session.runTool({ name: 'getApplicationReadiness', args: {} }) as { data: Record<string, any> }
    expect(outcome.data.applicationSwitched).toMatchObject({ to: after.application?.schemeName })
    const again = session.runTool({ name: 'getApplicationReadiness', args: {} }) as { data: Record<string, any> }
    expect(again.data.applicationSwitched).toBeUndefined()
  })

  it('the business flow: each sentence fills the form; the 12 lakh loan is the loan sought, not an existing one', () => {
    const session = new AdvisorSession(() => {}, { store: null, computeFeasibility: null })
    const value = (key: string) => session.getView().application?.fields.find((f) => f.key === key)?.value

    session.ingest('I am 26 years old and I live in Kerala.')
    expect(session.getView().profile).toMatchObject({ age: 26, state: 'Kerala' })
    expect(value('age')).toBe(26)
    const afterStep1 = session.getView().application!.readiness.fieldsDone

    session.ingest('I want to start a small dairy business.')
    expect(value('business_sector')).toBe('dairy')

    session.ingest('My family income is 2.5 lakh.')
    expect(value('annual_income')).toBe(250_000)

    session.ingest('I am a woman and OBC.')
    expect(value('gender')).toBe('female')
    expect(value('social_category')).toBe('obc')

    session.ingest('I want a 12 lakh loan.')
    const view = session.getView()
    expect(view.profile.financingRequired).toBe(1_200_000)
    expect(view.profile.existingLoans).toBeUndefined()
    expect(value('loan_amount_requested')).toBe(1_200_000)
    expect(view.application!.fields.find((f) => f.key === 'loan_amount_requested')?.status).not.toBe('missing')
    expect(view.application!.readiness.fieldsDone).toBeGreaterThan(afterStep1)

    const asked = new Set<string>()
    for (let i = 0; i < 20 && session.getView().nextQuestion; i++) {
      const next = session.getView().nextQuestion!
      expect(asked.has(next.key), `asked twice: ${next.key}`).toBe(false)
      asked.add(next.key)
      const answer: Record<string, () => void> = {
        applicant_name: () => session.ingest('My name is Lakshmi Nair'),
        mobile: () => session.ingest('My number is 9847012345'),
        area_type: () => session.ingest('I live in a village'),
        business_stage: () => session.ingest('It is a new business'),
        district: () => session.ingest('I live in Ernakulam district'),
        experience_years: () => session.ingest('I have 2 years of experience'),
        nhg_membership: () => session.ingest('My NHG name is Sree Durga'),
      }
      if (answer[next.key]) answer[next.key]()
      else if (next.kind === 'document') {
        const doc = session.getView().application!.documents.find((d) => d.key === next.key)!
        session.setDocument(doc.kind!, 'declared_available')
      } else throw new Error(`unexpected question ${next.key}: ${next.question}`)
    }
    expect(session.getView().application?.readiness.canSubmit).toBe(true)
    expect(session.getView().application?.readiness.percent).toBe(100)
  })

  it('reading about another scheme does not move the application; applying for it does', () => {
    const session = new AdvisorSession(() => {}, { store: null, computeFeasibility: null })
    fill(session)
    const top = session.getView().application!.schemeId
    const other = session.getView().matches.find((m) => m.id !== top)!.id
    session.runTool({ name: 'getSchemeDetails', args: { schemeId: other } })
    expect(session.getView().detailSchemeId).toBe(other)
    expect(session.getView().application?.schemeId).toBe(top)

    const applied = session.runTool({ name: 'applyForScheme', args: { schemeId: other } }) as { data: Record<string, any> }
    expect(session.getView().application).toMatchObject({ schemeId: other, basis: 'chosen' })
    expect(applied.data.applicationSwitched).toBeDefined()

    session.runTool({ name: 'applyForScheme', args: { schemeId: '' } })
    expect(session.getView().application).toMatchObject({ schemeId: top, basis: 'top_match' })
  })
})
