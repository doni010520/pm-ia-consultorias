import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Building2, ArrowLeft, Users, Target, Plus, User, Phone, Mail, MapPin, Globe,
} from 'lucide-react'
import { PageContainer } from '@/components/layout/PageContainer'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { LoadingSpinner, ErrorState } from '@/components/shared/LoadingSpinner'
import { NewDealDialog } from '@/components/crm/NewDealDialog'
import { usePipelineStages } from '@/hooks/usePipelineStages'
import { crmApi } from '@/services/api'
import { formatCurrency } from '@/lib/utils'

function AddContactModal({ companyId, onClose }: { companyId: string; onClose: () => void }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({ name: '', phone: '', email: '', role: '' })
  const u = (f: string, v: string) => setForm(p => ({ ...p, [f]: v }))
  const createMutation = useMutation({
    mutationFn: () => crmApi.contacts.create({
      company_id: companyId, name: form.name.trim(),
      phone: form.phone.trim() || null, email: form.email.trim() || null, role: form.role.trim() || null,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['crm-company', companyId] }); onClose() },
  })
  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Novo Contato</DialogTitle>
          <DialogDescription>Adicione um contato a esta empresa.</DialogDescription>
        </DialogHeader>
        <form onSubmit={e => { e.preventDefault(); if (form.name.trim()) createMutation.mutate() }} className="space-y-3">
          <Input placeholder="Nome do contato *" value={form.name} onChange={e => u('name', e.target.value)} className="text-sm" />
          <div className="grid grid-cols-2 gap-2">
            <Input placeholder="Telefone" value={form.phone} onChange={e => u('phone', e.target.value)} className="text-sm" />
            <Input placeholder="E-mail" value={form.email} onChange={e => u('email', e.target.value)} className="text-sm" />
          </div>
          <Input placeholder="Cargo/Função" value={form.role} onChange={e => u('role', e.target.value)} className="text-sm" />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={!form.name.trim() || createMutation.isPending}>{createMutation.isPending ? 'Salvando...' : 'Adicionar'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default function EmpresaDetail() {
  const { id } = useParams<{ id: string }>()
  const { stages, pipelineId } = usePipelineStages()
  const [showAddContact, setShowAddContact] = useState(false)
  const [newDeal, setNewDeal] = useState<{ contactId?: string; contactName?: string } | null>(null)

  const { data, isLoading, error } = useQuery({
    queryKey: ['crm-company', id],
    queryFn: () => crmApi.companies.get(id!),
    enabled: !!id,
  })

  if (isLoading) return <PageContainer><LoadingSpinner /></PageContainer>
  if (error || !data) return <PageContainer><ErrorState message="Erro ao carregar empresa" /></PageContainer>

  const company = data.company
  const contacts = data.contacts ?? []
  const deals = data.deals ?? []
  const openDeals = deals.filter(d => d.status === 'open')
  const pipelineValue = openDeals.reduce((s, d) => s + (Number(d.value) || 0), 0)

  return (
    <PageContainer>
      <div className="flex items-start gap-3">
        <Link to="/crm/empresas"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
        <div className="flex items-start gap-3 flex-1">
          <div className="h-11 w-11 rounded-lg bg-indigo-50 flex items-center justify-center shrink-0">
            <Building2 className="h-5 w-5 text-indigo-500" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{company.name}</h1>
            <div className="flex items-center gap-3 mt-1 text-sm text-slate-500 flex-wrap">
              {company.segment && <span>{company.segment}</span>}
              {company.cnpj && <span>CNPJ: {company.cnpj}</span>}
              {(company.city || company.state) && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{[company.city, company.state].filter(Boolean).join('/')}</span>}
              {company.phone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{company.phone}</span>}
              {company.email && <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{company.email}</span>}
              {company.website && <a href={company.website} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-indigo-600 hover:underline"><Globe className="h-3 w-3" />site</a>}
            </div>
          </div>
        </div>
      </div>

      {/* Métricas */}
      <div className="grid grid-cols-3 gap-3">
        <Card><CardContent className="py-3 text-center"><p className="text-xl font-bold">{contacts.length}</p><p className="text-xs text-slate-500">Contatos</p></CardContent></Card>
        <Card><CardContent className="py-3 text-center"><p className="text-xl font-bold">{openDeals.length}</p><p className="text-xs text-slate-500">Negócios abertos</p></CardContent></Card>
        <Card><CardContent className="py-3 text-center"><p className="text-xl font-bold text-emerald-600">{formatCurrency(pipelineValue)}</p><p className="text-xs text-slate-500">Em aberto</p></CardContent></Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* CONTATOS */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm flex items-center gap-1.5"><Users className="h-4 w-4" /> Contatos ({contacts.length})</CardTitle>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setShowAddContact(true)}><Plus className="h-3 w-3 mr-1" /> Contato</Button>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {contacts.length === 0 ? (
              <p className="text-sm text-slate-400 py-2 text-center">Nenhum contato ainda</p>
            ) : contacts.map(c => (
              <div key={c.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
                <Link to={`/crm/contatos/${c.id}`} className="min-w-0 flex items-center gap-2 hover:text-indigo-600">
                  <div className="h-7 w-7 rounded-full bg-slate-100 flex items-center justify-center shrink-0"><User className="h-3.5 w-3.5 text-slate-500" /></div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{c.name}</p>
                    <p className="text-xs text-slate-400 truncate">{c.role || c.phone || c.email || '—'}</p>
                  </div>
                </Link>
                <Button size="sm" variant="ghost" className="h-7 text-xs shrink-0" onClick={() => setNewDeal({ contactId: c.id, contactName: c.name })}>
                  <Plus className="h-3 w-3 mr-1" /> Negócio
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* NEGÓCIOS */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-1.5"><Target className="h-4 w-4" /> Negócios ({deals.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {deals.length === 0 ? (
              <p className="text-sm text-slate-400 py-2 text-center">Nenhum negócio ainda</p>
            ) : deals.map(d => (
              <div key={d.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{d.title}</p>
                  <p className="text-xs text-slate-400 truncate">{d.contact_name || '—'}{d.stage_name ? ` · ${d.stage_name}` : ''}</p>
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
      </div>

      {showAddContact && id && <AddContactModal companyId={id} onClose={() => setShowAddContact(false)} />}
      {newDeal && (
        <NewDealDialog
          stages={stages}
          pipelineId={pipelineId}
          presetCompany={{ id: company.id, name: company.name }}
          presetContact={newDeal.contactId ? { id: newDeal.contactId, name: newDeal.contactName ?? '' } : undefined}
          onClose={() => setNewDeal(null)}
        />
      )}
    </PageContainer>
  )
}
