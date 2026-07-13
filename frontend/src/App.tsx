import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { ErrorBoundary } from '@/components/shared/ErrorBoundary'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/authStore'
import { Sidebar } from '@/components/layout/Sidebar'
import { Header } from '@/components/layout/Header'
import Login from '@/pages/Login'
import InviteAccept from '@/pages/InviteAccept'
import Dashboard from '@/pages/Dashboard'
import Overview from '@/pages/Overview'
import Projects from '@/pages/Projects'
import ProjectDetail from '@/pages/ProjectDetail'
import Tasks from '@/pages/Tasks'
import Atas from '@/pages/Atas'
import AtaDetail from '@/pages/AtaDetail'
import Alerts from '@/pages/Alerts'
import Reports from '@/pages/Reports'
import Team from '@/pages/Team'
import Capacity from '@/pages/Capacity'
import CapacityCalendar from '@/pages/CapacityCalendar'
import CRM from '@/pages/CRM'
import CrmAgenda from '@/pages/CrmAgenda'
import Empresas from '@/pages/Empresas'
import EmpresaDetail from '@/pages/EmpresaDetail'
import ContatoDetail from '@/pages/ContatoDetail'
import LeadJourney from '@/pages/LeadJourney'
import ProposalTemplates from '@/pages/ProposalTemplates'
import Rica from '@/pages/Rica'
import ForgotPassword from '@/pages/ForgotPassword'
import ResetPassword from '@/pages/ResetPassword'
import { RicaChat } from '@/components/rica-chat/RicaChat'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
})

function ProtectedLayout() {
  const { isAuthenticated, isLoading, checkAuth } = useAuthStore()
  const location = useLocation()

  useEffect(() => {
    checkAuth()
  }, [checkAuth])

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30">
        <div className="text-muted-foreground">Carregando...</div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  return (
    <div className="min-h-screen bg-muted/30">
      <Sidebar />
      <div className="md:pl-64 flex flex-col min-h-screen">
        <Header />
        <ErrorBoundary key={location.pathname} label={location.pathname}>
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/projects" element={<Projects />} />
            <Route path="/projects/:id" element={<ProjectDetail />} />
            <Route path="/tasks" element={<Tasks />} />
            <Route path="/atas" element={<Atas />} />
            <Route path="/atas/:id" element={<AtaDetail />} />
            <Route path="/alerts" element={<Alerts />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/team" element={<Team />} />
            <Route path="/capacity" element={<CapacityCalendar />} />
            <Route path="/capacity/simple" element={<Capacity />} />
            <Route path="/rica" element={<Rica />} />
            <Route path="/crm" element={<CRM />} />
            <Route path="/crm/agenda" element={<CrmAgenda />} />
            <Route path="/crm/empresas" element={<Empresas />} />
            <Route path="/crm/empresas/:id" element={<EmpresaDetail />} />
            <Route path="/crm/contatos/:id" element={<ContatoDetail />} />
            <Route path="/crm/journey" element={<LeadJourney />} />
            <Route path="/crm/templates" element={<ProposalTemplates />} />
          </Routes>
        </ErrorBoundary>
      </div>
      <ErrorBoundary label="Chat Rica" fallback={null}>
        <RicaChat />
      </ErrorBoundary>
    </div>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password/:token" element={<ResetPassword />} />
          <Route path="/invite/:token" element={<InviteAccept />} />
          <Route path="/*" element={<ProtectedLayout />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
