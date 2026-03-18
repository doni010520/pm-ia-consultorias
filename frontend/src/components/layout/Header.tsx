import { useLocation } from 'react-router-dom'
import { LogOut } from 'lucide-react'
import { MobileSidebar } from './Sidebar'
import { useAuthStore } from '@/stores/authStore'

const pageTitles: Record<string, string> = {
  '/': 'Dashboard',
  '/projects': 'Projetos',
  '/tasks': 'Tarefas',
  '/atas': 'Atas de Reuniao',
  '/alerts': 'Alertas',
  '/reports': 'Relatorios',
  '/team': 'Equipe',
}

export function Header() {
  const location = useLocation()
  const basePath = '/' + (location.pathname.split('/')[1] || '')
  const title = pageTitles[basePath] || 'PM-IA'
  const { user, logout } = useAuthStore()

  return (
    <header className="sticky top-0 z-40 flex h-14 items-center gap-4 border-b bg-card px-4 md:px-6">
      <MobileSidebar />
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="ml-auto flex items-center gap-3">
        {user && (
          <>
            <span className="text-sm text-muted-foreground hidden sm:inline">
              {user.name}
            </span>
            <button
              onClick={logout}
              className="inline-flex items-center justify-center h-8 w-8 rounded-md hover:bg-muted"
              title="Sair"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </>
        )}
      </div>
    </header>
  )
}
