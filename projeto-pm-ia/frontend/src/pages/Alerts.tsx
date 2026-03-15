import { Link } from 'react-router-dom'
import { AlertTriangle, Clock, CalendarClock } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PageContainer } from '@/components/layout/PageContainer'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { PriorityBadge } from '@/components/shared/PriorityBadge'
import { LoadingSpinner, ErrorState, EmptyState } from '@/components/shared/LoadingSpinner'
import { useAlertSummary } from '@/hooks/useAlerts'
import { formatDate } from '@/lib/utils'
import type { Task } from '@/types'

function TaskList({ tasks, showOverdue }: { tasks: Task[]; showOverdue?: boolean }) {
  if (tasks.length === 0) return <EmptyState message="Nenhuma tarefa" />
  return (
    <div className="space-y-2">
      {tasks.map((t, i) => (
        <Card key={`${t.title}-${i}`}>
          <CardContent className="py-3 flex items-center justify-between gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{t.title}</p>
              <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                {t.project_name && (
                  <Link to={`/projects`} className="text-primary/70 hover:underline">{t.project_name}</Link>
                )}
                <span>{t.assignee_name || 'Sem responsavel'}</span>
                {showOverdue && t.days_overdue != null && (
                  <span className="text-destructive font-medium">{t.days_overdue} dia{t.days_overdue !== 1 ? 's' : ''} atraso</span>
                )}
                {t.due_date && !showOverdue && <span>{formatDate(t.due_date)}</span>}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <PriorityBadge priority={t.priority} />
              <StatusBadge status={t.status} />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

export default function Alerts() {
  const { data, isLoading, error } = useAlertSummary()

  if (isLoading) return <PageContainer><LoadingSpinner /></PageContainer>
  if (error) return <PageContainer><ErrorState message="Erro ao carregar alertas" /></PageContainer>

  const s = data!

  return (
    <PageContainer>
      <Tabs defaultValue="today">
        <TabsList>
          <TabsTrigger value="today" className="gap-1">
            <Clock className="h-3 w-3" /> Hoje ({s.today.total})
          </TabsTrigger>
          <TabsTrigger value="overdue" className="gap-1">
            <AlertTriangle className="h-3 w-3" /> Atrasadas ({s.overdue.total})
          </TabsTrigger>
          <TabsTrigger value="upcoming" className="gap-1">
            <CalendarClock className="h-3 w-3" /> Proximos 7 dias ({s.upcoming_7_days.total})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="today">
          <TaskList tasks={s.today.tasks} />
        </TabsContent>

        <TabsContent value="overdue">
          <TaskList tasks={s.overdue.tasks} showOverdue />
        </TabsContent>

        <TabsContent value="upcoming">
          <TaskList tasks={s.upcoming_7_days.tasks} />
        </TabsContent>
      </Tabs>
    </PageContainer>
  )
}
