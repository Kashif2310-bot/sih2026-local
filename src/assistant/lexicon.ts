/**
 * Shared vocabulary for profile extraction, retrieval and eligibility
 * matching. Kept in one place so the sector tag a user's message extracts
 * to is guaranteed to be the same tag the scheme dataset and eligibility
 * engine compare against.
 */

export const INDIAN_STATES = [
  'Andhra Pradesh',
  'Arunachal Pradesh',
  'Assam',
  'Bihar',
  'Chhattisgarh',
  'Goa',
  'Gujarat',
  'Haryana',
  'Himachal Pradesh',
  'Jharkhand',
  'Karnataka',
  'Kerala',
  'Madhya Pradesh',
  'Maharashtra',
  'Manipur',
  'Meghalaya',
  'Mizoram',
  'Nagaland',
  'Odisha',
  'Punjab',
  'Rajasthan',
  'Sikkim',
  'Tamil Nadu',
  'Telangana',
  'Tripura',
  'Uttar Pradesh',
  'Uttarakhand',
  'West Bengal',
  'Delhi',
  'Jammu and Kashmir',
  'Ladakh',
  'Puducherry',
  'Chandigarh',
]

/**
 * Sector tag -> keywords that indicate it in free text. Order matters: more specific first.
 *
 * Keywords are matched as plain substrings (profileExtraction.findBusinessSector),
 * so each must be unambiguous inside longer words too — "fishing net", never
 * "net" ("cabinet", "internet"); "mat weaving", never "mat" ("formats");
 * "garland", never "mala" ("Himalaya"). Trade keywords are occupation words
 * only — never surnames or community names (e.g. "Sunar", "Dhobi"), which
 * would infer a trade from a person's name or caste.
 *
 * The trade tags from boat_making to fishing_net_making, plus tailoring,
 * carpentry, blacksmithing, pottery and handicraft, cover the 18 PM
 * Vishwakarma trades (Guidelines v30.0, para 2.3).
 */
export const SECTOR_KEYWORDS: Record<string, string[]> = {
  // First, so poultry's generic "hatchery" can't claim a fish hatchery. Never
  // bare "fish" ("selfish"), bare "fishing" (would claim a fishing-net maker,
  // a Vishwakarma trade below), "fishing boat" (a boat builder) or "fisher"
  // (also a surname). The "fish ..." keywords start with a space so they only
  // match at a word start: "fish farm" alone would match "a selfish farmer".
  fisheries: [
    'fisheries',
    'fishery',
    'fisherman',
    'fishermen',
    'fisherwoman',
    'fisherwomen',
    ' fish farm',
    ' fish culture',
    ' fish pond',
    ' fish hatchery',
    ' fish seed',
    'aquaculture',
    'shrimp farm',
    'prawn farm',
    'shellfish farm',
    ' fish vendor',
    ' fish vending',
    ' fish seller',
    ' fish selling',
    ' fish stall',
    'go fishing',
    'do fishing',
    'fishing business',
    'marine fishing',
    'inland fishing',
    'sea fishing',
    'river fishing',
  ],
  poultry: ['poultry', 'chicken farm', 'chicken business', 'hatchery', 'broiler', 'egg business', 'egg farm'],
  dairy: ['dairy', 'milk business', 'milk dairy', 'cow farm', 'buffalo farm'],
  tailoring: ['tailoring', 'tailor', 'stitching', 'boutique', 'garment making', 'sewing'],
  handicraft: [
    'handicraft',
    'handicrafts',
    'artisan work',
    'craft business',
    'basket',
    'mat weaving',
    'mat making',
    'mat maker',
    'broom',
    'coir',
    'doll making',
    'doll maker',
    'toy making',
    'toy maker',
  ],
  boat_making: ['boat making', 'boat maker', 'boat building', 'boat builder', 'boatbuilding'],
  carpentry: ['carpentry', 'carpenter', 'furniture making', 'woodwork'],
  // Before blacksmithing, whose generic "metalwork" would otherwise claim a locksmith or goldsmith.
  metal_tools: ['locksmith', 'armourer', 'armorer', 'tool kit maker', 'toolkit maker', 'tool kit making', 'hammer making'],
  goldsmith: ['goldsmith', 'gold smith', 'jewellery making', 'jewelry making'],
  blacksmithing: ['blacksmith', 'ironwork', 'metalwork'],
  pottery: ['pottery', 'potter', 'terracotta'],
  stonework: ['sculptor', 'sculpture', 'stone carving', 'stone carver', 'stone breaker', 'stone breaking', 'idol making'],
  cobbler_footwear: [
    'cobbler',
    'shoemaker',
    'shoe maker',
    'shoe making',
    'shoe repair',
    'shoesmith',
    'footwear making',
    'footwear artisan',
    'chappal making',
  ],
  masonry: ['mason', 'bricklaying', 'brick laying', 'bricklayer'],
  barber: ['barber', 'hair cutting', 'haircutting', 'haircut'],
  garland_making: ['garland'],
  washerman: ['washerman', 'washermen', 'laundry', 'washing clothes', 'clothes washing', 'ironing clothes'],
  fishing_net_making: ['fishing net', 'fish net'],
  food_processing: ['food processing', 'papad', 'pickle making', 'bakery', 'catering', 'snacks business', 'food unit'],
  textiles: ['textile', 'weaving', 'handloom', 'sari business'],
  retail: ['retail shop', 'retail business', 'retail store', 'kirana', 'grocery store', 'grocery', 'general store', 'shop business'],
  trading: ['trading business', 'wholesale', 'distributor'],
  manufacturing: ['manufacturing', 'factory', 'production unit'],
  services: ['repair shop', 'salon', 'beauty parlour', 'service business'],
}

export function normalizeSectorLabel(sector: string): string {
  return sector.replace(/_/g, ' ')
}
