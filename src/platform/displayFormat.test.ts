import { describe, expect, it } from 'vitest'
import { formatBankLine, formatJoinedParts, NOT_PROVIDED } from './displayFormat'

describe('empty address / bank formatting', () => {
  it('does not render comma-only or slash-only placeholders', () => {
    expect(formatJoinedParts(['', '', '', 'Kerala'])).toBe('Kerala')
    expect(formatJoinedParts(['', ' ', '', ''])).toBe(NOT_PROVIDED)
    expect(formatBankLine('', '')).toBe(NOT_PROVIDED)
  })

  it('keeps genuine values and does not invent missing ones', () => {
    expect(formatJoinedParts(['Ward 4', 'Alappuzha', 'Kerala'])).toBe('Ward 4, Alappuzha, Kerala')
    expect(formatBankLine('1234567890', 'SBIN0001234')).toBe('1234567890 / SBIN0001234')
    expect(formatBankLine('1234567890', '')).toBe('1234567890')
  })
})
