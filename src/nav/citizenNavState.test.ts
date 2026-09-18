import { describe, expect, it } from 'vitest'
import { isCitizenNavActive } from './citizenNavState'

describe('citizen navigation current-state', () => {
  it('marks Apply current on hub, start, and track paths', () => {
    expect(isCitizenNavActive('/apply', '/apply', true)).toBe(true)
    expect(isCitizenNavActive('/apply/start/pmegp', '/apply', true)).toBe(true)
    expect(isCitizenNavActive('/apply/track/LP-GUIDED-1', '/apply', true)).toBe(true)
    expect(isCitizenNavActive('/apply/tracking', '/apply', true)).toBe(true)
  })

  it('does not keep Assistant highlighted after moving into Apply', () => {
    expect(isCitizenNavActive('/apply/start/pmegp', '/assistant', false)).toBe(false)
    expect(isCitizenNavActive('/assistant', '/assistant', false)).toBe(true)
  })
})
