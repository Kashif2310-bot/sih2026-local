import type { BusinessCategory } from '../data/villages'

/** Fixed SIH demo profile — do not change numbers (MASTER_SPEC Rule 9). */
export function defaultProfile() {
  return {
    name: 'Lakshmi S.',
    age: 29,
    gender: 'female' as const,
    community: 'sc' as const,
    annualIncome: 180000,
    experienceYears: 2,
    villageId: 'dinka-mandya',
    category: 'dairy' as BusinessCategory,
    availableMargin: 100000,
    locationMode: 'curated' as const,
    radiusKm: 7,
  }
}

/** Empty Scan form — no demo identity prefilled. */
export function emptyScanForm() {
  return {
    name: '',
    age: 29,
    gender: 'female' as const,
    community: 'sc' as const,
    annualIncome: 180000,
    experienceYears: 2,
    villageId: 'dinka-mandya',
    category: 'dairy' as BusinessCategory,
    availableMargin: 0,
    locationMode: 'curated' as const,
    radiusKm: 7,
  }
}
