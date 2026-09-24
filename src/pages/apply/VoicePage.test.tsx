// @vitest-environment jsdom
/**
 * First component-level test in this codebase (checked: no other .test.tsx
 * file exists). Opted into jsdom via the per-file magic comment above
 * rather than changing vitest.config.ts's global `environment: 'node'`,
 * which every other test in the repo relies on staying as-is.
 *
 * Covers the real, reported bug: in a browser where window.SpeechRecognition
 * exists but the recognition backend never responds (observed in Opera GX),
 * the UI must not stay on "Listening..." forever, and every documented
 * error code must produce a specific, visible message.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../i18n'
import { ApplicationDraftCtx } from '../../citizen/draft-state'
import type { DraftState } from '../../citizen/draft-state'
import { EMPTY_EXTRA } from '../../citizen/draft-types'
import { VoicePage } from './VoicePage'

function draftValue(overrides: Partial<DraftState> = {}): DraftState {
  return {
    transcript: '',
    extra: EMPTY_EXTRA,
    documents: [],
    consentGiven: false,
    consentAt: null,
    consentName: '',
    submittedId: null,
    rankedSchemes: [],
    setTranscript: vi.fn(),
    updateExtra: vi.fn(),
    ensureDocuments: vi.fn(),
    updateDocument: vi.fn(),
    setConsent: vi.fn(),
    setRankedSchemes: vi.fn(),
    submit: () => null,
    reset: vi.fn(),
    ...overrides,
  }
}

function renderVoicePage(draft: DraftState = draftValue()) {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={['/apply/voice']}>
        <ApplicationDraftCtx.Provider value={draft}>
          <VoicePage />
        </ApplicationDraftCtx.Provider>
      </MemoryRouter>
    </I18nextProvider>,
  )
}

/** A scriptable stand-in for window.SpeechRecognition/webkitSpeechRecognition. */
class FakeSpeechRecognition {
  static instances: FakeSpeechRecognition[] = []
  lang = ''
  continuous = false
  interimResults = false
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null = null
  onerror: ((event: { error?: string }) => void) | null = null
  onend: (() => void) | null = null
  started = false
  stopped = false

  constructor() {
    FakeSpeechRecognition.instances.push(this)
  }
  start() {
    this.started = true
  }
  stop() {
    this.stopped = true
    this.onend?.()
  }
}

beforeEach(() => {
  FakeSpeechRecognition.instances = []
  ;(window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition = FakeSpeechRecognition
})

afterEach(() => {
  vi.useRealTimers()
  delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition
  delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition
})

describe('VoicePage — SpeechRecognition unsupported/error handling', () => {
  it('shows the unsupported message and no mic button when neither constructor exists', () => {
    delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition
    renderVoicePage()
    expect(screen.getByText(i18n.t('apply.voice.unsupported'))).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: i18n.t('apply.voice.start') })).not.toBeInTheDocument()
  })

  it('never gets stuck on "Listening..." when the recognition backend never responds at all', () => {
    vi.useFakeTimers()
    renderVoicePage()
    fireEvent.click(screen.getByRole('button', { name: 'Start speaking' }))
    expect(screen.getByText(i18n.t('apply.voice.listening'))).toBeInTheDocument()

    // The Opera GX case: start() succeeded, but onresult/onerror/onend never
    // fire. Advance past the response timeout without simulating anything.
    act(() => {
      vi.advanceTimersByTime(7_001)
    })

    expect(screen.queryByText(i18n.t('apply.voice.listening'))).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(i18n.t('apply.voice.error.noResponse'))
  })

  it.each([
    ['network', 'network'],
    ['not-allowed', 'notAllowed'],
    ['service-not-allowed', 'serviceNotAllowed'],
    ['no-speech', 'noSpeech'],
    ['some-unmapped-code', 'generic'],
  ])('maps SpeechRecognitionErrorEvent.error=%s to apply.voice.error.%s', (code, key) => {
    renderVoicePage()
    fireEvent.click(screen.getByRole('button', { name: 'Start speaking' }))
    const recog = FakeSpeechRecognition.instances.at(-1)!

    act(() => {
      recog.onerror?.({ error: code })
    })

    expect(screen.queryByText(i18n.t('apply.voice.listening'))).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(i18n.t(`apply.voice.error.${key}`))
  })

  it('a genuine result clears the response timeout instead of firing it later', () => {
    vi.useFakeTimers()
    renderVoicePage()
    fireEvent.click(screen.getByRole('button', { name: 'Start speaking' }))
    const recog = FakeSpeechRecognition.instances.at(-1)!

    act(() => {
      recog.onresult?.({ results: [[{ transcript: 'hello' }]] })
    })
    act(() => {
      vi.advanceTimersByTime(7_001)
    })

    // The (now-stale) timeout must not have fired an error after a real result came in.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('starting again clears a previous error message', () => {
    renderVoicePage()
    fireEvent.click(screen.getByRole('button', { name: 'Start speaking' }))
    const recog = FakeSpeechRecognition.instances.at(-1)!
    act(() => {
      recog.onerror?.({ error: 'no-speech' })
    })
    expect(screen.getByRole('alert')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Start speaking' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('stops recognition and clears the pending timer on unmount (no leaked mic indicator, no post-unmount state update)', () => {
    vi.useFakeTimers()
    const { unmount } = renderVoicePage()
    fireEvent.click(screen.getByRole('button', { name: 'Start speaking' }))
    const recog = FakeSpeechRecognition.instances.at(-1)!

    unmount()
    expect(recog.stopped).toBe(true)

    // If the timer were still pending it would call setState on an
    // unmounted component here — act() would surface that as a warning
    // that fails a strict test run; this must be a silent no-op.
    act(() => {
      vi.advanceTimersByTime(7_001)
    })
  })
})
