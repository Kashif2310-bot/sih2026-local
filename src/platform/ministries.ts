/**
 * Simulated ministry/department routing for the prototype (Prerna's brief,
 * see docs/PRERNA_HANDOFF.md). This is a placeholder rule set standing in
 * for Vamshi's real routing/data API — swap the implementation of
 * `routeApplication` when that API lands, the return shape is the contract.
 */
import type { BusinessCategory } from '../data/villages'

export type MinistryId =
  | 'agriculture'
  | 'animal_husbandry'
  | 'msme'
  | 'rural_development'
  | 'finance'
  | 'women_child'
  | 'social_justice'

export interface Ministry {
  id: MinistryId
  name: string
  nameKn: string
}

export const MINISTRIES: Record<MinistryId, Ministry> = {
  agriculture: {
    id: 'agriculture',
    name: 'Ministry of Agriculture & Farmers Welfare',
    nameKn: 'ಕೃಷಿ ಮತ್ತು ರೈತರ ಕಲ್ಯಾಣ ಸಚಿವಾಲಯ',
  },
  animal_husbandry: {
    id: 'animal_husbandry',
    name: 'Animal Husbandry & Dairying',
    nameKn: 'ಪಶುಸಂಗೋಪನೆ ಮತ್ತು ಹೈನುಗಾರಿಕೆ',
  },
  msme: {
    id: 'msme',
    name: 'Ministry of MSME',
    nameKn: 'ಸೂಕ್ಷ್ಮ, ಸಣ್ಣ ಮತ್ತು ಮಧ್ಯಮ ಉದ್ಯಮ ಸಚಿವಾಲಯ',
  },
  rural_development: {
    id: 'rural_development',
    name: 'Ministry of Rural Development',
    nameKn: 'ಗ್ರಾಮೀಣ ಅಭಿವೃದ್ಧಿ ಸಚಿವಾಲಯ',
  },
  finance: {
    id: 'finance',
    name: 'Department of Financial Services',
    nameKn: 'ಹಣಕಾಸು ಸೇವೆಗಳ ಇಲಾಖೆ',
  },
  women_child: {
    id: 'women_child',
    name: 'Women & Child Development',
    nameKn: 'ಮಹಿಳಾ ಮತ್ತು ಮಕ್ಕಳ ಅಭಿವೃದ್ಧಿ ಇಲಾಖೆ',
  },
  social_justice: {
    id: 'social_justice',
    name: 'Social Justice & Empowerment',
    nameKn: 'ಸಾಮಾಜಿಕ ನ್ಯಾಯ ಮತ್ತು ಸಬಲೀಕರಣ ಇಲಾಖೆ',
  },
}

export const MINISTRY_LIST: Ministry[] = Object.values(MINISTRIES)

const CATEGORY_LEAD_MINISTRY: Record<BusinessCategory, MinistryId> = {
  dairy: 'animal_husbandry',
  poultry: 'animal_husbandry',
  agri_processing: 'agriculture',
  food: 'msme',
  retail: 'msme',
  textiles: 'rural_development',
}

export interface RoutingResult {
  leadMinistryId: MinistryId
  supportingMinistryIds: MinistryId[]
  rationaleEn: string[]
  rationaleKn: string[]
}

/**
 * Deterministic, rule-based routing — not a live API call. This mirrors the
 * shape Vamshi's real routing/data API is expected to return, so the admin
 * UI can swap this function out later without changing any component.
 */
export function routeApplication(input: {
  category: BusinessCategory
  gender: 'male' | 'female' | 'other'
  community: 'sc' | 'st' | 'obc' | 'general'
}): RoutingResult {
  const leadMinistryId = CATEGORY_LEAD_MINISTRY[input.category]
  const supporting = new Set<MinistryId>(['finance', 'social_justice'])
  if (input.gender === 'female') supporting.add('women_child')
  supporting.delete(leadMinistryId)

  const rationaleEn = [
    `${MINISTRIES[leadMinistryId].name} is the lead department for ${input.category} businesses.`,
    'Department of Financial Services and Social Justice & Empowerment are always co-routed — NSFDC sanction sits under Social Justice, disbursal is a Finance concern.',
  ]
  const rationaleKn = [
    `${MINISTRIES[leadMinistryId].nameKn} — ${input.category} ವ್ಯವಹಾರಗಳಿಗೆ ಮುಖ್ಯ ಇಲಾಖೆ.`,
    'ಹಣಕಾಸು ಸೇವೆಗಳ ಮತ್ತು ಸಾಮಾಜಿಕ ನ್ಯಾಯ ಇಲಾಖೆಗಳು ಯಾವಾಗಲೂ ಸಹ-ಮಾರ್ಗಿತ.',
  ]
  if (input.gender === 'female') {
    rationaleEn.push('Women & Child Development co-routed — applicant identifies as a woman entrepreneur.')
    rationaleKn.push('ಮಹಿಳಾ ಉದ್ಯಮಿಯಾಗಿರುವುದರಿಂದ ಮಹಿಳಾ ಮತ್ತು ಮಕ್ಕಳ ಅಭಿವೃದ್ಧಿ ಇಲಾಖೆ ಸಹ-ಮಾರ್ಗಿತ.')
  }

  return { leadMinistryId, supportingMinistryIds: Array.from(supporting), rationaleEn, rationaleKn }
}
