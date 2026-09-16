import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { listApplications } from '../../platform/store'
import { MINISTRY_LIST, MINISTRIES, type MinistryId } from '../../platform/ministries'
import type { ApplicationStatus } from '../../platform/types'
import { formatINR } from '../../lib/finance'

const STATUSES: ApplicationStatus[] = [
  'submitted',
  'under_review',
  'reviewer_assigned',
  'approved',
  'rejected',
  'disbursed',
]

export function AdminApplicationsPage() {
  const { t, i18n } = useTranslation()
  const kn = i18n.language === 'kn'
  const apps = listApplications()
  const [ministry, setMinistry] = useState<MinistryId | 'all'>('all')
  const [status, setStatus] = useState<ApplicationStatus | 'all'>('all')

  const filtered = apps.filter((a) => {
    if (ministry !== 'all' && a.leadMinistryId !== ministry) return false
    if (status !== 'all' && a.status !== status) return false
    return true
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold text-forest">{t('admin.applications.title')}</h1>
        <p className="mt-2 text-sm text-ink/65">{t('admin.applications.subtitle')}</p>
      </div>

      <div className="flex flex-wrap gap-3">
        <label className="text-xs font-semibold text-ink/60">
          {t('admin.applications.filterMinistry')}
          <select
            className="ml-2 rounded-lg border border-forest/20 bg-white px-2 py-1.5 text-sm font-normal text-ink"
            value={ministry}
            onChange={(e) => setMinistry(e.target.value as MinistryId | 'all')}
          >
            <option value="all">{t('admin.applications.allMinistries')}</option>
            {MINISTRY_LIST.map((m) => (
              <option key={m.id} value={m.id}>
                {kn ? m.nameKn : m.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-semibold text-ink/60">
          {t('admin.applications.filterStatus')}
          <select
            className="ml-2 rounded-lg border border-forest/20 bg-white px-2 py-1.5 text-sm font-normal text-ink"
            value={status}
            onChange={(e) => setStatus(e.target.value as ApplicationStatus | 'all')}
          >
            <option value="all">{t('admin.applications.allStatuses')}</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`admin.status.${s}`)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-ink/50">{t('admin.applications.empty')}</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-forest/10 bg-white">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-forest/10 bg-mist/50 text-xs font-semibold uppercase tracking-wide text-ink/50">
              <tr>
                <th className="px-4 py-3">{t('admin.applications.columns.id')}</th>
                <th className="px-4 py-3">{t('admin.applications.columns.applicant')}</th>
                <th className="px-4 py-3">{t('admin.applications.columns.ministry')}</th>
                <th className="px-4 py-3">{t('admin.applications.columns.scheme')}</th>
                <th className="px-4 py-3">{t('admin.applications.columns.lokScore')}</th>
                <th className="px-4 py-3">{t('admin.applications.columns.status')}</th>
                <th className="px-4 py-3">{t('admin.applications.columns.submitted')}</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-forest/10">
              {filtered.map((a) => (
                <tr key={a.id} className="hover:bg-mist/30">
                  <td className="px-4 py-3 font-mono text-xs">{a.id}</td>
                  <td className="px-4 py-3 font-medium">{a.applicant.name}</td>
                  <td className="px-4 py-3 text-ink/70">
                    {kn ? MINISTRIES[a.leadMinistryId].nameKn : MINISTRIES[a.leadMinistryId].name}
                  </td>
                  <td className="px-4 py-3">
                    <div>{a.schemeName}</div>
                    <div className="text-xs text-ink/45">{formatINR(a.loanAmount)}</div>
                  </td>
                  <td className="px-4 py-3 font-semibold text-forest">{a.lokScore}</td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-mist px-2 py-0.5 text-xs font-medium">
                      {t(`admin.status.${a.status}`)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-ink/55">
                    {new Date(a.createdAt).toLocaleString(kn ? 'kn-IN' : 'en-IN')}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      to={`/admin/applications/${a.id}`}
                      className="font-semibold text-forest hover:underline"
                    >
                      {t('admin.applications.view')}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
