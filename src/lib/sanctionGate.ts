export type DataStatus = 'complete' | 'incomplete'

/** Quorum depends on LokScore; incomplete live signals must not be signed. */
export function canSanction(dataStatus: DataStatus): boolean {
  return dataStatus === 'complete'
}

export function sanctionBlockReason(dataStatus: DataStatus): string | null {
  if (canSanction(dataStatus)) return null
  return 'Signals incomplete - retry before sanction'
}
