export type BusinessCategory =
  | 'dairy'
  | 'retail'
  | 'food'
  | 'textiles'
  | 'poultry'
  | 'agri_processing'

export interface Village {
  id: string
  name: string
  nameKn: string
  district: string
  districtKn: string
  block: string
  lat: number
  lng: number
  population: number
  households: number
  nearbyMandi: string
  competitorDensity: Record<BusinessCategory, number>
  purchasingPowerIndex: number
  milkCoopPresence: boolean
  notes: string
  notesKn: string
}

export const VILLAGES: Village[] = [
  {
    id: 'dinka-mandya',
    name: 'Dinka',
    nameKn: 'ಡಿಂಕಾ',
    district: 'Mandya',
    districtKn: 'ಮಂಡ್ಯ',
    block: 'Mandya',
    lat: 12.5218,
    lng: 76.8951,
    population: 4200,
    households: 980,
    nearbyMandi: 'Mandya APMC',
    competitorDensity: {
      dairy: 0.62,
      retail: 0.71,
      food: 0.55,
      textiles: 0.28,
      poultry: 0.4,
      agri_processing: 0.33,
    },
    purchasingPowerIndex: 0.68,
    milkCoopPresence: true,
    notes: 'Strong KMF milk route; value-added dairy (paneer/ghee) underserved.',
    notesKn: 'ಬಲವಾದ ಕೆಎಂಎಫ್ ಹಾಲು ಮಾರ್ಗ; ಮೌಲ್ಯವರ್ಧಿತ ಹೈನು (ಪನೀರ್/ತುಪ್ಪ) ಕಡಿಮೆ ಪೂರೈಕೆ.',
  },
  {
    id: 'kabbenur-dharwad',
    name: 'Kabbenur',
    nameKn: 'ಕಬ್ಬೇನೂರು',
    district: 'Dharwad',
    districtKn: 'ಧಾರವಾಡ',
    block: 'Dharwad',
    lat: 15.4589,
    lng: 75.0078,
    population: 3100,
    households: 720,
    nearbyMandi: 'Dharwad APMC',
    competitorDensity: {
      dairy: 0.58,
      retail: 0.64,
      food: 0.48,
      textiles: 0.35,
      poultry: 0.42,
      agri_processing: 0.3,
    },
    purchasingPowerIndex: 0.61,
    milkCoopPresence: true,
    notes: 'Jatra-driven seasonal spikes; cattle farming culture; women SHG active.',
    notesKn: 'ಜಾತ್ರೆ ಆಧಾರಿತ ಋತುಮಾನ ಬೇಡಿಕೆ; ಜಾನುವಾರು ಸಂಸ್ಕೃತಿ; ಮಹಿಳಾ ಸ್ವಸಹಾಯ ಗುಂಪು ಸಕ್ರಿಯ.',
  },
  {
    id: 'sulebhavi-belagavi',
    name: 'Sulebhavi',
    nameKn: 'ಸುಳೆಭಾವಿ',
    district: 'Belagavi',
    districtKn: 'ಬೆಳಗಾವಿ',
    block: 'Belagavi',
    lat: 15.8497,
    lng: 74.4977,
    population: 5600,
    households: 1280,
    nearbyMandi: 'Belagavi APMC',
    competitorDensity: {
      dairy: 0.45,
      retail: 0.78,
      food: 0.72,
      textiles: 0.4,
      poultry: 0.38,
      agri_processing: 0.36,
    },
    purchasingPowerIndex: 0.72,
    milkCoopPresence: false,
    notes: 'Post-harvest jatra economy; temporary stalls boom around Ugadi season.',
    notesKn: 'ಕೊಯ್ಲು ನಂತರದ ಜಾತ್ರೆ ಆರ್ಥಿಕತೆ; ಯುಗಾದಿ ಸುತ್ತಮುತ್ತ ತಾತ್ಕಾಲಿಕ ಅಂಗಡಿಗಳ ಏರಿಕೆ.',
  },
  {
    id: 'kunigal-tumakuru',
    name: 'Kunigal',
    nameKn: 'ಕುಣಿಗಲ್',
    district: 'Tumakuru',
    districtKn: 'ತುಮಕೂರು',
    block: 'Kunigal',
    lat: 13.0232,
    lng: 77.0252,
    population: 8900,
    households: 2100,
    nearbyMandi: 'Tumakuru APMC',
    competitorDensity: {
      dairy: 0.7,
      retail: 0.66,
      food: 0.5,
      textiles: 0.32,
      poultry: 0.44,
      agri_processing: 0.41,
    },
    purchasingPowerIndex: 0.74,
    milkCoopPresence: true,
    notes: 'Near Bengaluru demand corridor; raw milk saturated, processing gap large.',
    notesKn: 'ಬೆಂಗಳೂರು ಬೇಡಿಕೆ ಕಾರಿಡಾರ್ ಹತ್ತಿರ; ಕಚ್ಚಾ ಹಾಲು ತುಂಬಿದೆ, ಸಂಸ್ಕರಣೆ ಅಂತರ ದೊಡ್ಡದು.',
  },
  {
    id: 'sakleshpur-hassan',
    name: 'Sakleshpur',
    nameKn: 'ಸಕಲೇಶಪುರ',
    district: 'Hassan',
    districtKn: 'ಹಾಸನ',
    block: 'Sakleshpur',
    lat: 12.941,
    lng: 75.785,
    population: 7400,
    households: 1750,
    nearbyMandi: 'Hassan APMC',
    competitorDensity: {
      dairy: 0.35,
      retail: 0.6,
      food: 0.58,
      textiles: 0.22,
      poultry: 0.3,
      agri_processing: 0.55,
    },
    purchasingPowerIndex: 0.7,
    milkCoopPresence: false,
    notes: 'Coffee/spice belt; agri-processing & packaged snacks have tourist + local pull.',
    notesKn: 'ಕಾಫಿ/ಮಸಾಲೆ ಪ್ರದೇಶ; ಕೃಷಿ ಸಂಸ್ಕರಣೆ ಮತ್ತು ಪ್ಯಾಕೇಜ್ಡ್ ತಿಂಡಿ ಪ್ರವಾಸಿ+ಸ್ಥಳೀಯ ಬೇಡಿಕೆ.',
  },
]

export const BUSINESS_META: Record<
  BusinessCategory,
  { label: string; labelKn: string; unit: string; mandiCommodity?: string }
> = {
  dairy: { label: 'Dairy', labelKn: 'ಹೈನು ಉದ್ಯಮ', unit: 'litres/day', mandiCommodity: 'Milk' },
  retail: { label: 'Kirana / Retail', labelKn: 'ಕಿರಾಣಿ / ಚಿಲ್ಲರೆ', unit: 'SKU mix' },
  food: { label: 'Food / Tiffin', labelKn: 'ಆಹಾರ / ತಿಫಿನ್', unit: 'covers/day' },
  textiles: { label: 'Textiles / Tailoring', labelKn: 'ವಸ್ತ್ರೋದ್ಯಮ / ಟೈಲರಿಂಗ್', unit: 'pieces/month' },
  poultry: { label: 'Poultry', labelKn: 'ಕೋಳಿ ಸಾಕಾಣಿಕೆ', unit: 'birds' },
  agri_processing: {
    label: 'Agri Processing',
    labelKn: 'ಕೃಷಿ ಸಂಸ್ಕರಣೆ',
    unit: 'kg/day',
    mandiCommodity: 'Ragi',
  },
}

export const BUSINESS_CATEGORIES = Object.keys(BUSINESS_META) as BusinessCategory[]

