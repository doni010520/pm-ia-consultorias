import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from '@/components/ui/dialog'
import { PageContainer } from '@/components/layout/PageContainer'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Progress } from '@/components/ui/progress'
import { LoadingSpinner, EmptyState, ErrorState } from '@/components/shared/LoadingSpinner'
import { useProjects, useCreateProject } from '@/hooks/useProjects'
import { formatDate, formatCurrency, formatHours } from '@/lib/utils'

export default function Projects() {
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const { data, isLoading, error } = useProjects(statusFilter ? { status: statusFilter } : undefined)
  const createProject = useCreateProject()

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    await createProject.mutateAsync({
      name: form.get('name') as string,
      description: form.get('description') as string,
      due_date: form.get('due_date') as string || undefined,
      budget_hours: form.get('budget_hours') ? Number(form.get('budget_hours')) : undefined,
      budget_value: form.get('budget_value') ? Number(form.get('budget_value')) : undefined,
      billing_type: form.get('billing_type') as string || 'hourly',
    })
    setDialogOpen(false)
  }

  return (
    <PageContainer>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Todos status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="active">Ativos</SelectItem>
              <SelectItem value="paused">Pausados</SelectItem>
              <SelectItem value="completed">Concluidos</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-1" /> Novo Projeto</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Novo Projeto</DialogTitle>
              <DialogDescription>Preencha os dados do novo projeto</DialogDescription>
            </DialogHeader>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="text-sm font-medium">Nome *</label>
                <Input name="name" required placeholder="Nome do projeto" />
              </div>
              <div>
                <label className="text-sm font-medium">Descricao</label>
                <Textarea name="description" placeholder="Descricao do projeto" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium">Prazo</label>
                  <Input name="due_date" type="date" />
                </div>
                <div>
                  <label className="text-sm font-medium">Tipo de cobranca</label>
                  <Select name="billing_type" defaultValue="hourly">
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="hourly">Por hora</SelectItem>
                      <SelectItem value="fixed">Preco fixo</SelectItem>
                      <SelectItem value="retainer">Retainer</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium">Orcamento (horas)</label>
                  <Input name="budget_hours" type="number" placeholder="0" />
                </div>
                <div>
                  <label className="text-sm font-medium">Orcamento (R$)</label>
                  <Input name="budget_value" type="number" step="0.01" placeholder="0.00" />
                </div>
              </div>
              <Button type="submit" className="w-full" disabled={createProject.isPending}>
                {createProject.isPending ? 'Criando...' : 'Criar Projeto'}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <LoadingSpinner />
      ) : error ? (
        <ErrorState message="Erro ao carregar projetos" />
      ) : !data?.projects.length ? (
        <EmptyState message="Nenhum projeto encontrado" />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {data.projects.map((p) => (
            <Link key={p.id} to={`/projects/${p.id}`}>
              <Card className="hover:shadow-md transition-shadow cursor-pointer h-full">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <CardTitle className="text-base line-clamp-1">{p.name}</CardTitle>
                    <StatusBadge status={p.status} />
                  </div>
                  <p className="text-sm text-muted-foreground">{p.client_name || 'Sem cliente'}</p>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Progress value={p.progress_percent || 0} className="flex-1 h-2" />
                    <span className="text-xs text-muted-foreground">{p.progress_percent || 0}%</span>
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Prazo: {formatDate(p.due_date)}</span>
                    <span>
                      {p.completed_tasks || 0}/{p.total_tasks || 0} tarefas
                    </span>
                  </div>
                  {p.budget_hours && (
                    <div className="text-xs text-muted-foreground">
                      Orcamento: {formatHours(p.budget_hours)}
                      {p.budget_value ? ` | ${formatCurrency(p.budget_value)}` : ''}
                    </div>
                  )}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </PageContainer>
  )
}
