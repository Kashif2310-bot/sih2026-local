// @vitest-environment jsdom
/**
 * /assistant/:id opened from a scan case shows its recommended schemes
 * straight away — ranked deterministically from the profile the scan
 * already supplied, before the citizen sends anything — while a plain
 * /assistant visit stays empty until the citizen engages.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { I18nextProvider } from 'react-i18next'
import i18n from '../i18n'
import { profileFromAssessment } from '../assistant/fromAssessment'
import { AssistantProvider } from '../assistant/state/AssistantContext'
import type { UserProfile } from '../assistant/types'
import type {
  VoiceEvent,
  VoiceEventInput,
  VoiceSession,
  VoiceSessionFactory,
  VoiceSessionStatus,
  VoiceToolResult,
} from '../assistant/voice/types'
import { VILLAGES } from '../data/villages'
import { LOKSCORE_WEIGHTS } from '../lib/config'
import { buildSchemePlan } from '../lib/finance'
import { curatedLocationFromVillage } from '../lib/resolveLocation'
import { AssistantPageInner } from './AssistantPage'

// jsdom does not implement Element.scrollTo, which AssistantPageInner's
// auto-scroll effect calls on every render (see AssistantPage.voiceLanguage.test.tsx).
if (typeof Element !== 'undefined') {
  Element.prototype.scrollTo = Element.prototype.scrollTo ?? (() => {})
}

/** The profile AssistantPage builds for a "Textiles / Tailoring" scan case. */
function tailoringScanProfile(): UserProfile {
  const village = VILLAGES.find((v) => v.district === 'Mandya')!
  return profileFromAssessment({
    profile: {
      name: 'Asha',
      age: 30,
      gender: 'female',
      community: 'sc',
      annualIncome: 150_000,
      experienceYears: 2,
      villageId: village.id,
      category: 'textiles',
      availableMargin: 100_000,
      locationMode: 'curated',
    },
    location: curatedLocationFromVillage(village, 7),
    plan: buildSchemePlan(100_000),
    score: {
      demand: 60,
      competitionGap: 70,
      weatherFit: 50,
      financialFit: 65,
      eligibility: 80,
      total: 68,
      grade: 'B',
      quorumRequired: 3,
      quorumPool: 5,
      mentorRequired: false,
      rationale: [],
      rationaleKn: [],
      weights: LOKSCORE_WEIGHTS,
    },
  })
}

/** A voice session the test can drive: it can deliver a provider tool call, like Gemini asking for the citizen's profile. */
class ScriptableVoiceSession implements VoiceSession {
  readonly id = 'scan-case-session'
  private _status: VoiceSessionStatus = 'listening'
  private seq = 0
  private readonly listeners = new Set<(event: VoiceEvent) => void>()
  readonly toolResponses: VoiceToolResult[][] = []

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
  sendToolResponse(results: VoiceToolResult[]): void {
    this.toolResponses.push(results)
  }
  getResumptionHandle(): string | null {
    return null
  }
  subscribe(listener: (event: VoiceEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  emit(partial: VoiceEventInput): void {
    this.seq += 1
    const event = { ...partial, seq: this.seq, at: new Date().toISOString(), sessionId: this.id } as VoiceEvent
    for (const listener of this.listeners) listener(event)
  }
}

function factoryFor(session: ScriptableVoiceSession): VoiceSessionFactory {
  return { providerId: 'gemini-live', isSupported: () => Promise.resolve(true), create: () => session }
}

function renderAssistant(options: { initialProfile?: UserProfile; caseBound?: boolean; session?: ScriptableVoiceSession }) {
  const session = options.session ?? new ScriptableVoiceSession()
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <AssistantProvider
          initialProfile={options.initialProfile}
          caseBound={options.caseBound}
          voiceSessionFactory={factoryFor(session)}
        >
          <AssistantPageInner placeName="Dinka" categoryLabel="Textiles / Tailoring" applicantName="Asha" />
        </AssistantProvider>
      </MemoryRouter>
    </I18nextProvider>,
  )
}

describe('/assistant/:id — scan case recommendations on load', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    await i18n.changeLanguage('en')
    fetchMock = vi.fn(() => Promise.reject(new Error('no network in this test')))
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows the matching scheme under "Recommended schemes" before any message is sent — with no network or model call', () => {
    renderAssistant({ initialProfile: tailoringScanProfile(), caseBound: true })

    expect(screen.getByRole('heading', { name: 'Recommended schemes' })).toBeInTheDocument()
    // Tailoring is one of PM Vishwakarma's trades, so the scan's own profile already matches it.
    expect(screen.getByRole('article', { name: 'PM Vishwakarma' })).toBeInTheDocument()
    expect(screen.queryByText('No schemes yet')).not.toBeInTheDocument()
    // Nothing was sent, nothing was fetched: ranking is deterministic and local.
    expect(screen.getByLabelText(i18n.t('assistant.inputLabel'))).toHaveValue('')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('leaves plain /assistant (no scan) empty until the citizen engages', () => {
    renderAssistant({})
    expect(screen.getByText('No schemes yet')).toBeInTheDocument()
    expect(screen.queryAllByRole('article')).toHaveLength(0)
  })

  it('keeps the scan ranking when voice starts and a provider tool call re-projects the controller', async () => {
    const session = new ScriptableVoiceSession()
    renderAssistant({ initialProfile: tailoringScanProfile(), caseBound: true, session })
    await waitFor(() => expect(screen.getByRole('button', { name: i18n.t('assistant.voice.micLabel') })).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: i18n.t('assistant.voice.micLabel') }))
    await waitFor(() => expect(screen.getByRole('button', { name: i18n.t('assistant.voice.stopLabel') })).toBeInTheDocument())

    // A read-only tool call: the runtime answers it, then re-projects the controller's state into the page.
    session.emit({ type: 'tool_call', calls: [{ id: 'tc-1', name: 'getCitizenProfile', args: {} }] })
    await waitFor(() => expect(session.toolResponses).toHaveLength(1))

    expect(screen.getByRole('article', { name: 'PM Vishwakarma' })).toBeInTheDocument()
    expect(screen.queryByText('No schemes yet')).not.toBeInTheDocument()
  })
})
