import { lazy, Suspense } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AssessmentRoute, LegacyAssessmentRedirect } from './components/AssessmentRoute'
import { Shell } from './components/Shell'
import { LandingPage } from './pages/LandingPage'
import { AppProvider } from './state/AppContext'
import { AuthProvider } from './state/AuthContext'

// Route-level code splitting: recharts (PulsePage) and react-leaflet
// (PulsePage/ReportPage's VillageMap) are the heaviest dependencies and are
// only needed once the user actually navigates past the landing page.
const ScanPage = lazy(() => import('./pages/ScanPage').then((m) => ({ default: m.ScanPage })))
const PulsePage = lazy(() => import('./pages/PulsePage').then((m) => ({ default: m.PulsePage })))
const ReportPage = lazy(() => import('./pages/ReportPage').then((m) => ({ default: m.ReportPage })))
const FinancePage = lazy(() => import('./pages/FinancePage').then((m) => ({ default: m.FinancePage })))
const SanctionPage = lazy(() =>
  import('./pages/SanctionPage').then((m) => ({ default: m.SanctionPage })),
)
const ExportPage = lazy(() => import('./pages/ExportPage').then((m) => ({ default: m.ExportPage })))
const AssistantPage = lazy(() =>
  import('./pages/AssistantPage').then((m) => ({ default: m.AssistantPage })),
)
const LoginPage = lazy(() => import('./pages/LoginPage').then((m) => ({ default: m.LoginPage })))
const HistoryPage = lazy(() =>
  import('./pages/HistoryPage').then((m) => ({ default: m.HistoryPage })),
)

function RouteFallback() {
  // Must stay bilingual: the Suspense fallback is real UI a Kannada-mode
  // user can genuinely see on first load of a lazy route chunk.
  const { t } = useTranslation()
  return <div className="py-16 text-center text-sm text-ink/50">{t('common.loading')}</div>
}

export default function App() {
  return (
    <AuthProvider>
    <AppProvider>
      <BrowserRouter>
        <Shell>
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/" element={<LandingPage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/history" element={<HistoryPage />} />
              <Route path="/scan" element={<ScanPage />} />
              <Route path="/pulse" element={<LegacyAssessmentRedirect page="pulse" />} />
              <Route
                path="/pulse/:id"
                element={
                  <AssessmentRoute>
                    <PulsePage />
                  </AssessmentRoute>
                }
              />
              <Route path="/report" element={<LegacyAssessmentRedirect page="report" />} />
              <Route
                path="/report/:id"
                element={
                  <AssessmentRoute>
                    <ReportPage />
                  </AssessmentRoute>
                }
              />
              <Route path="/finance" element={<LegacyAssessmentRedirect page="finance" />} />
              <Route
                path="/finance/:id"
                element={
                  <AssessmentRoute>
                    <FinancePage />
                  </AssessmentRoute>
                }
              />
              <Route path="/sanction" element={<LegacyAssessmentRedirect page="sanction" />} />
              <Route
                path="/sanction/:id"
                element={
                  <AssessmentRoute>
                    <SanctionPage />
                  </AssessmentRoute>
                }
              />
              <Route path="/export" element={<LegacyAssessmentRedirect page="export" />} />
              <Route
                path="/export/:id"
                element={
                  <AssessmentRoute>
                    <ExportPage />
                  </AssessmentRoute>
                }
              />
              <Route path="/assistant" element={<AssistantPage />} />
              <Route
                path="/assistant/:id"
                element={
                  <AssessmentRoute>
                    <AssistantPage />
                  </AssessmentRoute>
                }
              />
            </Routes>
          </Suspense>
        </Shell>
      </BrowserRouter>
    </AppProvider>
    </AuthProvider>
  )
}
