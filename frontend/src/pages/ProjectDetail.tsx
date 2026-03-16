import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Brain, Clock, CheckCircle, AlertTriangle, TrendingUp } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { PageContainer } from '@/components/layout/PageContainer'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { PriorityBadge } from '@/components/shared/PriorityBadge'
import { LoadingSpinner, ErrorState } from '@/components/shared/LoadingSpinner'
import { useProject, useProjectMetrics, useProjectTasks, useProjectRiskAnalysis } from '@/hooks/useProjects'
import { formatDate, formatHours } from '@/lib/utils'
import { useState } from 'react'

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>()
  const { data: projectData, isLoading, error } = useProject(id!)
  const { data: metricsData } = useProjectMetrics(id!)
  const { data: tasksData } = useProjectTasks(id!)
  const riskAnalysis = useProjectRiskAnalysis(id!)
  const [analyzingRisk, setAnalyzingRisk] = useState(false)

  const handleAnalyzeRisk = async () => {
    setAnalyzingRisk(true)
    await riskAnalysis.refetch()
    setAnalyzingRisk(false)
  }

  if (isLoading) return <PageContainer><LoadingSpinner /></PageContainer>
  if (error || !projectData) return <PageContainer><ErrorState message="Erro ao carregar projeto" /></PageContainer>

  const project = projectData.project
  const metrics = metricsData?.metrics
  const tasks = tasksData?.tasks || []

  const tasksByStatus = {
    todo: tasks.filter((t) => t.status === 'todo'),
    in_progress: tasks.filter((t) => t.status === 'in_progress'),
    review: tasks.filter((t) => t.status === 'review'),
    done: tasks.filter((t) => t.status === 'done'),
  }

  return (
    <PageContainer>
      {/* Header */}
      <div className="flex items-start gap-4">
        <Link to="/projects">
          <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{project.name}</h1>
            <StatusBadge status={project.status} />
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {project.client_name || 'Sem cliente'}
            {project.due_date && ` | Prazo: ${formatDate(project.due_date)}`}
          </p>
        </div>
        <Button onClick={handleAnalyzeRisk} disabled={analyzingRisk} variant="outline">
          <Brain className="h-4 w-4 mr-1" />
          {analyzingRisk ? 'Analisando...' : 'Analisar Risco com IA'}
        </Button>
      </div>

      {/* Risk Analysis Result */}
      {riskAnalysis.data && (
        <Card className="border-warning/50 bg-warning/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Brain className="h-4 w-4" /> Analise de Risco (IA)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {riskAnalysis.data.error ? (
              <p className="text-sm text-destructive">{riskAnalysis.data.error}</p>
            ) : (
              <pre className="text-sm whitespace-pre-wrap">
                {typeof riskAnalysis.data.analysis === 'string'
                  ? riskAnalysis.data.analysis
                  : JSON.stringify(riskAnalysis.data.analysis, null, 2)}
              </pre>
            )}
          </CardContent>
        </Card>
      )}

      {/* Metrics */}
      {metrics && (
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-5">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground">Progresso</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <Progress value={project.progress_percent || 0} className="flex-1 h-2" />
                <span className="text-sm font-bold">{project.progress_percent || 0}%</span>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-xs font-medium text-muted-foreground">Tarefas</CardTitle>
              <CheckCircle className="h-3 w-3 text-success" />
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold">{metrics.completed_tasks}/{metrics.total_tasks}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-xs font-medium text-muted-foreground">Horas</CardTitle>
              <Clock className="h-3 w-3 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold">
                {formatHours(metrics.total_hours)}
                {metrics.budget_hours ? <span className="text-xs font-normal text-muted-foreground"> / {formatHours(metrics.budget_hours)}</span> : ''}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-xs font-medium text-muted-foreground">Burn Rate</CardTitle>
              <TrendingUp className="h-3 w-3 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className={`text-xl font-bold ${metrics.burn_rate > 0.8 ? 'text-destructive' : ''}`}>
                {(metrics.burn_rate * 100).toFixed(0)}%
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-xs font-medium text-muted-foreground">Atrasadas</CardTitle>
              <AlertTriangle className="h-3 w-3 text-destructive" />
            </CardHeader>
            <CardContent>
              <div className={`text-xl font-bold ${metrics.overdue_tasks > 0 ? 'text-destructive' : ''}`}>
                {metrics.overdue_tasks}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Kanban Board */}
      <div>
        <h3 className="text-lg font-semibold mb-4">Tarefas</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {(['todo', 'in_progress', 'review', 'done'] as const).map((status) => {
            const labels = { todo: 'A Fazer', in_progress: 'Em Andamento', review: 'Revisao', done: 'Concluido' }
            return (
              <div key={status} className="bg-muted/50 rounded-lg p-3">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-medium">{labels[status]}</h4>
                  <Badge variant="secondary" className="text-xs">{tasksByStatus[status].length}</Badge>
                </div>
                <div className="space-y-2">
                  {tasksByStatus[status].map((task) => (
                    <Card key={task.id} className="p-3 cursor-pointer hover:shadow-sm">
                      <p className="text-sm font-medium line-clamp-2">{task.title}</p>
                      <div className="flex items-center justify-between mt-2">
                        <span className="text-xs text-muted-foreground">{task.assignee_name || '-'}</span>
                        <PriorityBadge priority={task.priority} />
                      </div>
                      {task.due_date && (
                        <p className="text-xs text-muted-foreground mt-1">{formatDate(task.due_date)}</p>
                      )}
                    </Card>
                  ))}
                  {tasksByStatus[status].length === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-4">Nenhuma tarefa</p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </PageContainer>
  )
}
