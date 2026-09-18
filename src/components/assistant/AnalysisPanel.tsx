import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  Briefcase,
  ClipboardCheck,
  FileText,
  GitCompare,
  Globe,
  HelpCircle,
  ListChecks,
  Scale,
  ShieldCheck,
  User,
  Wallet,
  X,
} from 'lucide-react'
import type { PersonalizedReport } from '../../assistant/conversation/reportModel'
import type { ApplicantProfile } from '../../shared/applicantProfile'
import type { UserProfile } from '../../assistant/types'
import { saveHandoff } from '../../apply/store'
import { buildStartApplicationFromAnalysis } from './applicationHandoffBridge'
import { buildAnalysisPanelView } from './analysisPanelView'

/**
 * Renders the SAME PersonalizedReport the assistant already builds every
 * turn (src/assistant/conversation/report.ts) — never a second analysis
 * model. "Start application" wires projectReportForApplicationStart /
 * projectDocumentsForApplication into the EXISTING saveHandoff + /apply
 * flow, exactly like SchemeDetailModal's own button.
 */
export function AnalysisPanel({
  report,
  applicantProfile,
  profile,
  onClose,
}: {
  report: PersonalizedReport | null
  applicantProfile: ApplicantProfile
  profile: UserProfile
  onClose: () => void
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()

  useEffect(() => {
    if (!report) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [report, onClose])

  if (!report) return null
  const topScheme = report.relevantSchemes[0]
  const view = buildAnalysisPanelView(report)

  const onStart = () => {
    const result = buildStartApplicationFromAnalysis(report, applicantProfile, profile)
    if (!result) return
    saveHandoff(result.handoff)
    onClose()
    navigate(`/apply/start/${result.schemeId}`)
  }

  const rupees = (n: number) => `₹${n.toLocaleString('en-IN')}`

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t('assistant.analysis.title')}
      onClick={onClose}
    >
      <div
        className="glass max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-t-[1.5rem] p-6 shadow-lg sm:rounded-[1.5rem]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-display text-xl font-bold text-forest">{t('assistant.analysis.title')}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('assistant.analysis.close')}
            className="shrink-0 rounded-full p-1.5 text-ink/50 hover:bg-mist hover:text-ink"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <Section title={t('assistant.analysis.readiness')} icon={ShieldCheck}>
          <p className="text-sm font-semibold text-ink/80">
            {t(`assistant.analysis.readinessStatus.${view.readiness}`)}
          </p>
          {view.financingIntention !== 'undetermined' && (
            <p className="mt-1 text-sm text-ink/70">
              {t('assistant.analysis.financingIntention')}: {view.financingIntention}
            </p>
          )}
          {view.strengths.length > 0 && (
            <>
              <p className="mt-3 text-xs font-bold uppercase tracking-wide text-ink/50">{t('assistant.analysis.strengths')}</p>
              <ul className="mt-1 space-y-1 text-sm text-forest">
                {view.strengths.map((s) => (
                  <li key={s}>✓ {s}</li>
                ))}
              </ul>
            </>
          )}
          {view.blockers.length > 0 && (
            <>
              <p className="mt-3 text-xs font-bold uppercase tracking-wide text-ink/50">{t('assistant.analysis.blockers')}</p>
              <ul className="mt-1 space-y-1 text-sm text-clay">
                {view.blockers.map((s) => (
                  <li key={s}>! {s}</li>
                ))}
              </ul>
            </>
          )}
        </Section>

        {view.snapshot.length > 0 && (
          <Section title={t('assistant.analysis.citizenSnapshot')} icon={User}>
            <dl className="space-y-1.5 text-sm">
              {view.snapshot.map((row) => (
                <div key={row.field} className="flex items-baseline justify-between gap-3">
                  <dt className="text-ink/50">{t(`assistant.field.${row.field}`, row.field)}</dt>
                  <dd className="truncate text-right font-medium text-ink/85" title={row.value}>
                    {row.value}
                  </dd>
                </div>
              ))}
            </dl>
          </Section>
        )}

        {view.business && (
          <Section title={t('assistant.analysis.businessContext')} icon={Briefcase}>
            <dl className="space-y-1.5 text-sm text-ink/80">
              {view.business.sector && (
                <div className="flex justify-between gap-3">
                  <dt className="text-ink/50">{t('assistant.field.businessSector')}</dt>
                  <dd className="font-medium">{view.business.sector}</dd>
                </div>
              )}
              {view.business.idea && view.business.idea !== view.business.sector && (
                <div className="flex justify-between gap-3">
                  <dt className="text-ink/50">{t('assistant.field.businessDescription')}</dt>
                  <dd className="text-right">{view.business.idea}</dd>
                </div>
              )}
              {view.business.stage && (
                <div className="flex justify-between gap-3">
                  <dt className="text-ink/50">{t('assistant.field.businessStage')}</dt>
                  <dd className="font-medium">{view.business.stage.replace(/_/g, ' ')}</dd>
                </div>
              )}
              {view.business.status && (
                <div className="flex justify-between gap-3">
                  <dt className="text-ink/50">{t('assistant.field.businessStatus')}</dt>
                  <dd className="font-medium">{view.business.status}</dd>
                </div>
              )}
              {view.business.location && (
                <div className="flex justify-between gap-3">
                  <dt className="text-ink/50">{t('assistant.analysis.location')}</dt>
                  <dd className="text-right font-medium">{view.business.location}</dd>
                </div>
              )}
            </dl>
          </Section>
        )}

        {view.opportunity && (
          <Section title={t('assistant.analysis.opportunity')} icon={Scale}>
            <p className="text-sm font-semibold text-ink/80">
              {t(`assistant.analysis.suitabilityKind.${view.opportunity.suitabilityKind}`)}
            </p>
            {view.opportunity.rationale && (
              <p className="mt-1 text-sm text-ink/70">{view.opportunity.rationale}</p>
            )}
            {view.opportunity.dimensions.length > 0 && (
              <ul className="mt-2 space-y-1 text-xs text-ink/60">
                {view.opportunity.dimensions.map((d) => (
                  <li key={d.id} className="flex justify-between gap-3">
                    <span>{t(`assistant.analysis.dimension.${d.id}`)}</span>
                    <span className="font-semibold">{t(`assistant.analysis.dimensionStatus.${d.status}`)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        )}

        <Section title={t('assistant.analysis.financialPath')} icon={Wallet}>
          <p className="text-sm font-semibold text-ink/80">
            {t(`assistant.analysis.financialStatus.${view.financial.status}`)}
          </p>
          <dl className="mt-2 space-y-1 text-sm text-ink/75">
            {view.financial.statedInvestmentRequired !== undefined && (
              <div className="flex justify-between gap-3">
                <dt>{t('assistant.field.investmentRequired')}</dt>
                <dd className="font-medium">{rupees(view.financial.statedInvestmentRequired)}</dd>
              </div>
            )}
            {view.financial.statedFinancingRequired !== undefined && (
              <div className="flex justify-between gap-3">
                <dt>{t('assistant.field.financingRequired')}</dt>
                <dd className="font-medium">{rupees(view.financial.statedFinancingRequired)}</dd>
              </div>
            )}
            {view.financial.statedOwnContribution !== undefined && (
              <div className="flex justify-between gap-3">
                <dt>{t('assistant.field.ownContribution')}</dt>
                <dd className="font-medium">{rupees(view.financial.statedOwnContribution)}</dd>
              </div>
            )}
          </dl>
          {view.financial.nsfdcPlan ? (
            <div className="mt-3 rounded-xl bg-mist/60 p-3 text-sm">
              <p className="font-semibold text-forest">{view.financial.nsfdcPlan.schemeName}</p>
              <p className="mt-1 text-ink/75">
                {t('assistant.analysis.loanAmount')}: {rupees(view.financial.nsfdcPlan.loanAmount)}
              </p>
              <p className="text-ink/75">
                {t('assistant.analysis.projectCost')}: {rupees(view.financial.nsfdcPlan.projectCost)}
              </p>
              <p className="mt-2 text-[11px] text-ink/45">{t('assistant.analysis.nsfdcPlanNote')}</p>
            </div>
          ) : (
            <p className="mt-2 text-xs text-ink/50">{t('assistant.analysis.financialNotDetermined')}</p>
          )}
          {view.financial.notes.map((n) => (
            <p key={n} className="mt-1 text-xs text-ink/55">
              {n}
            </p>
          ))}
        </Section>

        {view.documents.length > 0 && (
          <Section title={t('assistant.analysis.documentReadiness')} icon={FileText}>
            <ul className="space-y-1.5 text-sm text-ink/80">
              {view.documents.map((d) => (
                <li key={`${d.schemeId ?? 'any'}-${d.documentName}`} className="flex justify-between gap-3">
                  <span>{d.documentName}</span>
                  <span className="shrink-0 text-xs font-semibold text-ink/50">
                    {t(`assistant.analysis.documentState.${d.verificationState}`)}
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        <Section title={t('assistant.analysis.applicationReadiness')} icon={ClipboardCheck}>
          <p className="text-sm font-semibold text-ink/80">
            {t(`assistant.analysis.applicationReadinessStatus.${view.applicationReadiness.status}`)}
          </p>
          {view.applicationReadiness.status === 'ready_for_application' && (
            <p className="mt-1 text-xs text-clay">{t('assistant.analysis.applicationNotSubmitted')}</p>
          )}
          {view.applicationReadiness.unmet.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs text-ink/60">
              {view.applicationReadiness.unmet.slice(0, 4).map((d) => (
                <li key={d.id}>• {d.detail}</li>
              ))}
            </ul>
          )}
        </Section>

        <Section title={t('assistant.analysis.sourceCoverageTitle')} icon={Globe}>
          <dl className="grid grid-cols-2 gap-3 text-sm text-ink/75 sm:grid-cols-4">
            <div>
              <dt className="text-[11px] text-ink/45">{t('assistant.analysis.sourcesQueried')}</dt>
              <dd className="font-semibold">{report.sourceCoverage.sourcesQueried.length}</dd>
            </div>
            <div>
              <dt className="text-[11px] text-ink/45">{t('assistant.analysis.sourcesRetrieved')}</dt>
              <dd className="font-semibold">{report.sourceCoverage.sourcesSuccessfullyRetrieved.length}</dd>
            </div>
            <div>
              <dt className="text-[11px] text-ink/45">{t('assistant.analysis.sourcesUnavailable')}</dt>
              <dd className="font-semibold">{report.sourceCoverage.sourcesUnavailable.length}</dd>
            </div>
            <div>
              <dt className="text-[11px] text-ink/45">{t('assistant.analysis.contextualEvidenceCount')}</dt>
              <dd className="font-semibold">{report.sourceCoverage.contextualEvidenceCount}</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs font-medium text-clay">{t('assistant.analysis.neverAllChecked')}</p>
        </Section>

        <Section title={t('assistant.analysis.contextualEvidenceTitle')} icon={AlertTriangle}>
          {report.governmentContextualEvidence.length === 0 ? (
            <p className="text-sm text-ink/50">{t('assistant.analysis.noContextualEvidence')}</p>
          ) : (
            <ul className="space-y-2">
              {report.governmentContextualEvidence.map((c) => (
                <li key={`${c.sourceUrl}-${c.retrievedAt}`} className="rounded-xl bg-[#fff7e8] p-3 text-sm">
                  <p className="text-ink/80">{c.summary}</p>
                  <p className="mt-1 text-[11px] text-ink/50">
                    {c.sourceName} · {c.reason}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {topScheme && (
          <Section title={t('assistant.analysis.topMatch')} icon={ListChecks}>
            <p className="text-sm font-semibold text-forest">{topScheme.schemeName}</p>
            <p className="mt-1 text-sm text-ink/75">{topScheme.matchExplanation}</p>
          </Section>
        )}

        {view.comparative.length > 0 && (
          <Section title={t('assistant.analysis.comparative')} icon={GitCompare}>
            <ul className="space-y-2 text-sm">
              {view.comparative.map((c) => (
                <li key={c.schemeId} className="flex items-baseline justify-between gap-3">
                  <span className="text-ink/80">{c.schemeName}</span>
                  <span className="shrink-0 text-xs font-semibold text-ink/50">
                    {t(`assistant.analysis.fit.${c.fit}`)}
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        <Section title={t('assistant.analysis.uncertainties')} icon={HelpCircle}>
          {view.uncertainties.length === 0 ? (
            <p className="text-sm text-ink/50">{t('assistant.analysis.noUncertainties')}</p>
          ) : (
            <ul className="space-y-1.5 text-sm text-ink/75">
              {view.uncertainties.map((u) => (
                <li key={`${u.kind}-${u.message}`}>• {u.message}</li>
              ))}
            </ul>
          )}
        </Section>

        {view.nextStepCount > 0 && (
          <p className="mt-4 text-xs text-ink/45">{t('assistant.analysis.nextStepsPointer')}</p>
        )}

        <div className="mt-5 border-t border-forest/10 pt-4">
          {topScheme ? (
            <button
              type="button"
              onClick={onStart}
              className="inline-flex items-center gap-1.5 rounded-full bg-forest px-4 py-2 text-sm font-bold text-white hover:bg-leaf"
            >
              {t('assistant.analysis.startFromAnalysis')}
            </button>
          ) : (
            <p className="text-sm text-ink/50">{t('assistant.analysis.noCandidateYet')}</p>
          )}
        </div>
      </div>
    </div>
  )
}

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string
  icon?: typeof ShieldCheck
  children: React.ReactNode
}) {
  return (
    <div className="mt-5 border-t border-forest/10 pt-4 first:mt-4 first:border-0 first:pt-0">
      <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-ink/50">
        {Icon && <Icon className="h-3.5 w-3.5" />}
        {title}
      </h3>
      <div className="mt-2">{children}</div>
    </div>
  )
}
