import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, FileDown, Lock, Shield, Sparkles } from 'lucide-react'
import { useApp } from '../state/useApp'
import { formatINR } from '../lib/finance'
import { IncompleteSignalsBanner } from '../components/IncompleteSignalsBanner'
import { canSanction, sanctionBlockReason } from '../lib/sanctionGate'

export function SanctionPage() {
  const { t, i18n } = useTranslation()
  const kn = i18n.language === 'kn'
  const { profile, plan, score, approvalCase, escrowReleased, signAs, releaseEscrow, assessmentId, dataStatus } =
    useApp()
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  if (!profile || !plan || !score || !approvalCase) return null

  const { quorum, allocation, audit, disbursement } = approvalCase
  const blocked = !canSanction(dataStatus)
  const blockReason = blocked ? t('sanction.incompleteBlock') : null
  const englishBlock = blocked ? sanctionBlockReason(dataStatus) : null

  const onSign = async (id: string) => {
    setBusy(id)
    setErr(null)
    try {
      await signAs(id)
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('sanction.signFailed'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold text-forest">{t('sanction.title')}</h1>
        <p className="mt-2 max-w-2xl text-sm text-ink/65">{t('sanction.subtitle')}</p>
        <p className="mt-3 inline-block rounded-full border border-gold/40 bg-gold/20 px-3 py-1 text-xs font-semibold text-ink">
          {t('sanction.fixtureIdentities')}
        </p>
      </div>

      <IncompleteSignalsBanner />

      {blocked && (
        <p className="rounded-2xl border border-danger/30 bg-[#ffece8] px-4 py-3 text-sm font-semibold text-danger" role="alert">
          {blockReason}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="glass rounded-2xl p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-forest">
            <Shield className="h-4 w-4" /> {t('sanction.hash')}
          </div>
          <p className="mt-3 break-all rounded-xl bg-ink px-3 py-3 font-mono text-xs text-gold">
            {approvalCase.applicationHash}
          </p>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-ink/45">{kn ? 'ಉದ್ಯಮಿ' : 'Entrepreneur'}</dt>
              <dd className="font-medium">{profile.name}</dd>
            </div>
            <div>
              <dt className="text-ink/45">LokScore</dt>
              <dd className="font-medium">
                {score.total} / {score.grade}
                {dataStatus === 'incomplete' ? (
                  <span className="ml-2 text-[10px] font-bold uppercase tracking-wide text-clay">
                    {t('sanction.provisional')}
                  </span>
                ) : null}
              </dd>
            </div>
            <div>
              <dt className="text-ink/45">{kn ? 'ಸಾಲ' : 'Loan'}</dt>
              <dd className="font-medium">{formatINR(plan.loanAmount)}</dd>
            </div>
            <div>
              <dt className="text-ink/45">{kn ? 'ಕೋರಂ' : 'Quorum'}</dt>
              <dd className="font-medium">
                {approvalCase.signaturesCollected}/{quorum.required} of {quorum.pool}
              </dd>
            </div>
            <div className="col-span-2">
              <dt className="text-ink/45">{t('sanction.applicationId')}</dt>
              <dd className="break-all font-mono text-xs">{approvalCase.applicationId}</dd>
            </div>
          </dl>
          {quorum.mentorRequired && (
            <p className="mt-4 rounded-xl bg-[#fff7e8] px-3 py-2 text-sm text-clay">
              {t('sanction.mentorRule')}
            </p>
          )}
        </div>

        <div className="glass rounded-2xl p-5">
          <h2 className="font-semibold text-forest">
            {kn ? 'ಅಡಾಪ್ಟಿವ್ ಕೋರಂ ನಿಯಮ' : 'Adaptive quorum rule'}
          </h2>
          <ul className="mt-3 space-y-2 text-sm text-ink/75">
            <li className={score.total >= 80 ? 'font-bold text-forest' : ''}>
              ≥ 80 → 2 of 3 SCA officers
            </li>
            <li className={score.total >= 60 && score.total < 80 ? 'font-bold text-forest' : ''}>
              60–79 → 3 of 5 verifiers
            </li>
            <li className={score.total < 60 ? 'font-bold text-forest' : ''}>
              &lt; 60 → 4 of 5 + mentor role
            </li>
          </ul>
          <p className="mt-4 text-xs text-ink/50">{t('sanction.cryptoNote')}</p>
          <p className="mt-2 text-xs text-ink/50">{t('sanction.prototypePool')}</p>
        </div>
      </div>

      <p className="rounded-xl border border-gold/30 bg-[#fff7e8] px-4 py-2 text-xs font-semibold text-ink">
        {t('sanction.fixtureIdentities')}
      </p>

      <div>
        <h2 className="mb-3 font-semibold text-forest">{t('sanction.allocatedSet')}</h2>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {allocation.reviewers.map((r) => (
            <div key={r.reviewerId} className="glass rounded-2xl p-4">
              <p className="font-semibold text-ink">{kn ? r.displayNameKn : r.displayName}</p>
              <p className="text-xs text-ink/50">{kn ? r.departmentKn : r.department}</p>
              <p className="text-[10px] uppercase tracking-wide text-ink/40">{r.role}</p>
              <p className="mt-2 truncate font-mono text-[10px] text-ink/40">{r.address}</p>
              {r.hasSigned ? (
                <div className="mt-3 space-y-2">
                  <p className="inline-flex items-center gap-1 text-sm font-semibold text-leaf">
                    <CheckCircle2 className="h-4 w-4" /> {t('sanction.signed')}
                  </p>
                  <p className="break-all font-mono text-[10px] text-ink/45">{r.signaturePreview}</p>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={!!busy || blocked}
                  onClick={() => void onSign(r.reviewerId)}
                  title={englishBlock ?? undefined}
                  aria-label={`${t('sanction.sign')} — ${kn ? r.displayNameKn : r.displayName}`}
                  className="mt-3 rounded-full bg-forest px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                >
                  {busy === r.reviewerId ? '…' : blocked ? t('sanction.incompleteBlock') : t('sanction.sign')}
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {err && <p className="text-sm text-danger">{err}</p>}

      <div className="glass rounded-2xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-xl font-bold text-forest">
              {kn ? 'ಸಿಮ್ಯುಲೇಟೆಡ್ ಎಸ್ಕ್ರೋ ಸ್ಕೆಚ್' : 'Simulated escrow sketch'}
            </h2>
            <p className="text-sm text-ink/60">{t('sanction.escrowSketch')}</p>
          </div>
          {approvalCase.quorumMet ? (
            <button
              type="button"
              onClick={releaseEscrow}
              disabled={escrowReleased}
              className="inline-flex items-center gap-2 rounded-full bg-gold px-5 py-3 text-sm font-bold text-ink disabled:opacity-60"
            >
              <Sparkles className="h-4 w-4" />
              {escrowReleased ? t('sanction.released') : t('sanction.release')}
            </button>
          ) : (
            <span className="inline-flex items-center gap-2 rounded-full bg-mist px-4 py-2 text-sm font-semibold text-ink/60">
              <Lock className="h-4 w-4" /> {t('sanction.locked')}
            </span>
          )}
        </div>

        {escrowReleased && (
          <div className="mt-4 rounded-xl border border-leaf/30 bg-[#e8f6ee] p-4 text-sm text-forest">
            <p className="font-bold">{t('sanction.simulatedRelease')}</p>
            <p className="mt-1">
              {formatINR(plan.loanAmount)} → {profile.name} · attestation{' '}
              {approvalCase.applicationHash.slice(0, 18)}…
            </p>
            {disbursement && (
              <p className="mt-2 break-all font-mono text-[10px] text-ink/60">
                {t('sanction.authDigest')}: {disbursement.authorizationDigest}
              </p>
            )}
            <p className="mt-2 text-xs">{t('sanction.escrowSketch')}</p>
          </div>
        )}
      </div>

      <div className="glass rounded-2xl p-5">
        <h2 className="font-semibold text-forest">{t('sanction.auditTrail')}</h2>
        <ol className="mt-3 max-h-56 space-y-2 overflow-auto text-xs text-ink/70">
          {audit.map((e) => (
            <li key={e.eventId} className="rounded-lg bg-mist/60 px-3 py-2 font-mono">
              <span className="font-semibold text-forest">{e.eventType}</span>
              {e.actorRef ? ` · ${e.actorRef}` : ''}
              <div className="truncate text-ink/45">{e.eventHash}</div>
            </li>
          ))}
        </ol>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <Link
          to={`/export/${assessmentId}`}
          className="inline-flex items-center gap-2 rounded-full border border-forest/20 bg-white px-4 py-2 text-sm font-semibold text-forest"
        >
          <FileDown className="h-4 w-4" /> {t('nav.export')}
        </Link>
        <Link to="/" className="text-sm font-semibold text-forest underline-offset-2 hover:underline">
          {kn ? '← ಮುಖಪುಟಕ್ಕೆ' : '← Back to home'}
        </Link>
      </div>
    </div>
  )
}
