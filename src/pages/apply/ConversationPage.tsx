import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  createInitialProfile,
  defaultAssistantDeps,
  runAssistantTurn,
} from '../../assistant/orchestrator'
import type { ChatTurn } from '../../assistant/ai/types'
import type { UserProfile } from '../../assistant/types'
import { useApplicationDraft } from '../../citizen/useApplicationDraft'
import { useApp } from '../../state/useApp'
import { WizardActions, WizardShell } from '../../components/apply/WizardShell'

export function ConversationPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { transcript, setRankedSchemes } = useApplicationDraft()
  const { profile } = useApp()
  const [message, setMessage] = useState(
    transcript ||
      (profile
        ? `I am ${profile.name}, interested in ${profile.category} with margin about ${profile.availableMargin}`
        : ''),
  )
  const [history, setHistory] = useState<ChatTurn[]>([])
  const [userProfile, setUserProfile] = useState<UserProfile>(() => createInitialProfile())
  const [busy, setBusy] = useState(false)

  const send = async () => {
    if (!message.trim()) return
    setBusy(true)
    try {
      const result = await runAssistantTurn(
        { message: message.trim(), profile: userProfile, history },
        defaultAssistantDeps(),
      )
      setUserProfile(result.profile)
      setRankedSchemes(result.ranked)
      setHistory((h) => [
        ...h,
        { role: 'user', text: message.trim() },
        { role: 'assistant', text: result.reply.text },
      ])
      setMessage('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <WizardShell title={t('apply.conversation.title')} subtitle={t('apply.conversation.subtitle')}>
      <div className="min-h-40 space-y-3 rounded-2xl border border-forest/10 bg-white p-4">
        {history.length === 0 && (
          <p className="text-sm text-ink/50">{t('apply.conversation.subtitle')}</p>
        )}
        {history.map((turn, i) => (
          <div
            key={`${turn.role}-${i}`}
            className={
              turn.role === 'user'
                ? 'ml-8 rounded-xl bg-forest/10 px-3 py-2 text-sm'
                : 'mr-8 rounded-xl bg-mist px-3 py-2 text-sm'
            }
          >
            {turn.text}
          </div>
        ))}
      </div>

      <div className="mt-3 flex gap-2">
        <input
          className="flex-1 rounded-xl border border-forest/20 px-3 py-2 text-sm"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void send()
          }}
        />
        <button
          type="button"
          disabled={busy || !message.trim()}
          onClick={() => void send()}
          className="rounded-full bg-forest px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
        >
          {busy ? '…' : t('apply.voice.continue')}
        </button>
      </div>

      <WizardActions
        onBack={() => navigate('/apply/profile')}
        backLabel={t('apply.back')}
        onNext={() => navigate('/apply/recommendations')}
        nextLabel={t('apply.conversation.continue')}
      />
      <button
        type="button"
        className="mt-3 text-sm font-semibold text-forest hover:underline"
        onClick={() => navigate('/apply/recommendations')}
      >
        {t('apply.conversation.skip')}
      </button>
    </WizardShell>
  )
}
