import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  FolderKanban,
  CheckSquare,
  FileText,
  Bell,
  BarChart3,
  Users,
  Menu,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { useState } from 'react'

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/projects', icon: FolderKanban, label: 'Projetos' },
  { to: '/tasks', icon: CheckSquare, label: 'Tarefas' },
  { to: '/atas', icon: FileText, label: 'Atas' },
  { to: '/alerts', icon: Bell, label: 'Alertas' },
  { to: '/reports', icon: BarChart3, label: 'Relatorios' },
  { to: '/team', icon: Users, label: 'Equipe' },
]

function NavContent() {
  return (
    <div className="flex flex-col h-full">
      <div className="p-6">
        <h1 className="text-xl font-bold text-primary">PM-IA</h1>
        <p className="text-xs text-muted-foreground mt-1">Gestao de Projetos</p>
      </div>
      <nav className="flex-1 px-3 space-y-1">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )
            }
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}

export function Sidebar() {
  return (
    <aside className="hidden md:flex md:w-64 md:flex-col md:fixed md:inset-y-0 border-r bg-card">
      <NavContent />
    </aside>
  )
}

export function MobileSidebar() {
  const [open, setOpen] = useState(false)
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="md:hidden">
          <Menu className="h-5 w-5" />
        </Button>
      </SheetTrigger>
      <SheetContent onClick={() => setOpen(false)}>
        <NavContent />
      </SheetContent>
    </Sheet>
  )
}
