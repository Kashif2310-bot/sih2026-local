import { useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { AlertIcon, ArrowUpIcon, MicIcon, StopIcon } from '../components/icons'
import { Waveform } from './components/Waveform'
import type { VoiceState } from './voiceState'

interface VoiceControlProps {
  voiceState: VoiceState
  inputLevel: number
  outputLevel: number
  errorMessage: string | null
  connecting?: boolean
  notice?: string | null
  onStart: () => void
  onStop: () => void
  onInterrupt: () => void
  onRetry: () => void
  onSubmitText: (text: string) => void
}

const ANNOUNCEMENT: Record<VoiceState, string> = {
  idle: '',
  listening: 'Listening',
  thinking: 'Understanding',
  speaking: 'Ishaara is speaking',
  error: 'Voice unavailable',
}

export function VoiceControl({
  voiceState,
  inputLevel,
  outputLevel,
  errorMessage,
  connecting = false,
  notice = null,
  onStart,
  onStop,
  onInterrupt,
  onRetry,
  onSubmitText,
}: VoiceControlProps) {
  const [draft, setDraft] = useState('')
  const mainRef = useRef<HTMLDivElement>(null)
  const focusWasInside = useRef(false)

  // Keep keyboard focus on the primary action when the controls swap.
  useLayoutEffect(() => {
    const lost = document.activeElement === null || document.activeElement === document.body
    if (!focusWasInside.current || !lost) return
    mainRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
  }, [voiceState])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!draft.trim()) return
    onSubmitText(draft)
    setDraft('')
  }

  return (
    <section className={`voice voice--${voiceState}`} aria-label="Voice assistant">
      <div
        ref={mainRef}
        key={voiceState}
        className="voice__main"
        onFocus={() => (focusWasInside.current = true)}
        onBlur={(event) => {
          const next = event.relatedTarget as Node | null
          if (next && !event.currentTarget.contains(next)) focusWasInside.current = false
        }}
      >
        {voiceState === 'idle' && (
          <button type="button" className="voice__talk" onClick={onStart} disabled={connecting} aria-busy={connecting}>
            <MicIcon />
            {connecting ? 'Connecting…' : 'Talk to Ishaara'}
          </button>
        )}

        {voiceState === 'listening' && (
          <>
            <span className="voice__mic" aria-hidden="true">
              <MicIcon />
            </span>
            <span className="voice__text">
              <strong>{connecting ? 'Reconnecting…' : 'Listening…'}</strong>
              <small data-testid="voice-hint">
                {connecting ? 'Connection dropped, resuming' : (notice ?? 'Speak about your idea')}
              </small>
            </span>
            <Waveform variant="user" level={inputLevel} />
            <button type="button" className="voice__icon-btn" onClick={onStop} aria-label="Stop listening">
              <StopIcon width={14} height={14} />
            </button>
          </>
        )}

        {voiceState === 'thinking' && (
          <>
            <span className="voice__dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span className="voice__text">
              <strong>{connecting ? 'Reconnecting…' : 'Understanding…'}</strong>
              <small>{connecting ? 'Your words will still be answered' : 'Finding the right path'}</small>
            </span>
            <button type="button" className="voice__icon-btn" onClick={onStop} aria-label="Stop">
              <StopIcon width={14} height={14} />
            </button>
          </>
        )}

        {voiceState === 'speaking' && (
          <>
            <Waveform variant="assistant" level={outputLevel} bars={16} />
            <span className="voice__text">
              <strong>Ishaara is speaking…</strong>
              <small>Speak anytime to interrupt</small>
            </span>
            <button type="button" className="voice__pill" onClick={onInterrupt}>
              Interrupt
            </button>
          </>
        )}

        {voiceState === 'error' && (
          <>
            <span className="voice__alert" aria-hidden="true">
              <AlertIcon />
            </span>
            <span className="voice__text">
              <strong>{errorMessage ?? 'Voice unavailable'}</strong>
              <small>You can still type below</small>
            </span>
            <button type="button" className="voice__pill" onClick={onRetry} disabled={connecting}>
              {connecting ? 'Connecting…' : 'Try again'}
            </button>
          </>
        )}
      </div>

      <span className="voice__divider" aria-hidden="true" />

      <form className="voice__type" onSubmit={submit}>
        <input
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Describe your situation..."
          aria-label="Describe your situation"
          autoComplete="off"
        />
        <button type="submit" className="voice__send" aria-label="Send" disabled={!draft.trim()}>
          <ArrowUpIcon width={15} height={15} />
        </button>
      </form>

      <span className="visually-hidden" role="status" aria-live="polite">
        {(voiceState === 'listening' || voiceState === 'thinking') && connecting
          ? 'Reconnecting'
          : voiceState === 'listening' && notice
            ? notice
            : ANNOUNCEMENT[voiceState]}
      </span>
    </section>
  )
}
