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

export function reviewFieldLabel(key: string, mappedLabel?: string): string {
  const trimmed = mappedLabel?.trim()
  if (trimmed) return trimmed
  return humanizeSchemaKey(key)
}
