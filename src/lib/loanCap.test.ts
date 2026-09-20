import { describe, expect, it } from 'vitest'
import { toPaise } from './finance'
import { loanCapTransparency } from './loanCap'

describe('loanCapTransparency', () => {
  it('micro cap at margin ₹14,000 needs ₹1,000 extra', () => {
    const info = loanCapTransparency({
      projectCostPaise: toPaise(140_000),
      enteredMarginPaise: toPaise(14_000),
      scheme: 'micro',
    })
    expect(info.capped).toBe(true)
    expect(info.uncappedLoanPaise).toBe(toPaise(126_000))
    expect(info.loanPaise).toBe(toPaise(125_000))
    expect(info.capPaise).toBe(toPaise(125_000))
    expect(info.neededMarginPaise).toBe(toPaise(15_000))
    expect(info.extraMarginPaise).toBe(toPaise(1_000))
  })

  it('term-loan case where 90% is above the ₹45,00,000 cap', () => {
    // ₹50,00,100 project → 90% = ₹45,00,090, cut to ₹45L.
    const info = loanCapTransparency({
      projectCostPaise: toPaise(5_000_100),
      enteredMarginPaise: toPaise(500_010),
      scheme: 'term',
    })
    expect(info.capped).toBe(true)
    expect(info.uncappedLoanPaise).toBeGreaterThan(toPaise(4_500_000))
    expect(info.loanPaise).toBe(toPaise(4_500_000))
    expect(info.capPaise).toBe(toPaise(4_500_000))
    expect(info.neededMarginPaise).toBe(toPaise(500_100))
    expect(info.extraMarginPaise).toBe(toPaise(90))
  })

  it('does not flag when 90% is under the cap', () => {
    const info = loanCapTransparency({
      projectCostPaise: toPaise(375_000),
      enteredMarginPaise: toPaise(37_500),
      scheme: 'term',
    })
    expect(info.capped).toBe(false)
    expect(info.loanPaise).toBe(toPaise(337_500))
    expect(info.extraMarginPaise).toBe(0)
  })
})
