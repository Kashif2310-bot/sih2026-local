import { useEffect, useState, type ReactNode } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AlertCircle, Loader2 } from 'lucide-react'
import { ApiError, getAssessment } from '../lib/api'
import {
  isAssessmentSnapshot,
  readCachedSnapshot,
  readLastAssessmentId,
  writeLastAssessmentId,
} from '../lib/assessmentSnapshot'
import { useApp } from '../state/useApp'

export type AssessmentPage = 'pulse' | 'report' | 'finance' | 'sanction' | 'export' | 'assistant'

export function LegacyAssessmentRedirect({ page }: { page: AssessmentPage }) {
  const { assessmentId } = useApp()
  const id = assessmentId ?? readLastAssessmentId()
  if (id) return <Navigate to={`/${page}/${id}`} replace />
  return <Navigate to="/scan" replace />
}

export function AssessmentRoute({ children }: { children: ReactNode }) {
  const { t, i18n } = useTranslation()
  const kn = i18n.language === 'kn'
  const { id } = useParams<{ id: string }>()
  const { hasAssessment, hydrateFromSnapshot, persisted } = useApp()
  const [gate, setGate] = useState<'loading' | 'ready' | 'error' | 'not-found'>(() =>
    id && hasAssessment(id) ? 'ready' : 'loading',
  )
  const [retryKey, setRetryKey] = useState(0)

  useEffect(() => {
    if (!id) {
      setGate('not-found')
      return
    }
    if (hasAssessment(id)) {
      setGate('ready')
      return
    }

    let cancelled = false
    setGate('loading')

    void (async () => {
      try {
        const row = await getAssessment(id)
        if (cancelled) return
        if (!isAssessmentSnapshot(row.outputs_json)) {
          setGate('error')
          return
        }
        await hydrateFromSnapshot(id, row.outputs_json, true)
        writeLastAssessmentId(id, true)
        if (!cancelled) setGate('ready')
      } catch (e) {
        if (cancelled) return
        const cached = readCachedSnapshot(id)
        if (cached) {
          await hydrateFromSnapshot(id, cached, false)
          if (!cancelled) setGate('ready')
          return
        }
        if (e instanceof ApiError && e.status === 404) {
          setGate('not-found')
          return
        }
        setGate('error')
      }
    })()

    return () => {
      cancelled = true
    }
  }, [id, retryKey, hasAssessment, hydrateFromSnapshot])

  if (!id || gate === 'not-found') {
    return (
      <div className="glass mx-auto max-w-lg rounded-2xl p-8 text-center">
        <AlertCircle className="mx-auto h-8 w-8 text-clay" />
        <h1 className="mt-3 font-display text-xl font-bold text-forest">
          {kn ? 'ಈ ಸ್ಕ್ಯಾನ್ ಸಿಗಲಿಲ್ಲ' : 'Assessment not found'}
        </h1>
        <p className="mt-2 text-sm text-ink/65">
          {kn
            ? 'ಈ ಲಿಂಕ್ ಅಮಾನ್ಯ ಅಥವಾ ಅವಧಿ ಮೀರಿದೆ. ಹೊಸ ಸ್ಕ್ಯಾನ್ ರನ್ ಮಾಡಿ.'
            : 'This link is invalid or expired. Run a new scan to continue.'}
        </p>
        <Link
          to="/scan"
          className="mt-5 inline-flex rounded-full bg-forest px-5 py-2.5 text-sm font-bold text-white"
        >
          {kn ? 'ಸ್ಕ್ಯಾನ್‌ಗೆ ಹಿಂತಿರುಗಿ' : 'Back to Scan'}
        </Link>
      </div>
    )
  }

  if (gate === 'loading') {
    return (
      <div className="space-y-4" aria-busy="true" aria-live="polite">
        <div className="flex items-center gap-2 text-sm text-ink/55">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('common.loading')}
        </div>
        <div className="h-28 animate-pulse rounded-2xl bg-mist" />
        <div className="grid gap-4 md:grid-cols-3">
          <div className="h-24 animate-pulse rounded-2xl bg-mist" />
          <div className="h-24 animate-pulse rounded-2xl bg-mist" />
          <div className="h-24 animate-pulse rounded-2xl bg-mist" />
        </div>
        <div className="h-64 animate-pulse rounded-2xl bg-mist" />
      </div>
    )
  }

  if (gate === 'error') {
    return (
      <div className="glass mx-auto max-w-lg rounded-2xl p-8 text-center">
        <AlertCircle className="mx-auto h-8 w-8 text-danger" />
        <h1 className="mt-3 font-display text-xl font-bold text-forest">
          {kn ? 'ಲೋಡ್ ಆಗಲಿಲ್ಲ' : 'Could not load this scan'}
        </h1>
        <p className="mt-2 text-sm text-ink/65">
          {kn
            ? 'ಸರ್ವರ್ ತಲುಪಲಿಲ್ಲ. ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ, ಅಥವಾ ಹೊಸ ಸ್ಕ್ಯಾನ್ ರನ್ ಮಾಡಿ.'
            : 'The server could not be reached. Retry, or run a new scan.'}
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-3">
          <button
            type="button"
            onClick={() => setRetryKey((n) => n + 1)}
            className="rounded-full bg-forest px-5 py-2.5 text-sm font-bold text-white"
          >
            {kn ? 'ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ' : 'Retry'}
          </button>
          <Link
            to="/scan"
            className="rounded-full border border-forest/20 bg-white px-5 py-2.5 text-sm font-semibold text-forest"
          >
            {kn ? 'ಸ್ಕ್ಯಾನ್‌ಗೆ ಹಿಂತಿರುಗಿ' : 'Back to Scan'}
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {!persisted && (
        <p
          className="rounded-xl border border-gold/40 bg-gold/20 px-4 py-2 text-xs font-semibold text-ink"
          role="status"
        >
          {kn ? 'ಉಳಿಸಲಾಗಿಲ್ಲ — ಆಫ್‌ಲೈನ್ ಕೆಲಸ' : 'Not saved - working offline'}
        </p>
      )}
      {children}
    </div>
  )
}
