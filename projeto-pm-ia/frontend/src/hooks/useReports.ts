import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { reportsApi } from '@/services/api'

export function useReports(filters?: { project_id?: string; type?: string }) {
  return useQuery({
    queryKey: ['reports', filters],
    queryFn: () => reportsApi.list(filters),
  })
}

export function useReport(id: string) {
  return useQuery({
    queryKey: ['report', id],
    queryFn: () => reportsApi.get(id),
    enabled: !!id,
  })
}

export function useGenerateReport() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: reportsApi.generate,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reports'] }),
  })
}
