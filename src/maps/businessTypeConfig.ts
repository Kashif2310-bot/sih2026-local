import type { BusinessCategory } from '../data/villages'

export interface GooglePlaceBusinessMapping {
  /** Places API (New) primary types. Empty means use the text-query fallback. */
  includedPrimaryTypes: string[]
  /** Used only when types do not describe the rural business cleanly. */
  fallbackKeywords: string[]
}

export const BUSINESS_TYPE_PLACES_CONFIG: Record<BusinessCategory, GooglePlaceBusinessMapping> = {
  dairy: {
    includedPrimaryTypes: [],
    fallbackKeywords: ['dairy shop', 'milk shop', 'milk collection center'],
  },
  retail: {
    includedPrimaryTypes: ['grocery_store', 'supermarket', 'convenience_store'],
    fallbackKeywords: ['kirana store', 'general store'],
  },
  food: {
    includedPrimaryTypes: ['restaurant', 'cafe', 'fast_food_restaurant'],
    fallbackKeywords: ['food stall', 'tiffin service'],
  },
  textiles: {
    includedPrimaryTypes: ['clothing_store'],
    fallbackKeywords: ['tailor', 'tailoring shop', 'fabric shop'],
  },
  poultry: {
    includedPrimaryTypes: [],
    fallbackKeywords: ['poultry farm', 'chicken shop'],
  },
  agri_processing: {
    includedPrimaryTypes: [],
    fallbackKeywords: ['food processing unit', 'rice mill', 'flour mill'],
  },
}

export const COMPETITION_RADIUS_KM = {
  min: 1,
  max: 10,
  default: 3,
} as const
