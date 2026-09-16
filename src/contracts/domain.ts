/**
 * Domain vocabulary shared across workstreams.
 * Mirrors existing BusinessCategory in src/data/villages.ts — keep in sync.
 */

export type BusinessCategory =
  | 'dairy'
  | 'retail'
  | 'food'
  | 'textiles'
  | 'poultry'
  | 'agri_processing'

export type Gender = 'female' | 'male' | 'other'
export type Community = 'sc' | 'st' | 'obc' | 'general'
export type LocationMode = 'curated' | 'live'
export type AppLocale = 'en' | 'kn' | 'mixed'

export const BUSINESS_CATEGORIES: readonly BusinessCategory[] = [
  'dairy',
  'retail',
  'food',
  'textiles',
  'poultry',
  'agri_processing',
] as const
