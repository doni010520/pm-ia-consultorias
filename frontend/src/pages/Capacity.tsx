import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { PageContainer } from '@/components/layout/PageContainer'
import { LoadingSpinner, ErrorState, EmptyState } from '@/components/shared/LoadingSpinner'
import { allocationsApi, usersApi } from '@/services/api'
import { useProjects } from '@/hooks/useProjects'
import { Users, Clock, AlertTriangle, TrendingUp, Plus, Pencil } from 'lucide-react'

function UtilizationBar({ percent }: { percent: number }) {
  const color = percent > 100 ? 'bg-red-500' : percent > 80 ? 'bg-amber-500' : 'bg-green-500'
  const width = Math.min(percent, 100)

  return (
    <div className="w-full bg-muted rounded-full h-3 overflow-hidden">
      <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${width}%` }} />
    </div>
  )
}

export default function Capacity() {
  const qc = useQueryClient()
  const { data, isLoading, error } = useQuery({
    queryKey: ['allocations-dashboard'],
    queryFn: () => allocationsApi.dashboard(),
  })

  const [allocModalOpen, setAllocModalOpen] = useState(false)
  const [editCapacityUser, setEditCapacityUser] = useState<{ id: string; name: string; weekly_capacity: number } | null>(null)
  const [newCapacity, setNewCapacity] = useState('')

  const updateCapacity = useMutation({
    mutationFn: ({ userId, capacity }: { userId: string; capacity: number }) =>
      allocationsApi.updateCapacity(userId, capacity),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['allocations-dashboard'] })
      setEditCapacityUser(null)
    },
  })

  if (isLoading) return <PageContainer><LoadingSpinner /></PageContainer>
  if (error) return <PageContainer><ErrorState message="Erro ao carregar capacidade" /></PageContainer>

  const { consultants, summary } = data!

  return (
    <PageContainer>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Capacidade da Equipe</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Controle de alocação de horas por consultor
          </p>
        </div>
        <Button onClick={() => setAllocModalOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Alocar Consultor
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4 mb-6">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Users className="h-8 w-8 text-primary" />
              <div>
                <p className="text-2xl font-bold">{summary.total_consultants}</p>
                <p className="text-xs text-muted-foreground">Consultores</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Clock className="h-8 w-8 text-blue-500" />
              <div>
                <p className="text-2xl font-bold">{summary.total_allocated}h <span className="text-sm font-normal text-muted-foreground">/ {summary.total_capacity}h</span></p>
                <p className="text-xs text-muted-foreground">Alocadas / Capacidade</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <TrendingUp className="h-8 w-8 text-green-500" />
              <div>
                <p className="text-2xl font-bold">{summary.avg_utilization}%</p>
                <p className="text-xs text-muted-foreground">Utilização média</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <AlertTriangle className={`h-8 w-8 ${summary.overallocated_count > 0 ? 'text-red-500' : 'text-muted-foreground'}`} />
              <div>
                <p className="text-2xl font-bold">{summary.overallocated_count}</p>
                <p className="text-xs text-muted-foreground">Superalocados</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Consultants List */}
      {consultants.length === 0 ? (
        <EmptyState message="Nenhum consultor cadastrado" />
      ) : (
        <div className="space-y-4">
          {consultants.map((c) => (
            <Card key={c.id} className={c.utilization_percent > 100 ? 'border-red-300 bg-red-50/50' : ''}>
              <CardContent className="py-5">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold">{c.name}</h3>
                      {c.utilization_percent > 100 && (
                        <Badge variant="destructive" className="text-xs">
                          <AlertTriangle className="h-3 w-3 mr-1" />
                          Superalocado
                        </Badge>
                      )}
                      {c.utilization_percent === 0 && (
                        <Badge variant="outline" className="text-xs text-muted-foreground">Sem alocação</Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">{c.email}</p>
                  </div>
                  <div className="text-right">
                    <div className="flex items-center gap-1">
                      <span className="text-lg font-bold">{c.allocated_hours}h</span>
                      <span className="text-sm text-muted-foreground">/ {c.weekly_capacity}h</span>
                      <button
                        onClick={() => {
                          setEditCapacityUser({ id: c.id, name: c.name, weekly_capacity: c.weekly_capacity })
                          setNewCapacity(c.weekly_capacity.toString())
                        }}
                        className="ml-1 p-1 rounded hover:bg-muted"
                        title="Editar capacidade"
                      >
                        <Pencil className="h-3 w-3 text-muted-foreground" />
                      </button>
                    </div>
                    <p className="text-sm font-medium">{c.utilization_percent}% utilizado</p>
                  </div>
                </div>

                <UtilizationBar percent={c.utilization_percent} />

                {/* Projects breakdown */}
                {c.projects.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {c.projects.map((p, idx) => (
                      <Badge key={idx} variant="secondary" className="text-xs">
                        {p.project_name}: {p.hours_per_week}h/sem
                      </Badge>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Edit Capacity Modal */}
      <Dialog open={!!editCapacityUser} onOpenChange={(open) => !open && setEditCapacityUser(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Capacidade Semanal</DialogTitle>
            <DialogDescription>{editCapacityUser?.name}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Horas por semana</label>
              <input
                type="number"
                step="1"
                min="0"
                max="80"
                value={newCapacity}
                onChange={(e) => setNewCapacity(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <Button
              className="w-full"
              disabled={updateCapacity.isPending}
              onClick={() => {
                if (editCapacityUser) {
                  updateCapacity.mutate({ userId: editCapacityUser.id, capacity: parseFloat(newCapacity) || 40 })
                }
              }}
            >
              {updateCapacity.isPending ? 'Salvando...' : 'Salvar'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Allocate Modal */}
      <AllocateModal
        open={allocModalOpen}
        onOpenChange={setAllocModalOpen}
        onSuccess={() => qc.invalidateQueries({ queryKey: ['allocations-dashboard'] })}
      />
    </PageContainer>
  )
}

function AllocateModal({ open, onOpenChange, onSuccess }: { open: boolean; onOpenChange: (o: boolean) => void; onSuccess: () => void }) {
  const [userId, setUserId] = useState('')
  const [projectId, setProjectId] = useState('')
  const [hours, setHours] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const { data: usersData } = useQuery({
    queryKey: ['users'],
    queryFn: () => usersApi.list(),
    enabled: open,
  })
  const { data: projectsData } = useProjects()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await allocationsApi.create({
        user_id: userId,
        project_id: projectId,
        hours_per_week: parseFloat(hours) || 0,
      })
      onSuccess()
      onOpenChange(false)
      setUserId('')
      setProjectId('')
      setHours('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao alocar')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Alocar Consultor em Projeto</DialogTitle>
          <DialogDescription>Defina quantas horas por semana o consultor dedicará ao projeto.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">{error}</div>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium">Consultor</label>
            <select
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              required
            >
              <option value="">Selecione...</option>
              {usersData?.users.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Projeto</label>
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              required
            >
              <option value="">Selecione...</option>
              {projectsData?.projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Horas por semana</label>
            <input
              type="number"
              step="0.5"
              min="0"
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="Ex: 20"
              required
            />
          </div>

          <Button type="submit" disabled={loading} className="w-full">
            {loading ? 'Alocando...' : 'Alocar'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
