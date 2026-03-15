import { Badge } from '@/components/ui/badge'

const statusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'success' | 'warning' | 'outline' }> = {
  todo: { label: 'A fazer', variant: 'secondary' },
  in_progress: { label: 'Em andamento', variant: 'default' },
  review: { label: 'Revisao', variant: 'warning' },
  done: { label: 'Concluido', variant: 'success' },
  cancelled: { label: 'Cancelado', variant: 'outline' },
  active: { label: 'Ativo', variant: 'success' },
  paused: { label: 'Pausado', variant: 'warning' },
  completed: { label: 'Concluido', variant: 'success' },
  pending: { label: 'Pendente', variant: 'secondary' },
  aguardando_confirmacao: { label: 'Aguardando', variant: 'warning' },
  processando: { label: 'Processando', variant: 'default' },
  processado: { label: 'Processado', variant: 'success' },
  erro: { label: 'Erro', variant: 'destructive' },
}

export function StatusBadge({ status }: { status: string }) {
  const config = statusConfig[status] || { label: status, variant: 'outline' as const }
  return <Badge variant={config.variant}>{config.label}</Badge>
}
