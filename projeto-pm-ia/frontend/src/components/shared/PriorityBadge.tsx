import { Badge } from '@/components/ui/badge'

const priorityConfig: Record<number, { label: string; variant: 'destructive' | 'warning' | 'secondary' | 'outline' }> = {
  1: { label: 'Baixa', variant: 'outline' },
  2: { label: 'Media', variant: 'secondary' },
  3: { label: 'Alta', variant: 'warning' },
  4: { label: 'Urgente', variant: 'destructive' },
}

export function PriorityBadge({ priority }: { priority: number | null | undefined }) {
  const p = priority || 2
  const config = priorityConfig[p] || priorityConfig[2]
  return <Badge variant={config.variant}>{config.label}</Badge>
}
