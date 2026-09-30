import { useEffect, useState, useSyncExternalStore } from 'react'
import { AdminPage } from './admin/AdminPage'
import { applicationStore } from './application/store'
import { AssistantExperience } from './assistant/AssistantExperience'
import { DemoController } from './assistant/demoController'
import { createLiveVoiceRuntime, type LiveSnapshot } from './assistant/live/liveRuntime'
import type { AssistantSnapshot } from './assistant/types'
import { DebugPanel } from './components/DebugPanel'
import { TopNav } from './components/TopNav'

/** `?mode=demo` runs the scripted, offline demo. Everything else is real Gemini Live. */
const isDemoMode = new URLSearchParams(window.location.search).get('mode') === 'demo'

const demo = isDemoMode ? new DemoController() : null
const live = isDemoMode ? null : createLiveVoiceRuntime()
const runtime = (demo ?? live)!

if (import.meta.hot) {
  import.meta.hot.dispose(() => runtime.dispose())
}

function useDebugToggle() {
  const [open, setOpen] = useState(() => new URLSearchParams(window.location.search).has('debug'))

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'd') {
        event.preventDefault()
        setOpen((value) => !value)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return [open, setOpen] as const
}

function useEscapeToStop(voiceState: string) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (voiceState === 'speaking') runtime.interrupt()
      else if (voiceState === 'listening' || voiceState === 'thinking') runtime.stop()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [voiceState])
}

/** `#admin` lists submitted applications, `#admin/<id>` opens one. Every other hash is the assistant. */
function useAdminRoute(): { admin: boolean; applicationId: string | null } {
  const read = () => {
    const match = window.location.hash.match(/^#admin(?:\/([^/?#]+))?$/)
    return match ? { admin: true, applicationId: match[1] ? decodeURIComponent(match[1]) : null } : { admin: false, applicationId: null }
  }
  const [route, setRoute] = useState(read)
  useEffect(() => {
    const onHashChange = () => setRoute(read())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])
  return route
}

export default function App() {
  const snapshot: AssistantSnapshot | LiveSnapshot = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot)
  const liveSnapshot = live ? (snapshot as LiveSnapshot) : null
  const [debugOpen, setDebugOpen] = useDebugToggle()
  const route = useAdminRoute()
  useEscapeToStop(snapshot.voiceState)

  // Release the microphone, socket and audio when the assistant unmounts or the admin opens.
  useEffect(() => () => runtime.stop(), [])
  useEffect(() => {
    if (route.admin) runtime.stop()
  }, [route.admin])

  return (
    <div className="app">
      <TopNav demo={isDemoMode} admin={route.admin} language={snapshot.language} onLanguageChange={runtime.setLanguage} />
      {route.admin ? (
        <AdminPage store={applicationStore} applicationId={route.applicationId} />
      ) : (
        <AssistantExperience
          voiceState={snapshot.voiceState}
          advisor={snapshot.advisor}
          submission={snapshot.submission}
          getOutputLevel={runtime.getOutputLevel}
          transcript={snapshot.transcript}
          assistantTranscript={snapshot.assistantTranscript}
          inputLevel={snapshot.inputLevel}
          outputLevel={snapshot.outputLevel}
          errorMessage={snapshot.errorMessage}
          connecting={liveSnapshot?.connecting ?? false}
          notice={liveSnapshot?.notice ?? null}
          onStart={runtime.start}
          onStop={runtime.stop}
          onInterrupt={runtime.interrupt}
          onRetry={runtime.retry}
          onSubmitText={runtime.submitText}
          onShowScheme={runtime.showScheme}
          onChooseScheme={runtime.chooseScheme}
          onCorrectField={runtime.correctField}
          onSetDocument={runtime.setDocument}
          onSubmitApplication={runtime.submitApplication}
          onClearSubmission={runtime.clearSubmission}
        />
      )}
      {debugOpen && (
        <DebugPanel
          voiceState={snapshot.voiceState}
          diagnostics={liveSnapshot?.diagnostics}
          demo={
            demo
              ? { onForce: demo.force, onInterrupt: demo.interrupt, onReset: demo.reset, onAutoDemo: demo.runAutoDemo }
              : undefined
          }
          onClose={() => setDebugOpen(false)}
        />
      )}
    </div>
  )
}
