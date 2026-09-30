import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AssessmentRoute, LegacyAssessmentRedirect } from './components/AssessmentRoute'
import { Shell } from './components/Shell'
import { LandingPage } from './pages/LandingPage'
import { AppProvider } from './state/AppContext'
import { AuthProvider } from './state/AuthContext'
import { ApplicationDraftProvider } from './citizen/ApplicationDraftContext'
import { AdminAuthProvider } from './admin/AdminAuthContext'
import { AdminShell } from './admin/AdminShell'

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
const ApplyPage = lazy(() => import('./pages/ApplyPage').then((m) => ({ default: m.ApplyPage })))
const ApplyStartPage = lazy(() =>
  import('./pages/ApplyPage').then((m) => ({ default: m.ApplyStartPage })),
)
const ApplyTrackPage = lazy(() =>
  import('./pages/ApplyPage').then((m) => ({ default: m.ApplyTrackPage })),
)

const AdminLoginPage = lazy(() =>
  import('./admin/pages/AdminLoginPage').then((m) => ({ default: m.AdminLoginPage })),
)
const AdminDashboardPage = lazy(() =>
  import('./admin/pages/AdminDashboardPage').then((m) => ({ default: m.AdminDashboardPage })),
)
const AdminApplicationsPage = lazy(() =>
  import('./admin/pages/AdminApplicationsPage').then((m) => ({ default: m.AdminApplicationsPage })),
)
const AdminApplicationDetailPage = lazy(() =>
  import('./admin/pages/AdminApplicationDetailPage').then((m) => ({
    default: m.AdminApplicationDetailPage,
  })),
)
const AdminAuditPage = lazy(() =>
  import('./admin/pages/AdminAuditPage').then((m) => ({ default: m.AdminAuditPage })),
)
const JobsPage = lazy(() => import('./pages/JobsPage').then((m) => ({ default: m.JobsPage })))

const ApplyVoicePage = lazy(() =>
  import('./pages/apply/VoicePage').then((m) => ({ default: m.VoicePage })),
)
const ApplyProfilePage = lazy(() =>
  import('./pages/apply/ProfilePage').then((m) => ({ default: m.ProfilePage })),
)
const ApplyConversationPage = lazy(() =>
  import('./pages/apply/ConversationPage').then((m) => ({ default: m.ConversationPage })),
)
const ApplyRecommendationsPage = lazy(() =>
  import('./pages/apply/RecommendationsPage').then((m) => ({ default: m.RecommendationsPage })),
)
const ApplyBusinessAnalysisPage = lazy(() =>
  import('./pages/apply/BusinessAnalysisPage').then((m) => ({ default: m.BusinessAnalysisPage })),
)
const ApplySchemesPage = lazy(() =>
  import('./pages/apply/SchemesPage').then((m) => ({ default: m.SchemesPage })),
)
const ApplyFinancialPlanPage = lazy(() =>
  import('./pages/apply/FinancialPlanPage').then((m) => ({ default: m.FinancialPlanPage })),
)
const ApplyApplicationPage = lazy(() =>
  import('./pages/apply/ApplicationPage').then((m) => ({ default: m.ApplicationPage })),
)
const ApplyDocumentsPage = lazy(() =>
  import('./pages/apply/DocumentsPage').then((m) => ({ default: m.DocumentsPage })),
)
const ApplyReviewPage = lazy(() =>
  import('./pages/apply/ReviewPage').then((m) => ({ default: m.ReviewPage })),
)
const ApplyConsentPage = lazy(() =>
  import('./pages/apply/ConsentPage').then((m) => ({ default: m.ConsentPage })),
)
const ApplySubmissionPage = lazy(() =>
  import('./pages/apply/SubmissionPage').then((m) => ({ default: m.SubmissionPage })),
)
const ApplyTrackingPage = lazy(() =>
  import('./pages/apply/TrackingPage').then((m) => ({ default: m.TrackingPage })),
)
const ApplyFinalReportPage = lazy(() =>
  import('./pages/apply/FinalReportPage').then((m) => ({ default: m.FinalReportPage })),
)

function RouteFallback() {
  const { t } = useTranslation()
  return <div className="py-16 text-center text-sm text-ink/50">{t('common.loading')}</div>
}

/**
 * "/" is the Ishara scroll intro — a standalone static page in public/intro/
 * whose Entrepreneur card links to /home, Admin card to /admin/login,
 * and Search for jobs to /jobs.
 * A full navigation (not a router redirect) because it is not a React page.
 */
const INTRO_URL = '/intro/index.html'

function IntroRedirect() {
  useEffect(() => {
    window.location.replace(INTRO_URL)
  }, [])
  return null
}

function CitizenLayout() {
  return (
    <ApplicationDraftProvider>
      <Shell>
        <Outlet />
      </Shell>
    </ApplicationDraftProvider>
  )
}

export default function App() {
  return (
    <AuthProvider>
    <AppProvider>
      <BrowserRouter>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route
              path="/admin"
              element={
                <AdminAuthProvider>
                  <AdminShell />
                </AdminAuthProvider>
              }
            >
              <Route path="login" element={<AdminLoginPage />} />
              <Route index element={<AdminDashboardPage />} />
              <Route path="applications" element={<AdminApplicationsPage />} />
              <Route path="applications/:id" element={<AdminApplicationDetailPage />} />
              <Route path="audit" element={<AdminAuditPage />} />
              <Route path="*" element={<Navigate to="/admin" replace />} />
            </Route>

            <Route path="/" element={<IntroRedirect />} />
            <Route path="/jobs" element={<JobsPage />} />

            <Route element={<CitizenLayout />}>
              <Route path="/home" element={<LandingPage />} />
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
              <Route path="/apply" element={<ApplyVoicePage />} />
              <Route path="/apply/profile" element={<ApplyProfilePage />} />
              <Route path="/apply/conversation" element={<ApplyConversationPage />} />
              <Route path="/apply/recommendations" element={<ApplyRecommendationsPage />} />
              <Route path="/apply/business-analysis" element={<ApplyBusinessAnalysisPage />} />
              <Route path="/apply/schemes" element={<ApplySchemesPage />} />
              <Route path="/apply/financial-plan" element={<ApplyFinancialPlanPage />} />
              <Route path="/apply/application" element={<ApplyApplicationPage />} />
              <Route path="/apply/documents" element={<ApplyDocumentsPage />} />
              <Route path="/apply/review" element={<ApplyReviewPage />} />
              <Route path="/apply/consent" element={<ApplyConsentPage />} />
              <Route path="/apply/submission" element={<ApplySubmissionPage />} />
              <Route path="/apply/tracking" element={<ApplyTrackingPage />} />
              <Route path="/apply/final-report" element={<ApplyFinalReportPage />} />
              <Route path="/apply/hub" element={<ApplyPage />} />
              <Route path="/apply/start/:schemeId" element={<ApplyStartPage />} />
              <Route path="/apply/track/:trackingId" element={<ApplyTrackPage />} />
            </Route>
          </Routes>
        </Suspense>
      </BrowserRouter>
    </AppProvider>
    </AuthProvider>
  )
}
