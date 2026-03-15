import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, CheckCircle, Lightbulb, AlertTriangle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PageContainer } from '@/components/layout/PageContainer'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { MarkdownRenderer } from '@/components/shared/MarkdownRenderer'
import { LoadingSpinner, ErrorState, EmptyState } from '@/components/shared/LoadingSpinner'
import { useAta } from '@/hooks/useAtas'
import { formatDate } from '@/lib/utils'

export default function AtaDetail() {
  const { id } = useParams<{ id: string }>()
  const { data, isLoading, error } = useAta(id!)

  if (isLoading) return <PageContainer><LoadingSpinner /></PageContainer>
  if (error || !data) return <PageContainer><ErrorState message="Erro ao carregar ata" /></PageContainer>

  const { ata, acoes, decisoes, riscos } = data

  return (
    <PageContainer>
      <div className="flex items-start gap-4">
        <Link to="/atas">
          <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold">{ata.titulo}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {ata.data_reuniao ? formatDate(ata.data_reuniao) : formatDate(ata.created_at)}
            {ata.project_name && ` | ${ata.project_name}`}
          </p>
          {ata.participantes?.length > 0 && (
            <p className="text-xs text-muted-foreground mt-1">
              Participantes: {ata.participantes.join(', ')}
            </p>
          )}
        </div>
      </div>

      {ata.resumo_executivo && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Resumo Executivo</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">{ata.resumo_executivo}</p>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="content">
        <TabsList>
          <TabsTrigger value="content">Conteudo</TabsTrigger>
          <TabsTrigger value="acoes">Acoes ({acoes.length})</TabsTrigger>
          <TabsTrigger value="decisoes">Decisoes ({decisoes.length})</TabsTrigger>
          <TabsTrigger value="riscos">Riscos ({riscos.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="content">
          <Card>
            <CardContent className="pt-6">
              <MarkdownRenderer content={ata.conteudo_markdown} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="acoes">
          {acoes.length === 0 ? (
            <EmptyState message="Nenhuma acao registrada" />
          ) : (
            <div className="space-y-3">
              {acoes.map((a) => (
                <Card key={a.id}>
                  <CardContent className="pt-4">
                    <div className="flex items-start gap-3">
                      <CheckCircle className="h-4 w-4 mt-0.5 text-primary shrink-0" />
                      <div className="flex-1">
                        <p className="text-sm font-medium">{a.descricao}</p>
                        <div className="flex flex-wrap gap-2 mt-2">
                          {a.responsavel_nome && <Badge variant="secondary">{a.responsavel_nome}</Badge>}
                          {a.prazo && <Badge variant="outline">Prazo: {formatDate(a.prazo)}</Badge>}
                          {a.tipo && <Badge variant="outline">{a.tipo}</Badge>}
                          <StatusBadge status={a.status} />
                        </div>
                        {a.evidencia_minima && (
                          <p className="text-xs text-muted-foreground mt-2">Evidencia: {a.evidencia_minima}</p>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="decisoes">
          {decisoes.length === 0 ? (
            <EmptyState message="Nenhuma decisao registrada" />
          ) : (
            <div className="space-y-3">
              {decisoes.map((d) => (
                <Card key={d.id}>
                  <CardContent className="pt-4">
                    <div className="flex items-start gap-3">
                      <Lightbulb className="h-4 w-4 mt-0.5 text-warning shrink-0" />
                      <div>
                        <p className="text-sm font-medium">{d.descricao}</p>
                        {d.justificativa && <p className="text-xs text-muted-foreground mt-1">Justificativa: {d.justificativa}</p>}
                        {d.impacto && <p className="text-xs text-muted-foreground mt-1">Impacto: {d.impacto}</p>}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="riscos">
          {riscos.length === 0 ? (
            <EmptyState message="Nenhum risco registrado" />
          ) : (
            <div className="space-y-3">
              {riscos.map((r) => (
                <Card key={r.id}>
                  <CardContent className="pt-4">
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="h-4 w-4 mt-0.5 text-destructive shrink-0" />
                      <div>
                        <p className="text-sm font-medium">{r.descricao}</p>
                        <div className="flex gap-2 mt-2">
                          {r.probabilidade && <Badge variant="warning">Prob: {r.probabilidade}</Badge>}
                          {r.impacto && <Badge variant="destructive">Impacto: {r.impacto}</Badge>}
                        </div>
                        {r.mitigacao && <p className="text-xs text-muted-foreground mt-2">Mitigacao: {r.mitigacao}</p>}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </PageContainer>
  )
}
