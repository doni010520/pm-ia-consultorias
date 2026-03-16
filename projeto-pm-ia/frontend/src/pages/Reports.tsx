import { useState } from 'react'
import { Plus, FileText } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from '@/components/ui/dialog'
import { PageContainer } from '@/components/layout/PageContainer'
import { MarkdownRenderer } from '@/components/shared/MarkdownRenderer'
import { LoadingSpinner, EmptyState, ErrorState } from '@/components/shared/LoadingSpinner'
import { useReports, useGenerateReport } from '@/hooks/useReports'
import { useProjects } from '@/hooks/useProjects'
import { formatDate } from '@/lib/utils'
import type { Report } from '@/types'

const typeLabels: Record<string, string> = {
  weekly_status: 'Semanal',
  monthly_closing: 'Mensal',
  executive_summary: 'Executivo',
}

export default function Reports() {
  const { data, isLoading, error } = useReports()
  const { data: projectsData } = useProjects()
  const generateReport = useGenerateReport()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [viewReport, setViewReport] = useState<Report | null>(null)

  const handleGenerate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    await generateReport.mutateAsync({
      project_id: form.get('project_id') as string,
      type: form.get('type') as string,
    })
    setDialogOpen(false)
  }

  return (
    <PageContainer>
      <div className="flex items-center justify-between">
        <h3 className="text-sm text-muted-foreground">{data?.count || 0} relatorio(s)</h3>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-1" /> Gerar Relatorio</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Gerar Relatorio</DialogTitle>
              <DialogDescription>Selecione o projeto e tipo de relatorio</DialogDescription>
            </DialogHeader>
            <form onSubmit={handleGenerate} className="space-y-4">
              <div>
                <label className="text-sm font-medium">Projeto *</label>
                <select name="project_id" required className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm mt-1">
                  <option value="">Selecione...</option>
                  {projectsData?.projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium">Tipo</label>
                <select name="type" className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm mt-1">
                  <option value="weekly_status">Semanal</option>
                  <option value="monthly_closing">Mensal</option>
                  <option value="executive_summary">Executivo</option>
                </select>
              </div>
              <Button type="submit" className="w-full" disabled={generateReport.isPending}>
                {generateReport.isPending ? 'Gerando com IA...' : 'Gerar Relatorio'}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Report viewer modal */}
      {viewReport && (
        <Dialog open={!!viewReport} onOpenChange={() => setViewReport(null)}>
          <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{viewReport.title}</DialogTitle>
              <DialogDescription>
                {formatDate(viewReport.period_start)} - {formatDate(viewReport.period_end)}
              </DialogDescription>
            </DialogHeader>
            <MarkdownRenderer content={viewReport.content_markdown} />
          </DialogContent>
        </Dialog>
      )}

      {isLoading ? (
        <LoadingSpinner />
      ) : error ? (
        <ErrorState message="Erro ao carregar relatorios" />
      ) : !data?.reports.length ? (
        <EmptyState message="Nenhum relatorio gerado" />
      ) : (
        <div className="space-y-3">
          {data.reports.map((r) => (
            <Card key={r.id} className="cursor-pointer hover:shadow-sm" onClick={() => setViewReport(r)}>
              <CardContent className="py-4 flex items-center gap-4">
                <FileText className="h-5 w-5 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{r.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {r.project_name} | {formatDate(r.period_start)} - {formatDate(r.period_end)}
                  </p>
                </div>
                <Badge variant="secondary">{typeLabels[r.type] || r.type}</Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </PageContainer>
  )
}
