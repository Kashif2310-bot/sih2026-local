/** Named constants — MASTER_SPEC Rule 10. Do not scatter magic numbers in UI. */

import type { BusinessCategory } from '../data/villages'

/**
 * LokScore component weights — product-locked, must sum to 1.
 *   demand 25% · competition gap 20% · weather 15% · finance 25% · eligibility 15%
 * Quorum (80 → 2-of-3, 60 → 3-of-5, else 4-of-5 + mentor) keys off the weighted total.
 * Do not change these values without an explicit product decision.
 */
export const LOKSCORE_WEIGHTS = {
  demand: 0.25,
  competitionGap: 0.2,
  weather: 0.15,
  finance: 0.25,
  eligibility: 0.15,
} as const

export const QUORUM_THRESHOLDS = {
  high: 80, // ≥ → 2-of-3
  mid: 60, // ≥ → 3-of-5; below → 4-of-5 + mentor
} as const

export const REACH_KM = {
  min: 5,
  max: 10,
  default: 7,
} as const

/**
 * Single moratorium convention (capitalize_into_principal):
 * interest accrues each moratorium quarter and is capitalised into principal
 * at the start of repayment. No instalment is billed during moratorium.
 */
export const MORATORIUM_INTEREST_POLICY = 'capitalize_into_principal' as const

export const MORATORIUM_POLICY_LABEL = {
  en: 'Moratorium policy (capitalize_into_principal): interest accrues during the moratorium and is capitalised into principal at the start of repayment. No instalment is billed in moratorium quarters.',
  kn: 'ಮೊರಟೋರಿಯಂ ನೀತಿ (capitalize_into_principal): ಮೊರಟೋರಿಯಂ ಕಾಲದಲ್ಲಿ ಬಡ್ಡಿ ಸೇರಿ, ಮರುಪಾವತಿ ಆರಂಭದಲ್ಲಿ ಮೂಲಧನಕ್ಕೆ ಸೇರಿಸಲಾಗುತ್ತದೆ. ಮೊರಟೋರಿಯಂ ತ್ರೈಮಾಸಿಕಗಳಲ್ಲಿ ಕಂತು ವಿಧಿಸಲಾಗುವುದಿಲ್ಲ.',
} as const

/** Working-capital cycle length (months of opex to hold). Short: dairy/food; longer: textiles. */
export const WC_CYCLE_MONTHS: Record<BusinessCategory, number> = {
  dairy: 1.5,
  food: 1,
  retail: 1.5,
  textiles: 3,
  poultry: 2,
  agri_processing: 2,
}

/** Share of monthly opex by line item (sums to 1). */
export const WC_OPEX_SPLIT = {
  rawMaterial: 0.45,
  labour: 0.25,
  utilities: 0.15,
  transportRent: 0.15,
} as const

export const NSFDC = {
  marginRatio: 0.1,
  loanRatio: 0.9,
  microProjectCapRupees: 140_000,
  microLoanCapRupees: 125_000,
  termProjectCapRupees: 5_000_000,
  termLoanCapRupees: 4_500_000,
  microRate: 6.5,
  termRate: 8,
  microTenureYears: 3,
  termTenureYears: 7,
  microMoratoriumMonths: 3,
  termMoratoriumMonths: 6,
  maxMarginRupees: 500_000,
} as const

/**
 * Every live network call (Nominatim geocode, Overpass competitor lookup,
 * Open-Meteo weather) aborts after this long and falls through to the
 * existing honest "unavailable"/"limited data" UI state. Kept short (2-3s)
 * so a live screen-share demo never sits on a spinner waiting for a slow or
 * dead connection — fail fast, show the honest fallback, keep moving.
 */
export const LIVE_CALL_TIMEOUT_MS = 2_500
export const OVERPASS_TIMEOUT_MS = LIVE_CALL_TIMEOUT_MS
export const NOMINATIM_TIMEOUT_MS = LIVE_CALL_TIMEOUT_MS
/**
 * Nominatim usage policy: "an absolute maximum of 1 request per second"
 * (operations.osmfoundation.org/policies/nominatim). A small margin over 1s
 * so clock jitter can never land two requests inside the same second.
 */
export const NOMINATIM_MIN_INTERVAL_MS = 1_100
/** One retry after a live-source failure, before marking the scan incomplete. */
export const LIVE_RETRY_BACKOFF_MS = 400
