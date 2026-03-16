import { useState } from 'react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PageContainer } from '@/components/layout/PageContainer'
import { PriorityBadge } from '@/components/shared/PriorityBadge'
import { LoadingSpinner, ErrorState } from '@/components/shared/LoadingSpinner'
import { useTasks, useUpdateTaskStatus } from '@/hooks/useTasks'
import { useProjects } from '@/hooks/useProjects'
import { formatDate } from '@/lib/utils'
import type { Task } from '@/types'

const columns = [
  { id: 'todo' as const, label: 'A Fazer' },
  { id: 'in_progress' as const, label: 'Em Andamento' },
  { id: 'review' as const, label: 'Revisao' },
  { id: 'done' as const, label: 'Concluido' },
]

export default function Tasks() {
  const [projectFilter, setProjectFilter] = useState<string>('')
  const { data, isLoading, error } = useTasks(projectFilter ? { project_id: projectFilter } : undefined)
  const { data: projectsData } = useProjects()
  const updateStatus = useUpdateTaskStatus()
  const [draggingId, setDraggingId] = useState<string | null>(null)

  const tasks = data?.tasks || []

  const tasksByStatus = (status: string) => tasks.filter((t) => t.status === status)

  const handleDragStart = (e: React.DragEvent, taskId: string) => {
    e.dataTransfer.setData('taskId', taskId)
    setDraggingId(taskId)
  }

  const handleDrop = (e: React.DragEvent, newStatus: string) => {
    e.preventDefault()
    const taskId = e.dataTransfer.getData('taskId')
    if (taskId) {
      updateStatus.mutate({ id: taskId, status: newStatus })
    }
    setDraggingId(null)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
  }

  if (isLoading) return <PageContainer><LoadingSpinner /></PageContainer>
  if (error) return <PageContainer><ErrorState message="Erro ao carregar tarefas" /></PageContainer>

  return (
    <PageContainer>
      <div className="flex items-center gap-3">
        <Select value={projectFilter} onValueChange={setProjectFilter}>
          <SelectTrigger className="w-52">
            <SelectValue placeholder="Todos os projetos" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os projetos</SelectItem>
            {projectsData?.projects.map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {columns.map((col) => (
          <div
            key={col.id}
            className={`bg-muted/50 rounded-lg p-3 min-h-[200px] transition-colors ${draggingId ? 'border-2 border-dashed border-primary/30' : ''}`}
            onDrop={(e) => handleDrop(e, col.id)}
            onDragOver={handleDragOver}
          >
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-medium">{col.label}</h4>
              <Badge variant="secondary" className="text-xs">{tasksByStatus(col.id).length}</Badge>
            </div>
            <div className="space-y-2">
              {tasksByStatus(col.id).map((task) => (
                <TaskCard key={task.id} task={task} onDragStart={handleDragStart} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </PageContainer>
  )
}

function TaskCard({ task, onDragStart }: { task: Task; onDragStart: (e: React.DragEvent, id: string) => void }) {
  return (
    <Card
      className="p-3 cursor-grab active:cursor-grabbing hover:shadow-sm"
      draggable
      onDragStart={(e) => onDragStart(e, task.id)}
    >
      <p className="text-sm font-medium line-clamp-2">{task.title}</p>
      {task.project_name && (
        <p className="text-xs text-primary/70 mt-1">{task.project_name}</p>
      )}
      <div className="flex items-center justify-between mt-2">
        <span className="text-xs text-muted-foreground">{task.assignee_name || '-'}</span>
        <PriorityBadge priority={task.priority} />
      </div>
      {task.due_date && (
        <p className="text-xs text-muted-foreground mt-1">{formatDate(task.due_date)}</p>
      )}
    </Card>
  )
}
