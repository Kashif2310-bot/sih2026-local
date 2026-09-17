/**
 * Deep-freeze helper for report snapshot immutability.
 * Emitted reports must not be silently mutated when conversation state changes.
 */

export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value
  if (Object.isFrozen(value)) return value

  for (const key of Reflect.ownKeys(value as object)) {
    const child = (value as Record<PropertyKey, unknown>)[key]
    if (child !== null && typeof child === 'object') {
      deepFreeze(child)
    }
  }
  return Object.freeze(value)
}

/** Structural clone + freeze — safe when callers might hold a mutable draft. */
export function freezeReportSnapshot<T>(report: T): T {
  return deepFreeze(structuredClone(report))
}
