import { describe, expect, it } from 'vitest'
import { deriveAdvisorView, ingestUtterance, INITIAL_ADVISOR_STATE, type AdvisorState } from './advisor'
import { runAdvisorTool } from './advisorTools'

function heard(...utterances: string[]): AdvisorState {
  return utterances.reduce((state, text) => ingestUtterance(state, text).state, INITIAL_ADVISOR_STATE)
}

const RAVI = heard(
  'My name is Ravi Kumar, I am 32 years old, from Mysuru, Karnataka',
  'I want to start a dairy business',
  'I need a loan of 5 lakh',
  'My family income is 2 lakh per year and I am OBC',
  'My mobile number is 9845012345',
)

describe('every matching scheme has its own form, filled from the same answers', () => {
  it('builds a form for every scheme that is not ruled out, and none for ruled-out ones', () => {
    const view = deriveAdvisorView(RAVI)
    const plausible = view.matches.filter((m) => m.status !== 'likely_ineligible').map((m) => m.id)
    const ruledOut = view.matches.filter((m) => m.status === 'likely_ineligible').map((m) => m.id)
    expect(plausible.length).toBeGreaterThan(1)
    expect(Object.keys(view.forms).sort()).toEqual([...plausible].sort())
    ruledOut.forEach((id) => expect(view.forms[id]).toBeUndefined())
  })

  it('the application form is the same object as its entry, and the others are marked as matching', () => {
    const view = deriveAdvisorView(RAVI)
    expect(view.application).not.toBeNull()
    expect(view.forms[view.application!.schemeId]).toBe(view.application)
    for (const [id, form] of Object.entries(view.forms)) {
      if (id !== view.application!.schemeId) expect(form.basis).toBe('matching')
    }
  })

  it('a detail given once shows the same value in every form that asks for it', () => {
    const forms = Object.values(deriveAdvisorView(RAVI).forms)
    for (const key of ['applicant_name', 'mobile', 'age', 'state', 'district']) {
      const values = forms.map((form) => form.fields.find((f) => f.key === key)).filter((f) => f !== undefined)
      expect(values.length).toBe(forms.length)
      expect(new Set(values.map((f) => f.display)).size).toBe(1)
      values.forEach((f) => expect(f.status).not.toBe('missing'))
    }
  })

  it('a new answer fills every form at once, and each form lists only what it still needs', () => {
    const before = deriveAdvisorView(RAVI).forms
    // Saying "male" can also rule out a scheme for women, whose form then goes away.
    const after = deriveAdvisorView(ingestUtterance(RAVI, 'I am male').state).forms
    const stillMatching = Object.keys(before).filter((id) => after[id])
    expect(stillMatching.length).toBeGreaterThan(1)
    for (const id of stillMatching) {
      const was = before[id].fields.find((f) => f.key === 'gender')
      const now = after[id].fields.find((f) => f.key === 'gender')
      if (!was) continue
      expect(was.status).toBe('missing')
      expect(now?.status).toBe('complete')
      expect(after[id].readiness.fieldsDone).toBe(before[id].readiness.fieldsDone + 1)
      expect(after[id].missing.some((item) => item.key === 'gender')).toBe(false)
    }
  })

  it('getSchemeDetails tells Gemini what that scheme\'s own form still needs', () => {
    const view = deriveAdvisorView(RAVI)
    const other = Object.keys(view.forms).find((id) => id !== view.application?.schemeId)!
    const { outcome } = runAdvisorTool(RAVI, { name: 'getSchemeDetails', args: { schemeId: other } })
    if (!outcome.ok) throw new Error(outcome.message)
    const data = outcome.data as { thisSchemesForm: { percentFilled: number; stillNeeded: string[] } }
    expect(data.thisSchemesForm.percentFilled).toBe(view.forms[other].readiness.percent)
    expect(data.thisSchemesForm.stillNeeded).toEqual(view.forms[other].missing.map((item) => item.label))
  })
})
