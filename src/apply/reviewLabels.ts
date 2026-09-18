/**
 * Presentation helpers for Apply packet field keys.
 * Stored schema keys stay snake_case; only labels change.
 */
export function humanizeSchemaKey(key: string): string {
  return key
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ')
}

const FALLBACK_LABELS: Record<string, string> = {
  applicant_name: 'Applicant full name',
  area_type: 'Area type',
  loan_amount_requested: 'Loan amount requested',
}

export function reviewFieldLabel(key: string, mappedLabel?: string): string {
  const trimmed = mappedLabel?.trim()
  if (trimmed) return trimmed
  const fallback = FALLBACK_LABELS[key.toLowerCase()]
  if (fallback) return fallback
  return humanizeSchemaKey(key)
}

export function formatReviewValue(
  value: string | number | boolean | undefined | null,
  empty = 'Not provided',
): string {
  if (value === undefined || value === null) return empty
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  const text = String(value).trim()
  if (!text || /^[,/\s]+$/.test(text)) return empty
  return text
}
