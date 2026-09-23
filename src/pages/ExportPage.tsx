import { useApp } from '../state/useApp'
import { useTranslation } from 'react-i18next'
import { Printer } from 'lucide-react'
import { buildFeasibility } from '../lib/feasibility'
import { formatINR } from '../lib/finance'
import { getDocumentChecklist } from '../lib/documentChecklist'
import { BUSINESS_META } from '../data/villages'
import { MORATORIUM_POLICY_LABEL } from '../lib/config'

export function ExportPage() {
  const { t, i18n } = useTranslation()
  const kn = i18n.language === 'kn'
  const { profile, location, weather, mandi, score, plan, workingCapital } = useApp()

  if (!profile || !weather || !score || !location || !plan) return null

  const report = buildFeasibility({
    profile,
    location,
    weather,
    mandi,
    plan,
    lang: kn ? 'kn' : 'en',
  })
  const checklist = getDocumentChecklist(plan.schemeId)
  const generatedAt = new Date().toLocaleString(kn ? 'kn-IN' : 'en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
  const rejected = plan.schemeId === 'under_margin' || plan.schemeId === 'over_limit'

  return (
    <div className="mx-auto max-w-3xl space-y-6 print:max-w-none print:space-y-4">
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink/60">{t('exportPage.hint')}</p>
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-2 rounded-full bg-forest px-5 py-3 text-sm font-bold text-white"
        >
          <Printer className="h-4 w-4" /> {t('exportPage.print')}
        </button>
      </div>

      <div className="glass rounded-2xl p-6 print:border-0 print:bg-white print:p-0 print:shadow-none">
        <header className="border-b border-forest/10 pb-4">
          <h1 className="font-display text-2xl font-bold text-forest">{t('exportPage.title')}</h1>
          <p className="mt-1 text-xs text-ink/55">
            {t('exportPage.generatedAt')}: {generatedAt}
          </p>
          <p className="mt-1 text-xs font-semibold text-clay">{t('exportPage.disclaimer')}</p>
        </header>

        <Section title={t('exportPage.applicant')}>
          <Grid>
            <Field label={t('wizard.name')} value={profile.name} />
            <Field label={t('wizard.category')} value={kn ? BUSINESS_META[profile.category].labelKn : BUSINESS_META[profile.category].label} />
            <Field label={t('wizard.gender')} value={t(`wizard.${profile.gender}`)} />
            <Field label={t('wizard.community')} value={t(`wizard.${profile.community}`)} />
            <Field label={t('wizard.income')} value={formatINR(profile.annualIncome)} />
            <Field label={t('wizard.experience')} value={String(profile.experienceYears)} />
          </Grid>
        </Section>

        <Section title={t('exportPage.location')}>
          <Grid>
            <Field label={t('exportPage.place')} value={kn ? location.nameKn : location.name} />
            <Field label={t('exportPage.district')} value={kn ? location.districtKn : location.district} />
            <Field label={t('report.radiusLabel')} value={`${location.radiusKm} km`} />
            <Field label={t('exportPage.coordinates')} value={`${location.lat.toFixed(4)}, ${location.lng.toFixed(4)}`} />
          </Grid>
          <p className="mt-2 text-xs italic text-ink/55">
            {t('exportPage.provenance')}: {kn ? location.provenanceLabelKn : location.provenanceLabelEn}
          </p>
        </Section>

        <Section title={t('report.title')}>
          <Grid>
            <Field
              label={t('exportPage.reach')}
              value={report.reach != null ? report.reach.toLocaleString('en-IN') : t('report.reachUnavailable')}
            />
            <Field label={t('report.competitors')} value={report.saturationLabel} />
          </Grid>
          <SwotList title={t('report.swot')} s={report.strengths} w={report.weaknesses} o={report.opportunities} t={report.threats} kn={kn} />
          <p className="mt-3 text-sm">
            <span className="font-semibold">{t('report.pricing')}:</span> {report.pricing.unit} — {t('exportPage.floor')} ₹
            {report.pricing.low} · {t('exportPage.optimal')} ₹{report.pricing.optimal} · {t('exportPage.premium')} ₹
            {report.pricing.premium}
          </p>
        </Section>

        <Section title={t('finance.title')}>
          {rejected ? (
            <p className="text-sm text-danger">{kn ? plan.schemeNameKn : plan.schemeName}</p>
          ) : (
            <>
              <Grid>
                <Field label={t('finance.project')} value={formatINR(plan.projectCost)} />
                <Field label={t('finance.loan')} value={formatINR(plan.loanAmount)} />
                <Field label={t('finance.scheme')} value={kn ? plan.schemeNameKn : plan.schemeName} />
                <Field label={t('finance.emi')} value={formatINR(plan.quarterlyEmi)} />
                <Field
                  label={kn ? 'ಬಡ್ಡಿ' : 'Interest'}
                  value={kn ? `ವಾರ್ಷಿಕ ${plan.interestRate}%` : `${plan.interestRate}% p.a.`}
                />
                <Field
                  label={kn ? 'ಅವಧಿ' : 'Tenure'}
                  value={kn ? `${plan.tenureYears} ವರ್ಷ` : `${plan.tenureYears} yrs`}
                />
              </Grid>
              <p className="mt-2 text-xs text-ink/55">{kn ? MORATORIUM_POLICY_LABEL.kn : MORATORIUM_POLICY_LABEL.en}</p>

              {workingCapital && (
                <div className="mt-4 rounded-xl bg-mist/60 p-3">
                  <p className="text-sm font-semibold text-forest">{t('finance.wcTitle')}</p>
                  <Grid>
                    <Field label={t('finance.wcMonthly')} value={formatINR(workingCapital.monthlyOpex)} />
                    <Field label={t('finance.wcTotal')} value={formatINR(workingCapital.workingCapital)} />
                    <Field label={t('finance.wcRaw')} value={formatINR(workingCapital.lineItems.rawMaterial)} />
                    <Field label={t('finance.wcLabour')} value={formatINR(workingCapital.lineItems.labour)} />
                    <Field label={t('finance.wcUtilities')} value={formatINR(workingCapital.lineItems.utilities)} />
                    <Field label={t('finance.wcTransport')} value={formatINR(workingCapital.lineItems.transportRent)} />
                  </Grid>
                </div>
              )}

              <table className="mt-4 w-full border-collapse text-xs">
                <thead>
                  <tr className="border-b border-forest/20 text-left uppercase text-ink/50">
                    <th className="py-1 pr-2">Q</th>
                    <th className="py-1 pr-2">{kn ? 'ದಿನಾಂಕ' : 'Due'}</th>
                    <th className="py-1 pr-2">{kn ? 'ಮೂಲ' : 'Principal'}</th>
                    <th className="py-1 pr-2">{kn ? 'ಬಡ್ಡಿ' : 'Interest'}</th>
                    <th className="py-1 pr-2">{kn ? 'ಒಟ್ಟು' : 'Total'}</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.schedule.map((row) => (
                    <tr key={row.quarter} className="border-b border-forest/5">
                      <td className="py-1 pr-2">{row.quarter}</td>
                      <td className="py-1 pr-2">{row.dueDateLabel}</td>
                      <td className="py-1 pr-2">{formatINR(row.principal)}</td>
                      <td className="py-1 pr-2">{formatINR(row.interest)}</td>
                      <td className="py-1 pr-2 font-medium">{formatINR(row.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-1 text-xs font-medium text-forest">
                {t('finance.closesAtZero')} ({plan.closingPrincipalPaise} paise)
              </p>
            </>
          )}
        </Section>

        <Section title={t('pulse.breakdown')}>
          <Grid>
            <Field label={kn ? 'ಬೇಡಿಕೆ' : 'Demand'} value={`${score.demand}/100`} />
            <Field label={kn ? 'ಸ್ಪರ್ಧಾ ಅಂತರ' : 'Comp. gap'} value={`${score.competitionGap}/100`} />
            <Field label={kn ? 'ಹವಾಮಾನ' : 'Weather'} value={`${score.weatherFit}/100`} />
            <Field label={kn ? 'ಹಣಕಾಸು' : 'Finance'} value={`${score.financialFit}/100`} />
            <Field label={kn ? 'ಅರ್ಹತೆ' : 'Eligibility'} value={`${score.eligibility}/100`} />
            <Field label="LokScore" value={`${score.total} / ${score.grade}`} />
          </Grid>
          <p className="mt-2 text-sm">
            {kn ? 'ಅನುಮೋದನಾ ಕೋರಂ' : 'Sanction quorum'}: {score.quorumRequired}/{score.quorumPool}
            {score.mentorRequired ? (kn ? ' + ಮಾರ್ಗದರ್ಶಕ ಕಡ್ಡಾಯ' : ' + mentor required') : ''}
          </p>
        </Section>

        {!rejected && (
          <Section title={t('exportPage.checklist')}>
            <p className="text-xs italic text-ink/55">{t('exportPage.checklistNote')}</p>
            <ul className="mt-2 space-y-1 text-sm">
              {checklist.map((item) => (
                <li key={item.en} className="flex items-start gap-2">
                  <span aria-hidden>☐</span> <span>{kn ? item.kn : item.en}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        <footer className="mt-6 border-t border-forest/10 pt-3 text-xs text-ink/45">
          {t('exportPage.footer')}
        </footer>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5 break-inside-avoid">
      <h2 className="font-display text-lg font-bold text-forest">{title}</h2>
      <div className="mt-2">{children}</div>
    </section>
  )
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">{children}</div>
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-ink/45">{label}</p>
      <p className="font-medium text-ink">{value}</p>
    </div>
  )
}

function SwotList({
  title,
  s,
  w,
  o,
  t,
  kn,
}: {
  title: string
  s: string[]
  w: string[]
  o: string[]
  t: string[]
  kn: boolean
}) {
  const cells = [
    [kn ? 'ಬಲ' : 'Strengths', s],
    [kn ? 'ದುರ್ಬಲ' : 'Weaknesses', w],
    [kn ? 'ಅವಕಾಶ' : 'Opportunities', o],
    [kn ? 'ಅಪಾಯ' : 'Threats', t],
  ] as const
  return (
    <div className="mt-2">
      <p className="text-sm font-semibold text-forest">{title}</p>
      <div className="mt-1 grid grid-cols-2 gap-2 text-xs">
        {cells.map(([label, items]) => (
          <div key={label}>
            <p className="font-semibold text-ink/60">{label}</p>
            <ul className="mt-0.5 space-y-0.5">
              {items.map((item) => (
                <li key={item}>• {item}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )
}
