import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { PageContainer } from '@/components/layout/PageContainer'
import { LoadingSpinner, EmptyState, ErrorState } from '@/components/shared/LoadingSpinner'
import { useTasks } from '@/hooks/useTasks'
import type { Task } from '@/types'

interface TeamMember {
  name: string
  id: string | null
  activeTasks: number
  overdueTasks: number
  doneTasks: number
}

export default function Team() {
  const { data, isLoading, error } = useTasks()

  if (isLoading) return <PageContainer><LoadingSpinner /></PageContainer>
  if (error) return <PageContainer><ErrorState message="Erro ao carregar equipe" /></PageContainer>

  const tasks = data?.tasks || []

  // Group tasks by assignee
  const membersMap = new Map<string, TeamMember>()
  tasks.forEach((t: Task) => {
    const name = t.assignee_name || 'Sem responsavel'
    const id = t.assignee_id || 'none'
    if (!membersMap.has(id)) {
      membersMap.set(id, { name, id: t.assignee_id, activeTasks: 0, overdueTasks: 0, doneTasks: 0 })
    }
    const m = membersMap.get(id)!
    if (t.status === 'done') {
      m.doneTasks++
    } else if (t.status !== 'cancelled') {
      m.activeTasks++
      if (t.due_date && new Date(t.due_date) < new Date()) {
        m.overdueTasks++
      }
    }
  })

  const members = Array.from(membersMap.values()).sort((a, b) => b.activeTasks - a.activeTasks)

  return (
    <PageContainer>
      {members.length === 0 ? (
        <EmptyState message="Nenhum membro encontrado" />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {members.map((m) => (
            <Card key={m.id || m.name}>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{m.name}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex gap-2">
                  <Badge variant="default">{m.activeTasks} ativas</Badge>
                  {m.overdueTasks > 0 && <Badge variant="destructive">{m.overdueTasks} atrasadas</Badge>}
                  <Badge variant="success">{m.doneTasks} concluidas</Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </PageContainer>
  )
}
