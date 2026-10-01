import {
  AI_HEALTHCHECK_TIMEOUT_MS,
  AI_REQUEST_TIMEOUT_MS,
  OLLAMA_BASE_URL,
  OLLAMA_MODEL,
  shouldProbeLocalOllama,
} from '../assistant/aiConfig'
import type { CompetitionAnalysisResult } from './types'

export interface CompetitionNarration {
  text: string
  source: 'local_ai' | 'deterministic_fallback'
}

function fallbackNarrative(result: CompetitionAnalysisResult): string {
  if (result.dataQuality === 'no_results') {
    return `Google Places returned no matching listings within ${result.radiusKm} km. This is a low observed density, not proof that no local competition exists; informal and unlisted rural businesses may be missing.`
  }
  const rating = result.averageRating == null
    ? 'Ratings were not available for the returned listings.'
    : `The rated listings average ${result.averageRating}/5 across ${result.totalRatingCount} ratings.`
  return `${result.competitorCount} similar businesses were returned within ${result.radiusKm} km, with an average distance of ${result.averageDistanceKm} km. The deterministic threat score is ${result.score}/100 (${result.threatLevel}). ${rating}`
}

function evidencePrompt(result: CompetitionAnalysisResult): string {
  const rows = result.competitors.map((item) =>
    `- ${item.name}: ${item.distanceKm} km; rating ${item.rating ?? 'unavailable'}; rating count ${item.ratingCount ?? 'unavailable'}`,
  )
  return [
    'Explain this local competition result in 2-4 plain sentences for a rural micro-entrepreneur.',
    'Use only the supplied facts. Do not invent businesses, ratings, demand, profitability, or market claims.',
    'If zero listings were returned, explicitly say this may mean missing/unlisted data rather than no competition.',
    `Radius: ${result.radiusKm} km`,
    `Competitor count: ${result.competitorCount}`,
    `Threat score: ${result.score}/100`,
    `Threat level: ${result.threatLevel}`,
    `Average distance: ${result.averageDistanceKm ?? 'unavailable'} km`,
    `Average rating: ${result.averageRating ?? 'unavailable'}`,
    `Total rating count: ${result.totalRatingCount}`,
    `Returned listings:\n${rows.length ? rows.join('\n') : '(none)'}`,
  ].join('\n')
}

function withTimeout(ms: number): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  return { signal: controller.signal, clear: () => clearTimeout(timer) }
}

function validateNarrative(text: string, result: CompetitionAnalysisResult): boolean {
  if (!text.trim()) return false
  if (result.dataQuality === 'no_results' && /no competition|competition does not exist/i.test(text)) return false
  const allowedNames = new Set(result.competitors.map((item) => item.name.toLowerCase()))
  const businessClaim = /(?:called|named)\s+["“]?([^"”.,]+)/gi
  let match: RegExpExecArray | null
  while ((match = businessClaim.exec(text))) {
    if (![...allowedNames].some((name) => name.includes(match![1].trim().toLowerCase()))) return false
  }
  const allowedNumbers = new Set<number>([
    5,
    100,
    result.radiusKm,
    result.competitorCount,
    result.score,
    result.totalRatingCount,
    result.breakdown.countScore,
    result.breakdown.proximityScore,
    result.breakdown.ratingStrengthScore,
    ...(result.averageDistanceKm == null ? [] : [result.averageDistanceKm]),
    ...(result.averageRating == null ? [] : [result.averageRating]),
    ...result.competitors.flatMap((item) => [
      item.distanceKm,
      ...(item.rating == null ? [] : [item.rating]),
      ...(item.ratingCount == null ? [] : [item.ratingCount]),
    ]),
  ].map((value) => Math.round(value * 10) / 10))
  const mentionedNumbers = text.match(/\b\d+(?:\.\d+)?\b/g)?.map(Number) ?? []
  if (mentionedNumbers.some((value) => !allowedNumbers.has(Math.round(value * 10) / 10))) return false
  return true
}

/** Optional local-AI narration. The deterministic result remains authoritative. */
export async function narrateCompetition(result: CompetitionAnalysisResult): Promise<CompetitionNarration> {
  const fallback = (): CompetitionNarration => ({ text: fallbackNarrative(result), source: 'deterministic_fallback' })
  const hostname = typeof window === 'undefined' ? undefined : window.location.hostname
  if (!shouldProbeLocalOllama(hostname, OLLAMA_BASE_URL)) return fallback()

  const health = withTimeout(AI_HEALTHCHECK_TIMEOUT_MS)
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`, { signal: health.signal })
    if (!response.ok) return fallback()
  } catch {
    return fallback()
  } finally {
    health.clear()
  }

  const request = withTimeout(AI_REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: request.signal,
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        stream: false,
        options: { temperature: 0.1 },
        messages: [
          { role: 'system', content: 'You explain deterministic evidence. Never add facts.' },
          { role: 'user', content: evidencePrompt(result) },
        ],
      }),
    })
    if (!response.ok) return fallback()
    const data = (await response.json()) as { message?: { content?: unknown } }
    const text = typeof data.message?.content === 'string' ? data.message.content.trim() : ''
    return validateNarrative(text, result) ? { text, source: 'local_ai' } : fallback()
  } catch {
    return fallback()
  } finally {
    request.clear()
  }
}

export { fallbackNarrative, validateNarrative }
