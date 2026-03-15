import { useQuery } from '@tanstack/react-query'
import { atasApi } from '@/services/api'

export function useAtas(filters?: { project_id?: string }) {
  return useQuery({
    queryKey: ['atas', filters],
    queryFn: () => atasApi.list(filters),
  })
}

export function useAta(id: string) {
  return useQuery({
    queryKey: ['ata', id],
    queryFn: () => atasApi.get(id),
    enabled: !!id,
  })
}
