import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Loader2, RotateCcw, Send } from 'lucide-react'
import { profileFromAssessment } from '../assistant/fromAssessment'
import { AssistantProvider } from '../assistant/state/AssistantContext'
import { useAssistant } from '../assistant/state/useAssistant'
import { ActionPlanPanel } from '../components/assistant/ActionPlanPanel'
import { ChatMessageBubble } from '../components/assistant/ChatMessageBubble'
import { ProfileSidebar } from '../components/assistant/ProfileSidebar'
import { SchemeCard } from '../components/assistant/SchemeCard'
import { SchemeDetailModal } from '../components/assistant/SchemeDetailModal'
import { StarterQuestions } from '../components/assistant/StarterQuestions'
import { BUSINESS_META } from '../data/villages'
import { useApp } from '../state/useApp'

export function AssistantPage() {
  const { id } = useParams<{ id?: string }>()
  const { profile, location, plan, score } = useApp()
  const caseBound = Boolean(id && profile && location && plan && score)
  const initialProfile =
    caseBound && profile && location && plan && score
      ? profileFromAssessment({ profile, location, plan, score })
      : undefined

  return (
    <AssistantProvider key={id ?? 'empty'} initialProfile={initialProfile} caseBound={caseBound}>
      <AssistantPageInner
        placeName={location ? location.name : ''}
        categoryLabel={profile ? BUSINESS_META[profile.category].label : ''}
        applicantName={profile?.name ?? ''}
      />
    </AssistantProvider>
  )
}

function AssistantPageInner({
  placeName,
  categoryLabel,
  applicantName,
}: {
  placeName: string
  categoryLabel: string
  applicantName: string
}) {
  const { t } = useTranslation()
  const {
    profile,
    messages,
    ranked,
    missingFields,
    actionPlan,
    loading,
    error,
    selectedSchemeId,
    hasStarted,
    caseBound,
    sendMessage,
    retryLast,
    selectScheme,
    reset,
  } = useAssistant()
  const [draft, setDraft] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, loading])

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault()
    const text = draft
    if (!text.trim()) return
    setDraft('')
    void sendMessage(text)
  }

  const selectedRanked = ranked.find((r) => r.scheme.id === selectedSchemeId) ?? null

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold text-forest">{t('assistant.title')}</h1>
          <p className="mt-2 max-w-2xl text-ink/65">{t('assistant.subtitle')}</p>
        </div>
        {hasStarted && (
          <button
            type="button"
            onClick={reset}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-forest/20 bg-white px-3.5 py-2 text-xs font-semibold text-forest hover:border-forest/40"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {t('assistant.newConversation')}
          </button>
        )}
      </div>

      <p className="rounded-xl border border-gold/30 bg-gold/10 px-3.5 py-2.5 text-xs text-[#6b5300]">
        {t('assistant.knowledgeBaseNote')}
      </p>
      {caseBound ? (
        <p className="rounded-xl border border-forest/20 bg-mist px-3.5 py-2.5 text-sm text-forest">
          {t('assistant.caseBanner', {
            name: applicantName,
            place: placeName,
            category: categoryLabel,
          })}
        </p>
      ) : (
        <p className="text-xs text-ink/55">{t('assistant.emptyVisit')}</p>
      )}

      <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)_340px]">
        <div className="order-2 lg:order-1">
          <ProfileSidebar profile={profile} missingFields={missingFields} />
        </div>

        <div className="glass order-1 flex h-[70vh] min-h-[420px] flex-col rounded-2xl p-4 lg:order-2">
          <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto pr-1">
            {messages.length === 0 ? (
              caseBound ? (
                <p className="text-sm text-ink/60">{t('assistant.caseBanner', {
                  name: applicantName,
                  place: placeName,
                  category: categoryLabel,
                })}</p>
              ) : (
                <StarterQuestions onPick={(text) => void sendMessage(text)} disabled={loading} />
              )
            ) : (
              messages.map((m) => <ChatMessageBubble key={m.id} message={m} />)
            )}
            {loading && (
              <div className="flex items-center gap-2 pl-1 text-xs text-ink/50">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {t('assistant.thinking')}
              </div>
            )}
            {error && (
              <div role="alert" className="rounded-xl bg-[#ffece8] px-3.5 py-2.5 text-sm text-danger">
                <p className="font-semibold">{t('assistant.errorTitle')}</p>
                <p className="mt-0.5 text-xs">{error}</p>
                <button
                  type="button"
                  onClick={() => void retryLast()}
                  className="mt-2 rounded-full bg-danger/10 px-3 py-1 text-xs font-semibold text-danger hover:bg-danger/20"
                >
                  {t('assistant.retry')}
                </button>
              </div>
            )}
          </div>

          <form onSubmit={submit} className="mt-3 flex items-end gap-2 border-t border-forest/10 pt-3">
            <label className="sr-only" htmlFor="assistant-input">
              {t('assistant.inputLabel')}
            </label>
            <textarea
              id="assistant-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  submit()
                }
              }}
              placeholder={t('assistant.inputPlaceholder')}
              rows={2}
              className="flex-1 resize-none rounded-xl border border-forest/15 bg-white px-3.5 py-2.5 text-sm outline-none ring-forest/30 focus:ring-2"
            />
            <button
              type="submit"
              disabled={loading || !draft.trim()}
              className="inline-flex items-center gap-1.5 rounded-full bg-forest px-4 py-2.5 text-sm font-bold text-white transition hover:bg-leaf disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
              {t('assistant.send')}
            </button>
          </form>
        </div>

        <div className="order-3 space-y-4">
          <div>
            <h2 className="font-display text-sm font-bold text-forest">{t('assistant.recommendationsTitle')}</h2>
            {ranked.length === 0 ? (
              <div className="glass mt-2 rounded-2xl p-4 text-center">
                <p className="text-sm font-semibold text-ink/60">{t('assistant.recommendationsEmpty')}</p>
                <p className="mt-1 text-xs text-ink/45">{t('assistant.recommendationsEmptyHint')}</p>
              </div>
            ) : (
              <div className="mt-2 space-y-3">
                {ranked.slice(0, 6).map((r) => (
                  <SchemeCard key={r.scheme.id} ranked={r} onViewDetails={() => selectScheme(r.scheme.id)} />
                ))}
              </div>
            )}
          </div>
          <ActionPlanPanel steps={actionPlan} />
        </div>
      </div>

      <SchemeDetailModal ranked={selectedRanked} onClose={() => selectScheme(null)} />
    </div>
  )
}
