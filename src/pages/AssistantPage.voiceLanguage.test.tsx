// @vitest-environment jsdom
/**
 * Covers the Kannada voice-language selector added to /assistant: picking
 * "Kannada" before starting voice must reach the actual VoiceSessionFactory
 * call with { primary: 'kn', ... } and the appended "Respond in Kannada"
 * system instruction, while leaving the default ("English") path producing
 * EXACTLY the same session config as before this selector existed — see
 * voiceLanguageSelection.ts, which this test exercises through the real
 * AssistantProvider wiring rather than in isolation.
 */
import { describe, expect, it } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { I18nextProvider } from 'react-i18next'
import i18n from '../i18n'
import { AssistantProvider } from '../assistant/state/AssistantContext'
import { AssistantPageInner } from './AssistantPage'
import type {
  VoiceEvent,
  VoiceSession,
  VoiceSessionConfig,
  VoiceSessionFactory,
  VoiceSessionStatus,
  VoiceToolResult,
} from '../assistant/voice/types'
import { VOICE_SYSTEM_INSTRUCTION } from '../assistant/voice/voiceSystemInstruction'
import { VOICE_KANNADA_LANGUAGE_DIRECTIVE } from '../assistant/voice/voiceLanguageSelection'

// jsdom does not implement Element.scrollTo — AssistantPageInner's
// auto-scroll-to-latest-message effect calls it unconditionally on every
// render, which is unrelated to this test's feature but throws without this
// stub. Not a production bug: real browsers all implement scrollTo.
if (typeof Element !== 'undefined') {
  Element.prototype.scrollTo = Element.prototype.scrollTo ?? (() => {})
}

/** Minimal hand-driven VoiceSession — same style as voiceConversationRuntime.test.ts's FakeVoiceSession, trimmed to only what VoiceConversationRuntime.start() touches (connect + subscribe). No audio bridge is exercised here because jsdom has no getUserMedia, so isBrowserVoiceAudioSupported() is false and AssistantContext never constructs one. */
class FakeVoiceSession implements VoiceSession {
  readonly id = 'fake-session'
  private _status: VoiceSessionStatus = 'listening'
  private readonly listeners = new Set<(event: VoiceEvent) => void>()

  get status(): VoiceSessionStatus {
    return this._status
  }
  connect(): Promise<void> {
    return Promise.resolve()
  }
  close(): Promise<void> {
    this._status = 'closed'
    return Promise.resolve()
  }
  sendAudioChunk(): void {}
  endUserTurn(): void {}
  sendTextInput(): void {}
  interrupt(): void {}
  updateContext(): void {}
  deliverAssistantReply(): void {}
  sendToolResponse(_results: VoiceToolResult[]): void {}
  getResumptionHandle(): string | null {
    return null
  }
  subscribe(listener: (event: VoiceEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}

function fakeFactory(onCreate: (config: VoiceSessionConfig) => void): VoiceSessionFactory {
  return {
    providerId: 'gemini-live',
    isSupported: () => Promise.resolve(true),
    create: (config) => {
      onCreate(config)
      return new FakeVoiceSession()
    },
  }
}

function renderAssistantPage(factory: VoiceSessionFactory) {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={['/assistant']}>
        <AssistantProvider voiceSessionFactory={factory}>
          <AssistantPageInner placeName="" categoryLabel="" applicantName="" />
        </AssistantProvider>
      </MemoryRouter>
    </I18nextProvider>,
  )
}

describe('/assistant voice language selector', () => {
  it('defaults to English selected and visible once voice is available', async () => {
    renderAssistantPage(fakeFactory(() => {}))
    const englishButton = await screen.findByRole('button', { name: 'English' })
    const kannadaButton = screen.getByRole('button', { name: 'Kannada' })
    expect(englishButton).toHaveAttribute('aria-pressed', 'true')
    expect(kannadaButton).toHaveAttribute('aria-pressed', 'false')
  })

  it('starting voice with the default English selection sends the SAME config as before this selector existed', async () => {
    let captured: VoiceSessionConfig | null = null
    renderAssistantPage(fakeFactory((config) => (captured = config)))

    const micButton = await screen.findByRole('button', { name: /talk instead of typing/i })
    fireEvent.click(micButton)

    await waitFor(() => expect(captured).not.toBeNull())
    expect(captured!.language).toEqual({ primary: 'auto', allowCodeSwitching: true })
    expect(captured!.systemInstruction).toBe(VOICE_SYSTEM_INSTRUCTION)
  })

  it('selecting Kannada then starting voice sets kn as primary language and appends the Kannada directive without dropping the base instruction', async () => {
    let captured: VoiceSessionConfig | null = null
    renderAssistantPage(fakeFactory((config) => (captured = config)))

    const kannadaButton = await screen.findByRole('button', { name: 'Kannada' })
    fireEvent.click(kannadaButton)
    expect(kannadaButton).toHaveAttribute('aria-pressed', 'true')

    const micButton = screen.getByRole('button', { name: /talk instead of typing/i })
    fireEvent.click(micButton)

    await waitFor(() => expect(captured).not.toBeNull())
    expect(captured!.language).toEqual({ primary: 'kn', allowCodeSwitching: true })
    expect(captured!.systemInstruction).toContain(VOICE_SYSTEM_INSTRUCTION)
    expect(captured!.systemInstruction).toContain(VOICE_KANNADA_LANGUAGE_DIRECTIVE)
  })

  it('the language selector is disabled once a voice session is active, so it cannot be changed mid-session', async () => {
    renderAssistantPage(fakeFactory(() => {}))
    const micButton = await screen.findByRole('button', { name: /talk instead of typing/i })
    fireEvent.click(micButton)

    await waitFor(() => expect(screen.getByRole('button', { name: /stop voice/i })).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'English' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Kannada' })).toBeDisabled()
  })
})
