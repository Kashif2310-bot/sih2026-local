import { NSFDC } from './config'
import { toPaise } from './finance'

export type CapScheme = 'micro' | 'term'

export interface LoanCapTransparency {
  capped: boolean
  capPaise: number
  uncappedLoanPaise: number
  loanPaise: number
  neededMarginPaise: number
  extraMarginPaise: number
}

/**
 * Beneficiary-facing cap arithmetic. Does not change NSFDC routing —
 * it only explains when min(90%, scheme cap) cut the 90% figure.
 * All values are integer paise.
 */
export function loanCapTransparency(input: {
  projectCostPaise: number
  enteredMarginPaise: number
  scheme: CapScheme
}): LoanCapTransparency {
  const capPaise =
    input.scheme === 'micro' ? toPaise(NSFDC.microLoanCapRupees) : toPaise(NSFDC.termLoanCapRupees)
  const uncappedLoanPaise = Math.floor((input.projectCostPaise * 9) / 10)
  const loanPaise = Math.min(uncappedLoanPaise, capPaise)
  const capped = uncappedLoanPaise > capPaise
  const neededMarginPaise = input.projectCostPaise - loanPaise
  const extraMarginPaise = Math.max(0, neededMarginPaise - input.enteredMarginPaise)
  return {
    capped,
    capPaise,
    uncappedLoanPaise,
    loanPaise,
    neededMarginPaise,
    extraMarginPaise,
  }
}

export function schemeFromPlanId(schemeId: string): CapScheme | null {
  if (schemeId === 'micro_finance') return 'micro'
  if (schemeId === 'term_loan') return 'term'
  return null
}
