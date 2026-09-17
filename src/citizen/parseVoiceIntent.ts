import { BUSINESS_META, VILLAGES, type BusinessCategory } from '../data/villages'

export interface VoiceIntent {
  category?: BusinessCategory
  villageId?: string
  availableMargin?: number
  hints: string[]
}

const CATEGORY_KEYWORDS: Array<[BusinessCategory, string[]]> = [
  ['dairy', ['dairy', 'milk', 'paneer', 'ghee', 'ಹೈನು', 'ಹಾಲು', 'ಪನೀರ್', 'ತುಪ್ಪ']],
  ['poultry', ['poultry', 'chicken', 'broiler', 'ಕೋಳಿ']],
  ['agri_processing', ['agri', 'processing', 'ragi', 'mill', 'ಕೃಷಿ ಸಂಸ್ಕರಣೆ', 'ರಾಗಿ']],
  ['food', ['tiffin', 'catering', 'hotel', 'food', 'ತಿಫಿನ್', 'ಆಹಾರ']],
  ['textiles', ['textile', 'weaving', 'garment', 'ವಸ್ತ್ರ']],
  ['retail', ['kirana', 'retail', 'shop', 'store', 'ಕಿರಾಣಿ', 'ಚಿಲ್ಲರೆ']],
]

const LAKH_WORDS: Array<[RegExp, number]> = [
  [/\b(one|a|1)\s+lakh\b/i, 100_000],
  [/\b(two|2)\s+lakh\b/i, 200_000],
  [/\b(three|3)\s+lakh\b/i, 300_000],
  [/\b(five|5)\s+lakh\b/i, 500_000],
  [/ಒಂದು\s*ಲಕ್ಷ/, 100_000],
  [/ಎರಡು\s*ಲಕ್ಷ/, 200_000],
  [/ಮೂರು\s*ಲಕ್ಷ/, 300_000],
  [/ಐದು\s*ಲಕ್ಷ/, 500_000],
]

export function parseVoiceIntent(raw: string): VoiceIntent {
  const text = raw.trim()
  const hints: string[] = []
  if (!text) return { hints }

  let category: BusinessCategory | undefined
  const lower = text.toLowerCase()
  for (const [id, words] of CATEGORY_KEYWORDS) {
    if (words.some((w) => lower.includes(w.toLowerCase()) || text.includes(w))) {
      category = id
      hints.push(BUSINESS_META[id].label)
      break
    }
  }

  let villageId: string | undefined
  const scored = VILLAGES.map((v) => {
    const needles = [v.name, v.nameKn, v.district, v.districtKn].filter(Boolean)
    const hit = needles.some((n) => text.toLowerCase().includes(n.toLowerCase()))
    return hit ? v : null
  }).filter((v): v is (typeof VILLAGES)[number] => Boolean(v))
  if (scored.length > 0) {
    villageId = scored[0]!.id
    hints.push(`${scored[0]!.name}, ${scored[0]!.district}`)
  }

  let availableMargin: number | undefined
  for (const [re, value] of LAKH_WORDS) {
    if (re.test(text)) {
      availableMargin = value
      break
    }
  }
  if (availableMargin == null) {
    const numericLakh = text.match(/(\d+(?:\.\d+)?)\s*lakh/i)
    if (numericLakh) availableMargin = Math.round(Number(numericLakh[1]) * 100_000)
  }
  if (availableMargin == null) {
    const rupees = text.match(/₹\s*([\d,]+)/) ?? text.match(/\b(\d{5,7})\b/)
    if (rupees) availableMargin = Number(rupees[1]!.replace(/,/g, ''))
  }
  if (availableMargin != null && Number.isFinite(availableMargin) && availableMargin > 0) {
    hints.push(`₹${availableMargin.toLocaleString('en-IN')}`)
  }

  return { category, villageId, availableMargin, hints }
}
