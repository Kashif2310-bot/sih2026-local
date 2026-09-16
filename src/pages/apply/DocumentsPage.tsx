import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useApplicationDraft } from '../../citizen/useApplicationDraft'
import { WizardActions, WizardShell } from '../../components/apply/WizardShell'

export function DocumentsPage() {
  const { t, i18n } = useTranslation()
  const kn = i18n.language === 'kn'
  const navigate = useNavigate()
  const { documents, updateDocument } = useApplicationDraft()

  return (
    <WizardShell title={t('apply.documents.title')} subtitle={t('apply.documents.subtitle')}>
      <ul className="space-y-3">
        {documents.map((doc) => (
          <li key={doc.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-forest/10 bg-white px-4 py-3">
            <div>
              <p className="text-sm font-medium">{kn ? doc.labelKn : doc.labelEn}</p>
              <p className="text-xs text-ink/50">
                {doc.status === 'uploaded' && doc.fileName
                  ? `${doc.fileName} · ${Math.round((doc.sizeBytes ?? 0) / 1024)} KB`
                  : t(`admin.review.documents.status.${doc.status}`)}
              </p>
            </div>
            {doc.status === 'uploaded' ? (
              <button
                type="button"
                className="text-xs font-semibold text-red-700"
                onClick={() =>
                  updateDocument(doc.id, {
                    status: 'missing',
                    fileName: undefined,
                    sizeBytes: undefined,
                    uploadedAt: undefined,
                  })
                }
              >
                {t('apply.documents.remove')}
              </button>
            ) : (
              <label className="cursor-pointer rounded-full bg-forest px-3 py-1.5 text-xs font-bold text-white">
                {t('apply.documents.upload')}
                <input
                  type="file"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (!file) return
                    updateDocument(doc.id, {
                      status: 'uploaded',
                      fileName: file.name,
                      sizeBytes: file.size,
                      uploadedAt: Date.now(),
                    })
                  }}
                />
              </label>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-ink/55">{t('apply.documents.allUploadedHint')}</p>

      <WizardActions
        onBack={() => navigate('/apply/application')}
        backLabel={t('apply.back')}
        onNext={() => navigate('/apply/review')}
        nextLabel={t('apply.documents.continue')}
      />
    </WizardShell>
  )
}
