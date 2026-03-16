import { useLocation } from 'react-router-dom'
import { MobileSidebar } from './Sidebar'

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

  return (
    <header className="sticky top-0 z-40 flex h-14 items-center gap-4 border-b bg-card px-4 md:px-6">
      <MobileSidebar />
      <h2 className="text-lg font-semibold">{title}</h2>
    </header>
  )
}
