import type { UserProfile } from '../assistant/types'
import { derivedFinancing } from './catalog'
import type { ApplicationFieldSpec, MappedField } from './types'

function readProfileValue(
  spec: ApplicationFieldSpec,
  profile: UserProfile,
): { value: string | number | boolean | undefined; source: MappedField['source'] } {
  if (!spec.profileSource) return { value: undefined, source: 'empty' }
  if (spec.profileSource === 'effectiveFinancing') {
    const n = derivedFinancing(profile)
    return n === undefined ? { value: undefined, source: 'empty' } : { value: n, source: 'derived' }
  }
  const raw = profile[spec.profileSource]
  if (raw === undefined || raw === '') return { value: undefined, source: 'empty' }
  if (spec.fieldType === 'integer' && typeof raw === 'number') return { value: raw, source: 'profile' }
  if (spec.fieldType === 'boolean' && typeof raw === 'boolean') return { value: raw, source: 'profile' }
  if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') {
    return { value: raw, source: 'profile' }
  }
  return { value: undefined, source: 'empty' }
}

export function mapProfileToFields(
  spec: ApplicationFieldSpec[],
  profile: UserProfile,
  overrides: Record<string, string | number | boolean | undefined> = {},
): MappedField[] {
  return spec.map((field) => {
    const override = overrides[field.key]
    if (override !== undefined && override !== '') {
      return {
        key: field.key,
        label: field.label,
        required: field.required,
        fieldType: field.fieldType,
        value: override,
        source: 'user',
        helpText: field.helpText,
      }
    }
    const mapped = readProfileValue(field, profile)
    return {
      key: field.key,
      label: field.label,
      required: field.required,
      fieldType: field.fieldType,
      value: mapped.value,
      source: mapped.source,
      helpText: field.helpText,
    }
  })
}

export function missingRequiredFields(fields: MappedField[]): MappedField[] {
  return fields.filter((f) => f.required && (f.value === undefined || f.value === ''))
}

export function fieldsToRecord(fields: MappedField[]): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {}
  for (const f of fields) {
    if (f.value !== undefined && f.value !== '') out[f.key] = f.value
  }
  return out
}
