import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Mic, MicOff } from 'lucide-react'
import { WizardActions, WizardShell } from '../../components/apply/WizardShell'
import { useApplicationDraft } from '../../citizen/useApplicationDraft'

type SpeechRecognitionLike = {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onerror: (() => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
}

function getSpeechRecognition(): (new () => SpeechRecognitionLike) | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike
    webkitSpeechRecognition?: new () => SpeechRecognitionLike
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export function VoicePage() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { transcript, setTranscript } = useApplicationDraft()
  const [listening, setListening] = useState(false)
  const recogRef = useRef<SpeechRecognitionLike | null>(null)
  const SpeechRecognitionCtor = getSpeechRecognition()
  const supported = Boolean(SpeechRecognitionCtor)

  const stop = () => {
    recogRef.current?.stop()
    setListening(false)
  }

  const start = () => {
    if (!SpeechRecognitionCtor) return
    const recog = new SpeechRecognitionCtor()
    recog.lang = i18n.language === 'kn' ? 'kn-IN' : 'en-IN'
    recog.continuous = true
    recog.interimResults = true
    recog.onresult = (event) => {
      let text = ''
      for (let i = 0; i < event.results.length; i++) {
        text += event.results[i]![0]!.transcript
      }
      setTranscript(text.trim())
    }
    recog.onerror = () => setListening(false)
    recog.onend = () => setListening(false)
    recogRef.current = recog
    recog.start()
    setListening(true)
  }

  return (
    <WizardShell title={t('apply.voice.title')} subtitle={t('apply.voice.subtitle')}>
      {!supported && (
        <p className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-ink/70">
          {t('apply.voice.unsupported')}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {supported && (
          <button
            type="button"
            onClick={() => (listening ? stop() : start())}
            className="inline-flex items-center gap-2 rounded-full bg-forest px-4 py-2.5 text-sm font-bold text-white"
          >
            {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            {listening ? t('apply.voice.stop') : t('apply.voice.start')}
          </button>
        )}
        {listening && <span className="self-center text-sm font-semibold text-forest">{t('apply.voice.listening')}</span>}
      </div>

      <textarea
        className="mt-4 min-h-32 w-full rounded-2xl border border-forest/20 bg-white px-3 py-3 text-sm"
        placeholder={t('apply.voice.placeholder')}
        value={transcript}
        onChange={(e) => setTranscript(e.target.value)}
      />

      <WizardActions
        onNext={() => navigate('/apply/profile')}
        nextLabel={t('apply.voice.continue')}
        nextDisabled={!transcript.trim()}
      />
      <button
        type="button"
        className="mt-3 text-sm font-semibold text-forest hover:underline"
        onClick={() => navigate('/apply/profile')}
      >
        {t('apply.voice.skipToForm')}
      </button>
    </WizardShell>
  )
}
