import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { projectsApi } from '@/services/api'

export function useProjects(filters?: { status?: string; client_id?: string }) {
  return useQuery({
    queryKey: ['projects', filters],
    queryFn: () => projectsApi.list(filters),
  })
}

export function useProject(id: string) {
  return useQuery({
    queryKey: ['project', id],
    queryFn: () => projectsApi.get(id),
    enabled: !!id,
  })
}

export function useProjectMetrics(id: string) {
  return useQuery({
    queryKey: ['project-metrics', id],
    queryFn: () => projectsApi.getMetrics(id),
    enabled: !!id,
  })
}

export function useProjectTasks(id: string) {
  return useQuery({
    queryKey: ['project-tasks', id],
    queryFn: () => projectsApi.getTasks(id),
    enabled: !!id,
  })
}

export function useProjectRiskAnalysis(id: string) {
  return useQuery({
    queryKey: ['project-risk', id],
    queryFn: () => projectsApi.getRiskAnalysis(id),
    enabled: false, // manual trigger
  })
}

export function useCreateProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: projectsApi.create,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects'] }),
  })
}

export function useUpdateProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      projectsApi.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] })
      qc.invalidateQueries({ queryKey: ['project'] })
    },
  })
}
