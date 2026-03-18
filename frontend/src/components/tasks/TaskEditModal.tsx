import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useUpdateTask, useUpdateTaskStatus } from '@/hooks/useTasks'
import { useProjects } from '@/hooks/useProjects'
import { usersApi } from '@/services/api'
import { useQuery } from '@tanstack/react-query'
import type { Task } from '@/types'

interface TaskEditModalProps {
  task: Task | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

const statusOptions = [
  { value: 'todo', label: 'A Fazer', color: 'bg-gray-100 text-gray-700' },
  { value: 'in_progress', label: 'Em Andamento', color: 'bg-blue-100 text-blue-700' },
  { value: 'review', label: 'Revisão', color: 'bg-amber-100 text-amber-700' },
  { value: 'done', label: 'Concluído', color: 'bg-green-100 text-green-700' },
  { value: 'cancelled', label: 'Cancelado', color: 'bg-red-100 text-red-700' },
]

const priorityOptions = [
  { value: 1, label: 'Baixa' },
  { value: 2, label: 'Média' },
  { value: 3, label: 'Alta' },
  { value: 4, label: 'Urgente' },
]

export function TaskEditModal({ task, open, onOpenChange }: TaskEditModalProps) {
  const updateTask = useUpdateTask()
  const updateStatus = useUpdateTaskStatus()
  const { data: projectsData } = useProjects()
  const { data: usersData } = useQuery({
    queryKey: ['users'],
    queryFn: () => usersApi.list(),
  })

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState('')
  const [priority, setPriority] = useState(2)
  const [assigneeId, setAssigneeId] = useState('')
  const [projectId, setProjectId] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [estimatedHours, setEstimatedHours] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Populate fields when task changes
  useEffect(() => {
    if (task) {
      setTitle(task.title || '')
      setDescription(task.description || '')
      setStatus(task.status || 'todo')
      setPriority(task.priority || 2)
      setAssigneeId(task.assignee_id || '')
      setProjectId(task.project_id || '')
      setDueDate(task.due_date ? task.due_date.split('T')[0] : '')
      setEstimatedHours(task.estimated_hours?.toString() || '')
      setError('')
    }
  }, [task])

  async function handleSave() {
    if (!task) return
    setError('')
    setSaving(true)

    try {
      // Update status separately if changed
      if (status !== task.status) {
        await updateStatus.mutateAsync({ id: task.id, status })
      }

      // Update other fields
      await updateTask.mutateAsync({
        id: task.id,
        data: {
          title,
          description: description || null,
          priority,
          assignee_id: assigneeId || null,
          project_id: projectId || null,
          due_date: dueDate || null,
          estimated_hours: estimatedHours ? parseFloat(estimatedHours) : null,
        },
      })

      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar')
    } finally {
      setSaving(false)
    }
  }

  if (!task) return null

  const projects = projectsData?.projects || []
  const users = usersData?.users || []

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar Tarefa</DialogTitle>
          <DialogDescription>
            {task.source === 'ata' && (
              <Badge variant="outline" className="text-xs">Criada a partir de ata</Badge>
            )}
            {task.source === 'whatsapp' && (
              <Badge variant="outline" className="text-xs">Criada via WhatsApp</Badge>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {error && (
            <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {/* Título */}
          <div className="space-y-2">
            <label htmlFor="task-title" className="text-sm font-medium">Título</label>
            <input
              id="task-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              required
            />
          </div>

          {/* Descrição */}
          <div className="space-y-2">
            <label htmlFor="task-desc" className="text-sm font-medium">Descrição</label>
            <textarea
              id="task-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
            />
          </div>

          {/* Status + Prioridade (lado a lado) */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label htmlFor="task-status" className="text-sm font-medium">Status</label>
              <select
                id="task-status"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {statusOptions.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label htmlFor="task-priority" className="text-sm font-medium">Prioridade</label>
              <select
                id="task-priority"
                value={priority}
                onChange={(e) => setPriority(Number(e.target.value))}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {priorityOptions.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Projeto */}
          <div className="space-y-2">
            <label htmlFor="task-project" className="text-sm font-medium">Projeto</label>
            <select
              id="task-project"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">Sem projeto</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          {/* Responsável */}
          <div className="space-y-2">
            <label htmlFor="task-assignee" className="text-sm font-medium">Responsável</label>
            <select
              id="task-assignee"
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">Sem responsável</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </div>

          {/* Data de entrega + Horas estimadas (lado a lado) */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label htmlFor="task-due" className="text-sm font-medium">Data de entrega</label>
              <input
                id="task-due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="task-hours" className="text-sm font-medium">Horas estimadas</label>
              <input
                id="task-hours"
                type="number"
                step="0.5"
                min="0"
                value={estimatedHours}
                onChange={(e) => setEstimatedHours(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="0"
              />
            </div>
          </div>

          {/* Metadados (readonly) */}
          <div className="border-t pt-3 space-y-1">
            <p className="text-xs text-muted-foreground">
              Criada em {new Date(task.created_at).toLocaleString('pt-BR')}
              {task.source && <> · Origem: {task.source}</>}
            </p>
            {task.updated_at && (
              <p className="text-xs text-muted-foreground">
                Atualizada em {new Date(task.updated_at).toLocaleString('pt-BR')}
              </p>
            )}
          </div>

          {/* Botões */}
          <div className="flex gap-3 pt-2">
            <Button onClick={handleSave} disabled={saving || !title.trim()} className="flex-1">
              {saving ? 'Salvando...' : 'Salvar'}
            </Button>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
