import { Link } from 'react-router-dom'
import { AlertTriangle, CalendarCheck, CalendarClock, Clock, FolderKanban } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PageContainer } from '@/components/layout/PageContainer'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { PriorityBadge } from '@/components/shared/PriorityBadge'
import { LoadingSpinner, ErrorState } from '@/components/shared/LoadingSpinner'
import { useAlertSummary } from '@/hooks/useAlerts'
import { useProjects } from '@/hooks/useProjects'
import { Progress } from '@/components/ui/progress'

export default function Dashboard() {
  const { data: summary, isLoading, error } = useAlertSummary()
  const { data: projectsData } = useProjects({ status: 'active' })

  if (isLoading) return <PageContainer><LoadingSpinner /></PageContainer>
  if (error) return <PageContainer><ErrorState message="Erro ao carregar dashboard" /></PageContainer>

  const s = summary!

  return (
    <PageContainer>
      {/* Summary Cards */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Tarefas Hoje</CardTitle>
            <CalendarCheck className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{s.today.total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Atrasadas</CardTitle>
            <AlertTriangle className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">{s.overdue.total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Proximos 7 dias</CardTitle>
            <CalendarClock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{s.upcoming_7_days.total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Projetos Ativos</CardTitle>
            <FolderKanban className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{projectsData?.projects.length || 0}</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Risky Projects */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-warning" />
              Projetos em Risco
            </CardTitle>
          </CardHeader>
          <CardContent>
            {s.risky_projects.total === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum projeto em risco</p>
            ) : (
              <div className="space-y-3">
                {s.risky_projects.projects.map((p) => (
                  <div key={p.name} className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">{p.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {p.overdue_tasks} atrasada{p.overdue_tasks !== 1 ? 's' : ''} de {p.total_open_tasks}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Active Projects */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FolderKanban className="h-4 w-4" />
              Projetos Ativos
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!projectsData?.projects.length ? (
              <p className="text-sm text-muted-foreground">Nenhum projeto ativo</p>
            ) : (
              <div className="space-y-3">
                {projectsData.projects.slice(0, 5).map((p) => (
                  <Link key={p.id} to={`/projects/${p.id}`} className="block">
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{p.name}</p>
                        <p className="text-xs text-muted-foreground">{p.client_name || 'Sem cliente'}</p>
                      </div>
                      <div className="flex items-center gap-2 ml-2">
                        <Progress value={p.progress_percent || 0} className="w-20 h-2" />
                        <span className="text-xs text-muted-foreground w-8">{p.progress_percent || 0}%</span>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Today's Tasks */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Tarefas de Hoje
            </CardTitle>
          </CardHeader>
          <CardContent>
            {s.today.total === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma tarefa para hoje</p>
            ) : (
              <div className="space-y-2">
                {s.today.tasks.slice(0, 5).map((t) => (
                  <div key={t.title} className="flex items-center justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">{t.title}</p>
                      <p className="text-xs text-muted-foreground">{t.assignee_name || '-'} | {t.project_name || '-'}</p>
                    </div>
                    <PriorityBadge priority={t.priority} />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Overdue Tasks */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-4 w-4" />
              Tarefas Atrasadas
            </CardTitle>
          </CardHeader>
          <CardContent>
            {s.overdue.total === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma tarefa atrasada</p>
            ) : (
              <div className="space-y-2">
                {s.overdue.tasks.slice(0, 5).map((t) => (
                  <div key={t.title} className="flex items-center justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">{t.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {t.assignee_name || '-'} | {t.days_overdue} dia{t.days_overdue !== 1 ? 's' : ''} atraso
                      </p>
                    </div>
                    <StatusBadge status={t.status} />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  )
}
