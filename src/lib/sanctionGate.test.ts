import { describe, expect, it } from 'vitest'
import { canSanction, sanctionBlockReason } from './sanctionGate'

describe('canSanction', () => {
  it('blocks an incomplete assessment', () => {
    expect(canSanction('incomplete')).toBe(false)
    expect(sanctionBlockReason('incomplete')).toBe('Signals incomplete - retry before sanction')
  })

  it('does not block a complete assessment', () => {
    expect(canSanction('complete')).toBe(true)
    expect(sanctionBlockReason('complete')).toBeNull()
  })
})
