import { useState } from 'react'
import { Link } from 'react-router-dom'
import { FileText } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PageContainer } from '@/components/layout/PageContainer'
import { LoadingSpinner, EmptyState, ErrorState } from '@/components/shared/LoadingSpinner'
import { useAtas } from '@/hooks/useAtas'
import { useProjects } from '@/hooks/useProjects'
import { formatDate } from '@/lib/utils'

export default function Atas() {
  const [projectFilter, setProjectFilter] = useState<string>('')
  const { data, isLoading, error } = useAtas(projectFilter ? { project_id: projectFilter } : undefined)
  const { data: projectsData } = useProjects()

  return (
    <PageContainer>
      <div className="flex items-center gap-3">
        <Select value={projectFilter} onValueChange={setProjectFilter}>
          <SelectTrigger className="w-52">
            <SelectValue placeholder="Todos os projetos" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os projetos</SelectItem>
            {projectsData?.projects.map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <LoadingSpinner />
      ) : error ? (
        <ErrorState message="Erro ao carregar atas" />
      ) : !data?.atas?.length ? (
        <EmptyState message="Nenhuma ata encontrada" />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {data.atas.map((ata) => (
            <Link key={ata.id} to={`/atas/${ata.id}`}>
              <Card className="hover:shadow-md transition-shadow cursor-pointer h-full">
                <CardHeader className="pb-3">
                  <div className="flex items-start gap-2">
                    <FileText className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                    <CardTitle className="text-base line-clamp-2">{ata.titulo}</CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  {ata.project_name && (
                    <p className="text-sm text-primary/70">{ata.project_name}</p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {ata.data_reuniao ? formatDate(ata.data_reuniao) : formatDate(ata.created_at)}
                  </p>
                  <div className="flex gap-2">
                    {ata.total_acoes != null && <Badge variant="secondary">{ata.total_acoes} acoes</Badge>}
                    {ata.total_decisoes != null && <Badge variant="secondary">{ata.total_decisoes} decisoes</Badge>}
                    {ata.total_riscos != null && <Badge variant="warning">{ata.total_riscos} riscos</Badge>}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </PageContainer>
  )
}
