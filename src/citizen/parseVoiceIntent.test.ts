import { describe, expect, it } from 'vitest'
import { parseVoiceIntent } from './parseVoiceIntent'

describe('parseVoiceIntent', () => {
  it('extracts dairy, Mandya, and one lakh from the English example', () => {
    const intent = parseVoiceIntent(
      'I want to start a dairy business in Mandya with one lakh rupees margin',
    )
    expect(intent.category).toBe('dairy')
    expect(intent.villageId).toBe('dinka-mandya')
    expect(intent.availableMargin).toBe(100_000)
    expect(intent.hints.length).toBeGreaterThan(0)
  })

  it('extracts Kannada dairy + Mandya + one lakh', () => {
    const intent = parseVoiceIntent(
      'ನಾನು ಮಂಡ್ಯದಲ್ಲಿ ಒಂದು ಲಕ್ಷ ರೂಪಾಯಿ ಮಾರ್ಜಿನ್‌ನೊಂದಿಗೆ ಹೈನುಗಾರಿಕೆ ಪ್ರಾರಂಭಿಸಲು ಬಯಸುತ್ತೇನೆ',
    )
    expect(intent.category).toBe('dairy')
    expect(intent.villageId).toBe('dinka-mandya')
    expect(intent.availableMargin).toBe(100_000)
  })

  it('returns empty hints for blank text', () => {
    expect(parseVoiceIntent('   ')).toEqual({ hints: [] })
  })
})
