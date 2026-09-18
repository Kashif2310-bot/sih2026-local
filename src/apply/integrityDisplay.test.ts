import { describe, expect, it } from 'vitest'
import {
  classifyIntegrityHash,
  hashesAreDistinctRepresentations,
  integrityHashI18nKey,
} from './integrityDisplay'

describe('integrity hash representations', () => {
  it('classifies Adita packet hashes and Jordan approval digests as different objects', () => {
    const packet = 'sha256:014640a89f2501ac43e54184b50fc370ab94b8443e4aef46d8a54bf4eea4ed0e'
    const approval = '0xef38d91f97eb24c31875f69a828ac08652465c8289c8fc30956756ae9466c5d8'
    expect(classifyIntegrityHash(packet)).toBe('packet_sha256')
    expect(classifyIntegrityHash(approval)).toBe('approval_keccak')
    expect(hashesAreDistinctRepresentations(packet, approval)).toBe(true)
    expect(integrityHashI18nKey('packet_sha256')).toBe('apply.packetSnapshotHash')
    expect(integrityHashI18nKey('approval_keccak')).toBe('apply.approvalSnapshotDigest')
  })

  it('does not pretend two different digests are the same snapshot', () => {
    expect(
      hashesAreDistinctRepresentations(
        'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      ),
    ).toBe(false)
  })
})
