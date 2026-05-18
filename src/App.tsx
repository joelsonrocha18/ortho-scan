import { Suspense, lazy, useEffect, useState } from 'react'
import type { ComponentType, ReactElement } from 'react'
import { BrowserRouter, HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import InternalRouteUrlMask, { InternalAppEntryRedirect } from './app/InternalRouteUrlMask'
import ProtectedRoute from './app/ProtectedRoute'
import { ToastProvider } from './app/ToastProvider'
import { getAuthProvider } from './auth/authProvider'
import { DATA_MODE } from './data/dataMode'
import { applyStoredTheme, saveSystemSettings } from './lib/systemSettings'

const PUSH_NOTIFICATIONS_ENABLED = ((import.meta.env.VITE_WEB_PUSH_ENABLED as string | undefined)?.trim().toLowerCase() ?? '') === 'true'

const CaseDetailPage = lazy(() => import('./pages/CaseDetailPage'))
const CasesPage = lazy(() => import('./pages/CasesPage'))
const AgendaPage = lazy(() => import('./pages/AgendaPage'))
const DashboardPage = lazy(() => import('./pages/DashboardPage'))
const DentistAccessPage = lazy(() => import('./pages/DentistAccessPage'))
const DentistPortalPage = lazy(() => import('./pages/DentistPortalPage'))
const DentistDetailPage = lazy(() => import('./pages/DentistDetailPage'))
const DentistsPage = lazy(() => import('./pages/DentistsPage'))
const ClinicDetailPage = lazy(() => import('./pages/ClinicDetailPage'))
const ClinicsPage = lazy(() => import('./pages/ClinicsPage'))
const DiagnosticsPage = lazy(() => import('./pages/DiagnosticsPage'))
const MigrationPage = lazy(() => import('./pages/MigrationPage'))
const LabPage = lazy(() => import('./pages/LabPage'))
const HelpPage = lazy(() => import('./pages/HelpPage'))
const LoginPage = lazy(() => import('./pages/LoginPage'))
const LegalLgpdPage = lazy(() => import('./pages/LegalLgpdPage'))
const LegalPrivacyPage = lazy(() => import('./pages/LegalPrivacyPage'))
const LegalTermsPage = lazy(() => import('./pages/LegalTermsPage'))
const OnboardingInvitePage = lazy(() => import('./pages/OnboardingInvitePage'))
const PatientAccessPage = lazy(() => import('./pages/PatientAccessPage'))
const PatientPortalPage = lazy(() => import('./pages/PatientPortalPage'))
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage'))
const PatientDetailPage = lazy(() => import('./pages/PatientDetailPage'))
const PatientsPage = lazy(() => import('./pages/PatientsPage'))
const PublicAccessPage = lazy(() => import('./pages/PublicAccessPage'))
const ScansPage = lazy(() => import('./pages/ScansPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))

function RouteLoader() {
  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto max-w-5xl rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
        Carregando pagina...
      </div>
    </div>
  )
}

function withSuspense(element: ReactElement) {
  return <Suspense fallback={<RouteLoader />}>{element}</Suspense>
}

function RootRedirect() {
  const [loading, setLoading] = useState(true)
  const [hasSession, setHasSession] = useState(false)

  useEffect(() => {
    let active = true
    getAuthProvider()
      .getCurrentUser()
      .then((user) => {
        if (!active) return
        setHasSession(Boolean(user))
      })
      .finally(() => {
        if (!active) return
        setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  if (loading) {
    return <Navigate to="/login" replace />
  }
  return <Navigate to={hasSession ? '/app/dashboard' : '/login'} replace />
}

export default function App() {
  const [PushNotificationsBridge, setPushNotificationsBridge] = useState<ComponentType | null>(null)

  useEffect(() => {
    applyStoredTheme()
    if (DATA_MODE !== 'supabase') return
    void (async () => {
      const { loadSystemSettingsSupabase } = await import('./repo/systemSettingsRepo')
      const remote = await loadSystemSettingsSupabase()
      if (!remote) return
      saveSystemSettings(remote)
      applyStoredTheme()
    })()
  }, [])

  useEffect(() => {
    if (!PUSH_NOTIFICATIONS_ENABLED) return
    let active = true
    void import('./pwa/PushNotificationsBridge').then((module) => {
      if (!active) return
      setPushNotificationsBridge(() => module.default)
    })
    return () => {
      active = false
    }
  }, [])

  const Router = window.location.protocol === 'file:' ? HashRouter : BrowserRouter

  return (
    <ToastProvider>
      <Router>
        <InternalRouteUrlMask />
        {PushNotificationsBridge ? <PushNotificationsBridge /> : null}
        <Routes>
          <Route path="/" element={<RootRedirect />} />
          <Route path="/login" element={withSuspense(<LoginPage />)} />
          <Route path="/acesso" element={withSuspense(<PublicAccessPage />)} />
          <Route path="/acesso/dentistas" element={withSuspense(<DentistAccessPage />)} />
          <Route path="/acesso/pacientes" element={withSuspense(<PatientAccessPage />)} />
          <Route path="/acesso/pacientes/portal" element={withSuspense(<PatientPortalPage />)} />
          <Route path="/legal/privacy" element={withSuspense(<LegalPrivacyPage />)} />
          <Route path="/legal/terms" element={withSuspense(<LegalTermsPage />)} />
          <Route path="/legal/lgpd" element={withSuspense(<LegalLgpdPage />)} />
          <Route path="/complete-signup" element={withSuspense(<OnboardingInvitePage />)} />
          <Route path="/reset-password" element={withSuspense(<ResetPasswordPage />)} />
          <Route path="/app" element={<InternalAppEntryRedirect />} />
          <Route element={<ProtectedRoute permission="dashboard.read" />}>
            <Route path="/app/dashboard" element={withSuspense(<DashboardPage />)} />
            <Route path="/dashboard/agendamentos" element={<Navigate to="/app/agenda" replace />} />
          </Route>
          <Route element={<ProtectedRoute permission="agenda.read" />}>
            <Route path="/app/agenda" element={withSuspense(<AgendaPage />)} />
          </Route>
          <Route element={<ProtectedRoute permission="scans.read" />}>
            <Route path="/app/scans" element={withSuspense(<ScansPage />)} />
          </Route>
          <Route element={<ProtectedRoute permission="cases.read" />}>
            <Route path="/app/cases" element={withSuspense(<CasesPage />)} />
            <Route path="/app/cases/:id" element={withSuspense(<CaseDetailPage />)} />
          </Route>
          <Route element={<ProtectedRoute permission="cases.read" fallbackTo="/acesso/dentistas" />}>
            <Route path="/app/portal-dentista" element={withSuspense(<DentistPortalPage />)} />
          </Route>
          <Route element={<ProtectedRoute permission="dentists.read" />}>
            <Route path="/app/dentists" element={withSuspense(<DentistsPage />)} />
            <Route path="/app/dentists/:id" element={withSuspense(<DentistDetailPage />)} />
          </Route>
          <Route element={<ProtectedRoute permission="clinics.read" />}>
            <Route path="/app/clinics" element={withSuspense(<ClinicsPage />)} />
            <Route path="/app/clinics/:id" element={withSuspense(<ClinicDetailPage />)} />
          </Route>
          <Route element={<ProtectedRoute permission="patients.read" />}>
            <Route path="/app/patients" element={withSuspense(<PatientsPage />)} />
            <Route path="/app/patients/:id" element={withSuspense(<PatientDetailPage />)} />
          </Route>
          <Route element={<ProtectedRoute permission="lab.read" />}>
            <Route path="/app/lab" element={withSuspense(<LabPage />)} />
          </Route>
          <Route element={<ProtectedRoute permission="dashboard.read" />}>
            <Route path="/app/help" element={withSuspense(<HelpPage />)} />
          </Route>
          <Route element={<ProtectedRoute permission="settings.read" />}>
            <Route path="/app/settings" element={withSuspense(<SettingsPage />)} />
          </Route>
          <Route element={<ProtectedRoute permission="settings.read" />}>
            <Route path="/app/settings/diagnostics" element={withSuspense(<DiagnosticsPage />)} />
          </Route>
          <Route element={<ProtectedRoute permission="settings.write" />}>
            <Route path="/app/settings/migration" element={withSuspense(<MigrationPage />)} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Router>
    </ToastProvider>
  )
}
