import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { User, ArrowLeft, Target, Plus, Phone, Mail, Building2, Briefcase } from 'lucide-react'
import { PageContainer } from '@/components/layout/PageContainer'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { LoadingSpinner, ErrorState } from '@/components/shared/LoadingSpinner'
import { NewDealDialog } from '@/components/crm/NewDealDialog'
import { usePipelineStages } from '@/hooks/usePipelineStages'
import { crmApi } from '@/services/api'
import { formatCurrency } from '@/lib/utils'

export default function ContatoDetail() {
  const { id } = useParams<{ id: string }>()
  const { stages, pipelineId } = usePipelineStages()
  const [showNewDeal, setShowNewDeal] = useState(false)

  const { data, isLoading, error } = useQuery({
    queryKey: ['crm-contact', id],
    queryFn: () => crmApi.contacts.get(id!),
    enabled: !!id,
  })

  if (isLoading) return <PageContainer><LoadingSpinner /></PageContainer>
  if (error || !data) return <PageContainer><ErrorState message="Erro ao carregar contato" /></PageContainer>

  const contact = data.contact
  const deals = data.deals ?? []
  const openDeals = deals.filter(d => d.status === 'open')
  const pipelineValue = openDeals.reduce((s, d) => s + (Number(d.value) || 0), 0)

  return (
    <PageContainer>
      <div className="flex items-start gap-3">
        <Button variant="ghost" size="icon" className="mt-1" onClick={() => window.history.back()}><ArrowLeft className="h-4 w-4" /></Button>
        <div className="flex items-start gap-3 flex-1">
          <div className="h-11 w-11 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
            <User className="h-5 w-5 text-slate-500" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{contact.name}</h1>
            <div className="flex items-center gap-3 mt-1 text-sm text-slate-500 flex-wrap">
              {contact.role && <span className="flex items-center gap-1"><Briefcase className="h-3 w-3" />{contact.role}</span>}
              {contact.company_id && (
                <Link to={`/crm/empresas/${contact.company_id}`} className="flex items-center gap-1 text-indigo-600 hover:underline">
                  <Building2 className="h-3 w-3" />{contact.company_name || 'Empresa'}
                </Link>
              )}
              {contact.phone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{contact.phone}</span>}
              {contact.email && <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{contact.email}</span>}
            </div>
          </div>
        </div>
        <Button onClick={() => setShowNewDeal(true)}><Plus className="h-4 w-4 mr-1.5" /> Novo Negócio</Button>
      </div>

      <div className="grid grid-cols-2 gap-3 max-w-md">
        <Card><CardContent className="py-3 text-center"><p className="text-xl font-bold">{openDeals.length}</p><p className="text-xs text-slate-500">Negócios abertos</p></CardContent></Card>
        <Card><CardContent className="py-3 text-center"><p className="text-xl font-bold text-emerald-600">{formatCurrency(pipelineValue)}</p><p className="text-xs text-slate-500">Em aberto</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-1.5"><Target className="h-4 w-4" /> Negócios ({deals.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {deals.length === 0 ? (
            <p className="text-sm text-slate-400 py-4 text-center">Nenhum negócio para este contato ainda</p>
          ) : deals.map(d => (
            <div key={d.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{d.title}</p>
                <p className="text-xs text-slate-400 truncate">{d.stage_name || '—'}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-sm font-medium">{formatCurrency(d.value)}</span>
                <Badge variant="outline" className={`text-[10px] ${d.status === 'won' ? 'text-emerald-600 border-emerald-200' : d.status === 'lost' ? 'text-red-500 border-red-200' : 'text-slate-500'}`}>
                  {d.status === 'won' ? 'Ganho' : d.status === 'lost' ? 'Perdido' : 'Aberto'}
                </Badge>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {showNewDeal && (
        <NewDealDialog
          stages={stages}
          pipelineId={pipelineId}
          presetCompany={contact.company_id ? { id: contact.company_id, name: contact.company_name ?? '' } : undefined}
          presetContact={{ id: contact.id, name: contact.name, phone: contact.phone, email: contact.email }}
          onClose={() => setShowNewDeal(false)}
        />
      )}
    </PageContainer>
  )
}
