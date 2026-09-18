/** Presentation-only formatting. Never invents missing applicant data. */
export const NOT_PROVIDED = 'Not provided'

function clean(value: string | undefined | null): string {
  return (value ?? '').trim()
}

export function formatJoinedParts(
  parts: Array<string | undefined | null>,
  empty = NOT_PROVIDED,
): string {
  const cleaned = parts.map(clean).filter(Boolean)
  return cleaned.length > 0 ? cleaned.join(', ') : empty
}

export function formatBankLine(
  account: string | undefined | null,
  ifsc: string | undefined | null,
  empty = NOT_PROVIDED,
): string {
  const a = clean(account)
  const i = clean(ifsc)
  if (!a && !i) return empty
  if (!a) return i
  if (!i) return a
  return `${a} / ${i}`
}
