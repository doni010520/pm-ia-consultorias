import { useQuery } from '@tanstack/react-query'
import { crmApi } from '@/services/api'

/**
 * Retorna as etapas do primeiro funil ativo + o id desse funil.
 * Usado para abrir o NewDealDialog fora do board do CRM.
 */
export function usePipelineStages() {
  const { data: pipelinesData } = useQuery({
    queryKey: ['crm-pipelines'],
    queryFn: () => crmApi.pipelines.list(),
  })
  const pipelineId = pipelinesData?.pipelines?.[0]?.id ?? null

  const { data: stagesData } = useQuery({
    queryKey: ['crm-stages', pipelineId],
    queryFn: () => crmApi.pipeline(pipelineId ?? undefined),
    enabled: !!pipelineId,
  })

  return { stages: stagesData?.stages ?? [], pipelineId }
}
