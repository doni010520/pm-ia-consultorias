import { useQuery } from '@tanstack/react-query'
import { alertsApi } from '@/services/api'

export function useAlertSummary(filters?: { project_id?: string }) {
  return useQuery({
    queryKey: ['alerts', 'summary', filters],
    queryFn: () => alertsApi.summary(filters),
  })
}

export function useAlertsToday(filters?: { project_id?: string; assignee_id?: string }) {
  return useQuery({
    queryKey: ['alerts', 'today', filters],
    queryFn: () => alertsApi.today(filters),
  })
}

export function useAlertsOverdue(filters?: { project_id?: string; assignee_id?: string }) {
  return useQuery({
    queryKey: ['alerts', 'overdue', filters],
    queryFn: () => alertsApi.overdue(filters),
  })
}
