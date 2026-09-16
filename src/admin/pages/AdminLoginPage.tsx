import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Shield } from 'lucide-react'
import { ADMIN_IDENTITIES } from '../auth'
import { useAdminAuth } from '../useAdminAuth'

export function AdminLoginPage() {
  const { t, i18n } = useTranslation()
  const kn = i18n.language === 'kn'
  const { login } = useAdminAuth()
  const navigate = useNavigate()
  const [identityId, setIdentityId] = useState(ADMIN_IDENTITIES[0]?.id ?? '')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(false)

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const ok = login(identityId, password)
    if (!ok) {
      setError(true)
      return
    }
    navigate('/admin', { replace: true })
  }

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-4 py-10">
      <div className="mb-6 flex items-center gap-2 text-forest">
        <Shield className="h-6 w-6" />
        <h1 className="font-display text-2xl font-bold">{t('admin.login.title')}</h1>
      </div>
      <p className="mb-2 text-sm text-ink/65">{t('admin.login.subtitle')}</p>
      <p className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-ink/70">
        {t('admin.storageNote')}
      </p>

      <form onSubmit={onSubmit} className="space-y-4 rounded-2xl border border-forest/10 bg-white p-5 shadow-sm">
        <label className="block text-sm font-semibold text-forest">
          {t('admin.login.identity')}
          <select
            className="mt-1 w-full rounded-xl border border-forest/20 bg-mist/40 px-3 py-2.5 text-sm font-normal text-ink"
            value={identityId}
            onChange={(e) => setIdentityId(e.target.value)}
          >
            {ADMIN_IDENTITIES.map((id) => (
              <option key={id.id} value={id.id}>
                {kn ? id.nameKn : id.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm font-semibold text-forest">
          {t('admin.login.password')}
          <input
            type="password"
            className="mt-1 w-full rounded-xl border border-forest/20 bg-mist/40 px-3 py-2.5 text-sm font-normal text-ink"
            placeholder={t('admin.login.passwordPlaceholder')}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value)
              setError(false)
            }}
          />
        </label>

        {error && <p className="text-sm text-red-700">{t('admin.login.error')}</p>}

        <button
          type="submit"
          className="w-full rounded-full bg-forest py-2.5 text-sm font-bold text-white hover:bg-leaf"
        >
          {t('admin.login.submit')}
        </button>
      </form>
    </div>
  )
}
