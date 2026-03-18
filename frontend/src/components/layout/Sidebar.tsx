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
  Clock,
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
  { to: '/capacity', icon: Clock, label: 'Capacidade' },
]

function NavContent() {
  return (
    <div className="flex flex-col h-full">
      <div className="p-6 flex items-center gap-3">
        <img src="/logo.png" alt="PM-IA" className="h-9 w-auto" onError={(e) => { e.currentTarget.style.display = 'none'; (e.currentTarget.nextSibling as HTMLElement)?.style.removeProperty('display'); }} />
        <span className="text-xl font-bold text-sidebar-foreground" style={{ display: 'none' }}>PM-IA</span>
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
                  ? 'bg-sidebar-accent text-white'
                  : 'text-sidebar-foreground/70 hover:bg-sidebar-muted hover:text-sidebar-foreground'
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
    <aside className="hidden md:flex md:w-64 md:flex-col md:fixed md:inset-y-0 border-r bg-sidebar">
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
      <SheetContent onClick={() => setOpen(false)} className="bg-sidebar p-0">
        <NavContent />
      </SheetContent>
    </Sheet>
  )
}
