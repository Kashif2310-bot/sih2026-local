import type { LiveDiagnostics } from '../assistant/live/liveRuntime'
import type { VoiceState } from '../assistant/voiceState'
import { CloseIcon } from './icons'

interface DemoControls {
  onForce: (state: VoiceState) => void
  onInterrupt: () => void
  onReset: () => void
  onAutoDemo: () => void
}

interface DebugPanelProps {
  voiceState: VoiceState
  /** Forced states are demo-only; the live runtime is never driven by fake states. */
  demo?: DemoControls
  diagnostics?: LiveDiagnostics
  onClose: () => void
}

const STATES: VoiceState[] = ['idle', 'listening', 'thinking', 'speaking', 'error']

export function DebugPanel({ voiceState, demo, diagnostics, onClose }: DebugPanelProps) {
  return (
    <aside className="debug" aria-label="Developer controls">
      <header className="debug__header">
        <span>
          Debug <kbd>Ctrl</kbd>
          <kbd>Shift</kbd>
          <kbd>D</kbd>
        </span>
        <button type="button" className="debug__close" onClick={onClose} aria-label="Close developer controls">
          <CloseIcon width={14} height={14} />
        </button>
      </header>

      <p className="debug__state">
        {demo ? 'demo' : 'gemini live'} · state <strong data-state={voiceState}>{voiceState}</strong>
      </p>

      {diagnostics && (
        <dl className="debug__diag">
          <dt>config</dt>
          <dd>{diagnostics.configured ? 'supabase set' : 'missing env'}</dd>
          <dt>voice</dt>
          <dd>{diagnostics.voiceName}</dd>
          <dt>socket</dt>
          <dd>{diagnostics.connection}</dd>
          <dt>mic</dt>
          <dd>{diagnostics.microphone}</dd>
          <dt>audio</dt>
          <dd>{diagnostics.playback}</dd>
          <dt>last event</dt>
          <dd>{diagnostics.lastServerEvent ?? '—'}</dd>
          <dt>malformed</dt>
          <dd>{diagnostics.malformedFrames}</dd>
          <dt>close code</dt>
          <dd>
            {diagnostics.lastCloseCode ?? '—'}
            {diagnostics.lastCloseReason ? ` (${diagnostics.lastCloseReason})` : ''}
          </dd>
          <dt>reconnects</dt>
          <dd>{diagnostics.reconnects}</dd>
          <dt>stalled replies</dt>
          <dd>{diagnostics.stalls}</dd>
          <dt>error</dt>
          <dd>{diagnostics.lastError ?? '—'}</dd>
        </dl>
      )}

      {demo && (
        <div className="debug__grid">
          {STATES.map((state) => (
            <button
              key={state}
              type="button"
              onClick={() => demo.onForce(state)}
              aria-pressed={voiceState === state}
            >
              {state[0].toUpperCase() + state.slice(1)}
            </button>
          ))}
          <button
            type="button"
            onClick={demo.onInterrupt}
            disabled={voiceState !== 'speaking' && voiceState !== 'thinking'}
          >
            Interrupt
          </button>
          <button type="button" onClick={demo.onReset}>
            Reset
          </button>
          <button type="button" className="debug__primary" onClick={demo.onAutoDemo}>
            Auto demo
          </button>
        </div>
      )}

      <a className="debug__link" href={demo ? '?debug' : '?mode=demo&debug'}>
        {demo ? 'Switch to Gemini Live' : 'Switch to demo mode'}
      </a>
    </aside>
  )
}
