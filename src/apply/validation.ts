import type { ApplicationFieldSpec, MappedDocument, MappedField, ValidationIssue } from './types'

function asString(value: string | number | boolean | undefined): string {
  if (value === undefined) return ''
  return String(value)
}

export function validateFields(
  specs: ApplicationFieldSpec[],
  fields: MappedField[],
): ValidationIssue[] {
  const byKey = new Map(fields.map((f) => [f.key, f]))
  const issues: ValidationIssue[] = []

  for (const spec of specs) {
    const mapped = byKey.get(spec.key)
    const raw = mapped?.value

    if (spec.required && (raw === undefined || raw === '')) {
      issues.push({
        code: 'missing_field',
        field: spec.key,
        message: `${spec.label} is required before a packet can be generated.`,
        blocking: true,
      })
      continue
    }
    if (raw === undefined || raw === '') continue

    if (spec.fieldType === 'integer') {
      const n = typeof raw === 'number' ? raw : Number(raw)
      if (!Number.isFinite(n) || !Number.isInteger(n)) {
        issues.push({
          code: 'invalid_integer',
          field: spec.key,
          message: `${spec.label} must be a whole number.`,
          blocking: true,
        })
        continue
      }
      if (spec.minValue !== undefined && n < spec.minValue) {
        issues.push({
          code: 'below_min',
          field: spec.key,
          message: `${spec.label} must be at least ${spec.minValue.toLocaleString('en-IN')}.`,
          blocking: true,
        })
      }
      if (spec.maxValue !== undefined && n > spec.maxValue) {
        issues.push({
          code: 'above_max',
          field: spec.key,
          message: `${spec.label} is above this scheme's documented maximum of ₹${spec.maxValue.toLocaleString('en-IN')}. Confirm on the official portal — this app will not silently clamp it.`,
          blocking: true,
        })
      }
    }

    if (spec.fieldType === 'string') {
      const s = asString(raw).trim()
      if (spec.minLength !== undefined && s.length < spec.minLength) {
        issues.push({
          code: 'too_short',
          field: spec.key,
          message: `${spec.label} is too short.`,
          blocking: true,
        })
      }
      if (spec.maxLength !== undefined && s.length > spec.maxLength) {
        issues.push({
          code: 'too_long',
          field: spec.key,
          message: `${spec.label} is too long.`,
          blocking: true,
        })
      }
      if (spec.pattern && !new RegExp(spec.pattern).test(s)) {
        issues.push({
          code: 'pattern',
          field: spec.key,
          message: `${spec.label} is not in the expected format.`,
          blocking: true,
        })
      }
    }
  }

  return issues
}

export function validateDocuments(documents: MappedDocument[]): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  for (const doc of documents) {
    if (doc.required && doc.declaration === 'missing') {
      issues.push({
        code: 'missing_document',
        field: doc.key,
        message: `${doc.label} is required. Mark it as available or as something you will attach on the official portal — this app does not upload files to government systems.`,
        blocking: true,
      })
    }
  }
  return issues
}

export function canSubmit(issues: ValidationIssue[]): boolean {
  return issues.every((i) => !i.blocking)
}
