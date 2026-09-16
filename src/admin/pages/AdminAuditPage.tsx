import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { listApplications } from '../../platform/store'
import { flattenAuditTrail } from '../auditHelpers'

export function AdminAuditPage() {
  const { t, i18n } = useTranslation()
  const kn = i18n.language === 'kn'
  const apps = listApplications()
  const [filterId, setFilterId] = useState<string>('all')

  const all = flattenAuditTrail(apps)
  const events = filterId === 'all' ? all : all.filter((e) => e.applicationId === filterId)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold text-forest">{t('admin.audit.title')}</h1>
        <p className="mt-2 text-sm text-ink/65">{t('admin.audit.subtitle')}</p>
      </div>

      <label className="text-xs font-semibold text-ink/60">
        {t('admin.audit.filterApplication')}
        <select
          className="ml-2 rounded-lg border border-forest/20 bg-white px-2 py-1.5 text-sm font-normal text-ink"
          value={filterId}
          onChange={(e) => setFilterId(e.target.value)}
        >
          <option value="all">{t('admin.audit.allApplications')}</option>
          {apps.map((a) => (
            <option key={a.id} value={a.id}>
              {a.id} — {a.applicant.name}
            </option>
          ))}
        </select>
      </label>

      {events.length === 0 ? (
        <p className="text-sm text-ink/50">{t('admin.audit.empty')}</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-forest/10 bg-white">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-forest/10 bg-mist/50 text-xs font-semibold uppercase tracking-wide text-ink/50">
              <tr>
                <th className="px-4 py-3">{t('admin.audit.at')}</th>
                <th className="px-4 py-3">App</th>
                <th className="px-4 py-3">{t('admin.audit.actor')}</th>
                <th className="px-4 py-3">{t('admin.audit.action')}</th>
                <th className="px-4 py-3">{t('admin.audit.detail')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-forest/10">
              {events.map((e) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-ink/55">
                    {new Date(e.at).toLocaleString(kn ? 'kn-IN' : 'en-IN')}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      to={`/admin/applications/${e.applicationId}`}
                      className="font-mono text-xs text-forest hover:underline"
                    >
                      {e.applicationId}
                    </Link>
                    <div className="text-xs text-ink/45">{e.applicantName}</div>
                  </td>
                  <td className="px-4 py-3">{e.actor}</td>
                  <td className="px-4 py-3 font-medium">{e.action}</td>
                  <td className="px-4 py-3 text-ink/65">{e.detail ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
