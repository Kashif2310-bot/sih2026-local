import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { listApplications } from '../../platform/store'
import { MINISTRIES } from '../../platform/ministries'
import { listOpenApprovalViews, peekApprovalCase } from '../../platform/approvalBridge'
import { isPendingStatus } from '../auditHelpers'

export function AdminDashboardPage() {
  const { t, i18n } = useTranslation()
  const kn = i18n.language === 'kn'
  const apps = listApplications()
  const cases = listOpenApprovalViews()

  const total = apps.length
  const pending = apps.filter((a) => isPendingStatus(a.status)).length
  const approved = apps.filter((a) => a.status === 'approved' || a.status === 'disbursed').length
  const collecting = cases.filter((c) => c.status === 'open' || c.status === 'collecting').length
  const quorumMet = cases.filter((c) => c.quorumMet && !c.disbursementAuthorized).length
  const authorized = cases.filter((c) => c.disbursementAuthorized).length

  const map = new Map<string, number>()
  for (const a of apps) {
    map.set(a.leadMinistryId, (map.get(a.leadMinistryId) ?? 0) + 1)
  }
  const byMinistry = Array.from(map.entries()).sort((a, b) => b[1] - a[1])
  const maxMinistry = Math.max(1, ...byMinistry.map(([, count]) => count))

  const recent = apps.slice(0, 5)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold text-forest">{t('admin.dashboard.title')}</h1>
        <p className="mt-2 text-sm text-ink/65">{t('admin.dashboard.subtitle')}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label={t('admin.dashboard.totalApplications')} value={total} />
        <Stat label={t('admin.dashboard.pendingReview')} value={pending} />
        <Stat label={t('admin.dashboard.approved')} value={approved} />
      </div>

      <section className="rounded-2xl border border-forest/10 bg-white p-5">
        <h2 className="text-sm font-bold text-forest">{t('admin.dashboard.approvalPipeline')}</h2>
        <p className="mt-1 text-xs text-ink/50">{t('admin.dashboard.sessionNote')}</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-4">
          <Stat label={t('admin.dashboard.casesOpen')} value={cases.length} compact />
          <Stat label={t('admin.dashboard.collecting')} value={collecting} compact />
          <Stat label={t('admin.dashboard.quorumMet')} value={quorumMet} compact />
          <Stat label={t('admin.dashboard.authorized')} value={authorized} compact />
        </div>
      </section>

      <section className="rounded-2xl border border-forest/10 bg-white p-5">
        <h2 className="text-sm font-bold text-forest">{t('admin.dashboard.byMinistry')}</h2>
        <ul className="mt-3 space-y-3">
          {byMinistry.map(([id, count]) => (
            <li key={id} className="text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-ink/80">
                  {kn ? MINISTRIES[id as keyof typeof MINISTRIES].nameKn : MINISTRIES[id as keyof typeof MINISTRIES].name}
                </span>
                <span className="font-semibold text-forest">{count}</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-mist">
                <div
                  className="h-full rounded-full bg-forest"
                  style={{ width: `${(count / maxMinistry) * 100}%` }}
                />
              </div>
            </li>
          ))}
          {byMinistry.length === 0 && <li className="text-sm text-ink/45">{t('admin.applications.empty')}</li>}
        </ul>
      </section>

      <section className="rounded-2xl border border-forest/10 bg-white p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-bold text-forest">{t('admin.dashboard.recent')}</h2>
          <Link to="/admin/applications" className="text-sm font-semibold text-forest hover:underline">
            {t('admin.dashboard.viewAll')}
          </Link>
        </div>
        <ul className="mt-3 divide-y divide-forest/10">
          {recent.map((a) => {
            const approval = peekApprovalCase(a.id)
            return (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                <div>
                  <p className="font-semibold text-ink">{a.applicant.name}</p>
                  <p className="text-xs text-ink/50">{a.id}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="rounded-full bg-mist px-2 py-0.5 text-xs font-medium">
                    {t(`admin.status.${a.status}`)}
                  </span>
                  {approval && (
                    <span className="rounded-full border border-forest/20 px-2 py-0.5 text-xs text-forest">
                      {approval.validSignatures}/{approval.quorum.required}
                    </span>
                  )}
                  <Link
                    to={`/admin/applications/${a.id}`}
                    className="font-semibold text-forest hover:underline"
                  >
                    {t('admin.applications.view')}
                  </Link>
                </div>
              </li>
            )
          })}
          {recent.length === 0 && <li className="py-3 text-sm text-ink/45">{t('admin.applications.empty')}</li>}
        </ul>
      </section>
    </div>
  )
}

function Stat({ label, value, compact }: { label: string; value: number; compact?: boolean }) {
  return (
    <div className="rounded-2xl border border-forest/10 bg-white p-4">
      <p className="text-xs font-medium text-ink/50">{label}</p>
      <p className={`mt-1 font-display font-bold text-forest ${compact ? 'text-2xl' : 'text-3xl'}`}>{value}</p>
    </div>
  )
}
