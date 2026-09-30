/**
 * Maps the citizen's explicit English/Kannada/Hindi choice for a Gemini Live
 * session onto (a) the VoiceSessionLanguageConfig passed to
 * VoiceSessionFactory.create() and (b) the system instruction text sent in
 * the setup message — kept as pure functions, separate from
 * AssistantContext.tsx, so the mapping is unit-testable without a React
 * render or a WebSocket.
 *
 * 'en' deliberately resolves to the SAME { primary: 'auto', ... } config and
 * the UNCHANGED base system instruction this app already sent before this
 * selector existed — selecting "English" must not change behavior on the
 * working path. Only 'kn' and 'hi' change anything.
 */

import { VOICE_SYSTEM_INSTRUCTION } from './voiceSystemInstruction'
import type { VoiceSessionLanguageConfig } from './types'

export type VoiceLanguageSelection = 'en' | 'kn' | 'hi'

/**
 * Appended (never substituted) after VOICE_SYSTEM_INSTRUCTION when the
 * citizen has explicitly picked Kannada, so the model is told plainly to
 * use Kannada rather than relying only on speechConfig.languageCode and the
 * base instruction's general "reply in whichever language they are using"
 * guidance.
 */
export const VOICE_KANNADA_LANGUAGE_DIRECTIVE =
  'LANGUAGE MODE: the citizen has explicitly selected Kannada for this session. Respond in Kannada.'

/** Hindi counterpart of VOICE_KANNADA_LANGUAGE_DIRECTIVE — same placement and rationale. */
export const VOICE_HINDI_LANGUAGE_DIRECTIVE =
  'LANGUAGE MODE: the citizen has explicitly selected Hindi for this session. Respond in Hindi.'

export function resolveVoiceSessionLanguage(selection: VoiceLanguageSelection): VoiceSessionLanguageConfig {
  if (selection === 'kn') return { primary: 'kn', allowCodeSwitching: true }
  if (selection === 'hi') return { primary: 'hi', allowCodeSwitching: true }
  return { primary: 'auto', allowCodeSwitching: true }
}

export function resolveVoiceSystemInstruction(selection: VoiceLanguageSelection): string {
  if (selection === 'kn') return `${VOICE_SYSTEM_INSTRUCTION}\n\n${VOICE_KANNADA_LANGUAGE_DIRECTIVE}`
  if (selection === 'hi') return `${VOICE_SYSTEM_INSTRUCTION}\n\n${VOICE_HINDI_LANGUAGE_DIRECTIVE}`
  return VOICE_SYSTEM_INSTRUCTION
}
