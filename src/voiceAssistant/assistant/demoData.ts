import type { AdvisorView } from './advisor/advisor'

export interface DemoTurn {
  /** What the scripted citizen says, streamed chunk by chunk like a live transcript. */
  user: string[]
  /** The scripted advisor reply, worded from the real engine's view at reply time — never a hard-coded scheme claim. */
  reply: (view: AdvisorView, previousTopId: string | null) => string
}

const pct = (value: number) => `${value} percent`

function bestMatchLine(view: AdvisorView, previousTopId: string | null): string {
  const top = view.top
  if (!top) return 'No scheme is a clear match yet.'
  if (previousTopId && previousTopId !== top.id) return `That changes things — ${top.shortName} is now your best match, at ${pct(top.matchPercent)}.`
  return `${top.shortName} is your strongest match right now, at ${pct(top.matchPercent)}.`
}

function nextQuestion(view: AdvisorView): string {
  return view.nextQuestion?.question ?? 'Is there anything else you would like to tell me?'
}

/** The scripted conversation. Only the citizen's words are fixed; every fact shown comes from the engine. */
export const DEMO_TURNS: DemoTurn[] = [
  {
    user: ["I'm 26 years old,", ' from Kerala,', ' and I want to start', ' a small dairy business.'],
    reply: (view, prev) => `Thank you. ${bestMatchLine(view, prev)} Roughly what is your family's yearly income?`,
  },
  {
    user: ['Our family income is', ' about 2.5 lakh a year.'],
    reply: (view, prev) => `Noted. ${bestMatchLine(view, prev)} ${nextQuestion(view)}`,
  },
  {
    user: ['I belong to the SC category,', ' and we live in a village.'],
    reply: (view, prev) => `${bestMatchLine(view, prev)} ${nextQuestion(view)}`,
  },
  {
    user: ['I need a loan', ' of 2 lakh.'],
    reply: (view, prev) => {
      const form = view.application
      const progress = form
        ? ` Your ${form.schemeName} application now has ${form.readiness.fieldsDone} of ${form.readiness.fieldsTotal} required fields filled.`
        : ''
      return `${bestMatchLine(view, prev)}${progress} ${nextQuestion(view)}`
    },
  },
]

export const GENERIC_REPLY = (view: AdvisorView) =>
  view.top
    ? `Thank you, I've noted that. Your best match right now is ${view.top.shortName}, at ${pct(view.top.matchPercent)}.`
    : "Thank you, I've noted that. Tell me a little more about yourself whenever you're ready."
