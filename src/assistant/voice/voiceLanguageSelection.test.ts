import { describe, expect, it } from 'vitest'
import {
  resolveVoiceSessionLanguage,
  resolveVoiceSystemInstruction,
  VOICE_KANNADA_LANGUAGE_DIRECTIVE,
} from './voiceLanguageSelection'
import { VOICE_SYSTEM_INSTRUCTION } from './voiceSystemInstruction'

describe('resolveVoiceSessionLanguage', () => {
  it('"en" resolves to the same auto/code-switching config the app already sent before this selector existed', () => {
    expect(resolveVoiceSessionLanguage('en')).toEqual({ primary: 'auto', allowCodeSwitching: true })
  })

  it('"kn" resolves to an explicit kn primary language', () => {
    expect(resolveVoiceSessionLanguage('kn')).toEqual({ primary: 'kn', allowCodeSwitching: true })
  })
})

describe('resolveVoiceSystemInstruction', () => {
  it('"en" returns the base system instruction completely unchanged', () => {
    expect(resolveVoiceSystemInstruction('en')).toBe(VOICE_SYSTEM_INSTRUCTION)
  })

  it('"kn" appends the Kannada directive after the full base instruction, never replacing it', () => {
    const result = resolveVoiceSystemInstruction('kn')
    expect(result.startsWith(VOICE_SYSTEM_INSTRUCTION)).toBe(true)
    expect(result).toContain(VOICE_KANNADA_LANGUAGE_DIRECTIVE)
    expect(result.length).toBeGreaterThan(VOICE_SYSTEM_INSTRUCTION.length)
  })

  it('the Kannada directive text explicitly says to respond in Kannada', () => {
    expect(VOICE_KANNADA_LANGUAGE_DIRECTIVE.toLowerCase()).toContain('respond in kannada')
  })
})
