import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Building2, User, Check, Plus, Search, X, GitBranch } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { crmApi } from '@/services/api'
import type { PipelineStage, Contact } from '@/types'

interface Selected { id: string; name: string }

export function NewDealDialog({
  stages, pipelineId, onClose, onCreated, presetCompany, presetContact,
}: {
  stages: PipelineStage[]
  pipelineId: string | null
  onClose: () => void
  onCreated?: () => void
  presetCompany?: Selected
  presetContact?: Selected & { phone?: string | null; email?: string | null }
}) {
  const queryClient = useQueryClient()

  const [company, setCompany] = useState<Selected | null>(presetCompany ?? null)
  const [contact, setContact] = useState<(Selected & { phone?: string | null; email?: string | null }) | null>(presetContact ?? null)

  // ── Funil (pipeline) selecionável ─────────────────────────────────────────
  const [selectedPipelineId, setSelectedPipelineId] = useState<string | null>(pipelineId)
  const { data: pipelinesData } = useQuery({
    queryKey: ['crm-pipelines'],
    queryFn: () => crmApi.pipelines.list(),
  })
  const pipelines = pipelinesData?.pipelines ?? []
  // Se nenhum funil veio por prop, usa o primeiro assim que a lista carrega.
  useEffect(() => {
    if (!selectedPipelineId && pipelines.length) setSelectedPipelineId(pipelines[0].id)
  }, [pipelines.length, selectedPipelineId])

  // Etapas do funil selecionado (usa as `stages` da prop como cache inicial se bater).
  const { data: stagesData } = useQuery({
    queryKey: ['crm-stages', selectedPipelineId],
    queryFn: () => crmApi.pipeline(selectedPipelineId ?? undefined),
    enabled: !!selectedPipelineId,
    initialData: selectedPipelineId && selectedPipelineId === pipelineId ? { stages } : undefined,
  })
  const activeStages = (stagesData?.stages ?? stages)
    .filter(s => !s.is_won && !s.is_lost)
    .sort((a, b) => a.position - b.position)

  // Fields do negócio (pipeline_stage_id vazio = usa a 1ª etapa do funil atual)
  const [form, setForm] = useState({
    title: '', value: '', temperature: 'warm', source: 'inbound', pipeline_stage_id: '',
  })
  const u = (f: string, v: string) => setForm(p => ({ ...p, [f]: v }))
  const effectiveStageId = form.pipeline_stage_id || activeStages[0]?.id || ''

  // ── Empresa: busca + criar ──────────────────────────────────────────────
  const [companySearch, setCompanySearch] = useState('')
  const [showNewCompany, setShowNewCompany] = useState(false)
  const [newCompany, setNewCompany] = useState({ name: '', cnpj: '', segment: '' })
  const { data: companyResults } = useQuery({
    queryKey: ['deal-company-search', companySearch],
    queryFn: () => crmApi.companies.search(companySearch),
    enabled: !company && companySearch.length >= 2,
  })
  const createCompanyMutation = useMutation({
    mutationFn: () => crmApi.companies.create({
      name: newCompany.name.trim(), cnpj: newCompany.cnpj.trim() || null, segment: newCompany.segment.trim() || null,
    }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['crm-companies'] })
      setCompany({ id: res.company.id, name: res.company.name })
      setShowNewCompany(false)
      setNewCompany({ name: '', cnpj: '', segment: '' })
    },
  })

  // ── Contatos da empresa ─────────────────────────────────────────────────
  const { data: contactsData } = useQuery({
    queryKey: ['deal-company-contacts', company?.id],
    queryFn: () => crmApi.companies.get(company!.id),
    enabled: !!company && !presetContact,
  })
  const companyContacts: Contact[] = contactsData?.contacts ?? []
  const [showNewContact, setShowNewContact] = useState(false)
  const [newContact, setNewContact] = useState({ name: '', phone: '', email: '', role: '' })
  const createContactMutation = useMutation({
    mutationFn: () => crmApi.contacts.create({
      company_id: company!.id, name: newContact.name.trim(),
      phone: newContact.phone.trim() || null, email: newContact.email.trim() || null, role: newContact.role.trim() || null,
    }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['deal-company-contacts', company?.id] })
      setContact({ id: res.contact.id, name: res.contact.name, phone: res.contact.phone, email: res.contact.email })
      setShowNewContact(false)
      setNewContact({ name: '', phone: '', email: '', role: '' })
    },
  })

  // ── Criar negócio ───────────────────────────────────────────────────────
  const createDealMutation = useMutation({
    mutationFn: (d: Record<string, unknown>) => crmApi.deals.create(d),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['crm-deals'] })
      queryClient.invalidateQueries({ queryKey: ['crm-stats'] })
      queryClient.invalidateQueries({ queryKey: ['crm-pipelines'] })
      queryClient.invalidateQueries({ queryKey: ['crm-company'] })
      queryClient.invalidateQueries({ queryKey: ['crm-contact'] })
      onCreated?.()
      onClose()
    },
  })

  const canSubmit = !!company && !!contact && form.title.trim().length > 0 && !!selectedPipelineId && !!effectiveStageId
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    createDealMutation.mutate({
      title: form.title.trim(),
      company_id: company!.id,
      contact_id: contact!.id,
      company_name: company!.name,
      contact_name: contact!.name,
      contact_phone: contact?.phone ?? null,
      contact_email: contact?.email ?? null,
      value: form.value ? parseFloat(form.value) : null,
      temperature: form.temperature,
      source: form.source,
      pipeline_stage_id: effectiveStageId,
      pipeline_id: selectedPipelineId,
    })
  }

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Novo Negócio</DialogTitle>
          <DialogDescription>Todo negócio pertence a um contato de uma empresa.</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* PASSO 1 — EMPRESA */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
              <Building2 className="h-3.5 w-3.5" /> 1. Empresa
            </label>
            {company ? (
              <div className="flex items-center justify-between rounded-md border bg-emerald-50/50 border-emerald-200 px-3 py-2">
                <span className="text-sm font-medium text-slate-700 flex items-center gap-1.5"><Check className="h-3.5 w-3.5 text-emerald-600" />{company.name}</span>
                {!presetCompany && (
                  <button type="button" onClick={() => { setCompany(null); setContact(null) }} className="text-slate-400 hover:text-slate-600"><X className="h-3.5 w-3.5" /></button>
                )}
              </div>
            ) : showNewCompany ? (
              <div className="space-y-2 rounded-md border p-2.5 bg-slate-50">
                <Input placeholder="Nome da empresa *" value={newCompany.name} onChange={e => setNewCompany(p => ({ ...p, name: e.target.value }))} className="h-8 text-sm bg-white" />
                <div className="grid grid-cols-2 gap-2">
                  <Input placeholder="CNPJ" value={newCompany.cnpj} onChange={e => setNewCompany(p => ({ ...p, cnpj: e.target.value }))} className="h-8 text-sm bg-white" />
                  <Input placeholder="Segmento" value={newCompany.segment} onChange={e => setNewCompany(p => ({ ...p, segment: e.target.value }))} className="h-8 text-sm bg-white" />
                </div>
                <div className="flex gap-2">
                  <Button type="button" size="sm" className="h-7 text-xs" disabled={!newCompany.name.trim() || createCompanyMutation.isPending} onClick={() => createCompanyMutation.mutate()}>Criar empresa</Button>
                  <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowNewCompany(false)}>Cancelar</Button>
                </div>
              </div>
            ) : (
              <div className="space-y-1.5">
                <div className="relative">
                  <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <Input placeholder="Buscar empresa..." value={companySearch} onChange={e => setCompanySearch(e.target.value)} className="h-8 text-sm pl-8" />
                </div>
                {companyResults && companyResults.companies.length > 0 && (
                  <div className="border rounded-md divide-y max-h-40 overflow-y-auto">
                    {companyResults.companies.map(c => (
                      <button type="button" key={c.id} onClick={() => { setCompany({ id: c.id, name: c.name }); setCompanySearch('') }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-slate-50">
                        {c.name}{c.segment && <span className="text-slate-400 text-xs"> · {c.segment}</span>}
                      </button>
                    ))}
                  </div>
                )}
                <button type="button" onClick={() => setShowNewCompany(true)} className="text-xs text-indigo-600 hover:text-indigo-800 flex items-center gap-1"><Plus className="h-3 w-3" /> Nova empresa</button>
              </div>
            )}
          </div>

          {/* PASSO 2 — CONTATO */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
              <User className="h-3.5 w-3.5" /> 2. Contato
            </label>
            {!company ? (
              <p className="text-xs text-slate-400">Selecione a empresa primeiro.</p>
            ) : contact ? (
              <div className="flex items-center justify-between rounded-md border bg-emerald-50/50 border-emerald-200 px-3 py-2">
                <span className="text-sm font-medium text-slate-700 flex items-center gap-1.5"><Check className="h-3.5 w-3.5 text-emerald-600" />{contact.name}{contact.phone && <span className="text-xs text-slate-400">· {contact.phone}</span>}</span>
                {!presetContact && (
                  <button type="button" onClick={() => setContact(null)} className="text-slate-400 hover:text-slate-600"><X className="h-3.5 w-3.5" /></button>
                )}
              </div>
            ) : showNewContact ? (
              <div className="space-y-2 rounded-md border p-2.5 bg-slate-50">
                <Input placeholder="Nome do contato *" value={newContact.name} onChange={e => setNewContact(p => ({ ...p, name: e.target.value }))} className="h-8 text-sm bg-white" />
                <div className="grid grid-cols-2 gap-2">
                  <Input placeholder="Telefone" value={newContact.phone} onChange={e => setNewContact(p => ({ ...p, phone: e.target.value }))} className="h-8 text-sm bg-white" />
                  <Input placeholder="E-mail" value={newContact.email} onChange={e => setNewContact(p => ({ ...p, email: e.target.value }))} className="h-8 text-sm bg-white" />
                </div>
                <div className="flex gap-2">
                  <Button type="button" size="sm" className="h-7 text-xs" disabled={!newContact.name.trim() || createContactMutation.isPending} onClick={() => createContactMutation.mutate()}>Criar contato</Button>
                  <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowNewContact(false)}>Cancelar</Button>
                </div>
              </div>
            ) : (
              <div className="space-y-1.5">
                {companyContacts.length > 0 && (
                  <div className="border rounded-md divide-y max-h-40 overflow-y-auto">
                    {companyContacts.map(c => (
                      <button type="button" key={c.id} onClick={() => setContact({ id: c.id, name: c.name, phone: c.phone, email: c.email })} className="w-full text-left px-3 py-1.5 text-sm hover:bg-slate-50">
                        {c.name}{c.role && <span className="text-slate-400 text-xs"> · {c.role}</span>}
                      </button>
                    ))}
                  </div>
                )}
                <button type="button" onClick={() => setShowNewContact(true)} className="text-xs text-indigo-600 hover:text-indigo-800 flex items-center gap-1"><Plus className="h-3 w-3" /> Novo contato</button>
              </div>
            )}
          </div>

          {/* PASSO 3 — NEGÓCIO */}
          <div className="space-y-2 border-t pt-3">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">3. Negócio</label>
            <Input placeholder="Título do negócio *" value={form.title} onChange={e => u('title', e.target.value)} className="text-sm" />
            {/* Funil (obrigatório) — em qual funil o lead será criado */}
            <Select
              value={selectedPipelineId ?? ''}
              onValueChange={v => { setSelectedPipelineId(v); setForm(p => ({ ...p, pipeline_stage_id: '' })) }}
            >
              <SelectTrigger className="text-sm">
                <span className="flex items-center gap-1.5 text-slate-500"><GitBranch className="h-3.5 w-3.5" /></span>
                <SelectValue placeholder="Escolha o funil" />
              </SelectTrigger>
              <SelectContent>
                {pipelines.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="grid grid-cols-2 gap-2">
              <Input type="number" placeholder="Valor (R$)" value={form.value} onChange={e => u('value', e.target.value)} className="text-sm" />
              <Select value={effectiveStageId} onValueChange={v => u('pipeline_stage_id', v)}>
                <SelectTrigger className="text-sm"><SelectValue placeholder="Etapa" /></SelectTrigger>
                <SelectContent>
                  {activeStages.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={form.temperature} onValueChange={v => u('temperature', v)}>
                <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="hot">🔥 Quente</SelectItem>
                  <SelectItem value="warm">🌤 Morno</SelectItem>
                  <SelectItem value="cold">❄️ Frio</SelectItem>
                </SelectContent>
              </Select>
              <Select value={form.source} onValueChange={v => u('source', v)}>
                <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="inbound">Inbound</SelectItem>
                  <SelectItem value="outbound">Outbound</SelectItem>
                  <SelectItem value="indicacao">Indicação</SelectItem>
                  <SelectItem value="evento">Evento</SelectItem>
                  <SelectItem value="whatsapp">WhatsApp</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={!canSubmit || createDealMutation.isPending}>
              {createDealMutation.isPending ? 'Salvando...' : 'Criar negócio'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
