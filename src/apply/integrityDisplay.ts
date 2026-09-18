/**
 * The product hashes two different objects on purpose:
 * - Adita packet snapshot: SHA-256 of the frozen apply payload (`sha256:…`)
 * - Jordan approval snapshot: Keccak digest of the approval overlay (`0x…`)
 *
 * Never treat them as interchangeable and never rewrite one into the other.
 */
export type IntegrityHashKind = 'packet_sha256' | 'approval_keccak' | 'unknown'

export function classifyIntegrityHash(value: string | null | undefined): IntegrityHashKind {
  const v = (value ?? '').trim()
  if (/^sha256:[a-f0-9]{16,}$/i.test(v)) return 'packet_sha256'
  if (/^0x[a-f0-9]{16,}$/i.test(v)) return 'approval_keccak'
  return 'unknown'
}

export function integrityHashI18nKey(kind: IntegrityHashKind): string {
  if (kind === 'packet_sha256') return 'apply.packetSnapshotHash'
  if (kind === 'approval_keccak') return 'apply.approvalSnapshotDigest'
  return 'apply.snapshotHash'
}

export function hashesAreDistinctRepresentations(packetHash: string, approvalDigest: string): boolean {
  return (
    classifyIntegrityHash(packetHash) === 'packet_sha256' &&
    classifyIntegrityHash(approvalDigest) === 'approval_keccak' &&
    packetHash !== approvalDigest
  )
}
