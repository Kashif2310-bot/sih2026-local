import { describe, expect, it } from 'vitest'
import { SCHEMES } from '../../../assistant/data/schemes'
import { ADVISOR_SYSTEM_INSTRUCTION, buildSystemInstruction } from './systemInstruction'

describe('advisor system instruction', () => {
  it('makes Ishaara the one who completes the application, as the conversation goes', () => {
    expect(ADVISOR_SYSTEM_INSTRUCTION).toMatch(/complete a government scheme application WITH the citizen/)
    expect(ADVISOR_SYSTEM_INSTRUCTION).toMatch(/form on their screen fills in as they answer/)
    expect(ADVISOR_SYSTEM_INSTRUCTION).toMatch(/Never ask again for anything already recorded/)
    for (const tool of ['recordCitizenDetail', 'findSchemes', 'getSchemeDetails', 'applyForScheme', 'getCitizenProfile', 'getApplicationReadiness']) {
      expect(ADVISOR_SYSTEM_INSTRUCTION).toContain(tool)
    }
  })

  it('keeps the official site secondary and never claims a government filing or approval', () => {
    expect(ADVISOR_SYSTEM_INSTRUCTION).toMatch(/Do not send the citizen to a government website to apply/)
    expect(ADVISOR_SYSTEM_INSTRUCTION).toMatch(/nothing is sent to a government office from here/)
    expect(ADVISOR_SYSTEM_INSTRUCTION).toMatch(/Never say the citizen is approved/)
  })

  it('contains no scheme facts of its own; those come only from tool results', () => {
    for (const scheme of SCHEMES) {
      expect(ADVISOR_SYSTEM_INSTRUCTION).not.toContain(scheme.name)
      if (scheme.shortName) expect(ADVISOR_SYSTEM_INSTRUCTION).not.toContain(scheme.shortName)
    }
    expect(ADVISOR_SYSTEM_INSTRUCTION).not.toMatch(/₹|\d+\s*lakh/)
  })

  it('a Kannada session and a reconnect carry the language and the facts on file', () => {
    const text = buildSystemInstruction('kn', [{ key: 'age', label: 'Age', value: '32 years' }])
    expect(text).toMatch(/Respond in Kannada/)
    expect(text).toContain('- Age: 32 years')
  })

  it('a renewed session continues from the last exchanges without greeting again', () => {
    expect(buildSystemInstruction('en')).not.toMatch(/CONVERSATION SO FAR/)
    const text = buildSystemInstruction('en', [], [
      { speaker: 'Citizen', text: 'I want to start a dairy' },
      { speaker: 'Ishaara', text: 'What is your name?' },
    ])
    expect(text).toMatch(/do not greet the citizen again/)
    expect(text).toContain('Citizen: I want to start a dairy\nIshaara: What is your name?')
  })
})
