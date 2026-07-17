import { useState, useEffect, useRef } from 'react'
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

  // ── Funis (pipelines) — pode escolher VÁRIOS: cria 1 negócio independente por funil ──
  const [selectedPipelineIds, setSelectedPipelineIds] = useState<string[]>(pipelineId ? [pipelineId] : [])
  const inited = useRef(false)
  const { data: pipelinesData } = useQuery({
    queryKey: ['crm-pipelines'],
    queryFn: () => crmApi.pipelines.list(),
  })
  const pipelines = pipelinesData?.pipelines ?? []
  // Se nenhum funil veio por prop, seleciona o primeiro assim que a lista carrega (uma vez).
  useEffect(() => {
    if (!inited.current && selectedPipelineIds.length === 0 && pipelines.length) {
      setSelectedPipelineIds([pipelines[0].id]); inited.current = true
    }
  }, [pipelines.length, selectedPipelineIds.length])

  const togglePipeline = (id: string) =>
    setSelectedPipelineIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]))

  // A etapa só é escolhível quando há EXATAMENTE 1 funil; com vários, cada um usa a 1ª etapa.
  const singlePipelineId = selectedPipelineIds.length === 1 ? selectedPipelineIds[0] : null

  // Etapas do funil único (usa as `stages` da prop como cache inicial se bater).
  const { data: stagesData } = useQuery({
    queryKey: ['crm-stages', singlePipelineId],
    queryFn: () => crmApi.pipeline(singlePipelineId ?? undefined),
    enabled: !!singlePipelineId,
    initialData: singlePipelineId && singlePipelineId === pipelineId ? { stages } : undefined,
  })
  const activeStages = (stagesData?.stages ?? stages)
    .filter(s => !s.is_won && !s.is_lost)
    .sort((a, b) => a.position - b.position)

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

  // ── Criar negócio(s) — um por funil selecionado, todos vinculados ao mesmo contato ──
  const createDealMutation = useMutation({
    mutationFn: (deals: Record<string, unknown>[]) => Promise.all(deals.map(d => crmApi.deals.create(d))),
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

  const canSubmit = !!company && !!contact && form.title.trim().length > 0 && selectedPipelineIds.length >= 1
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    const base = {
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
    }
    // 1 negócio por funil. Com 1 funil, honra a etapa escolhida; com vários, cada um
    // entra na 1ª etapa do seu funil (backend resolve quando pipeline_stage_id vem vazio).
    const deals = selectedPipelineIds.map(pid => ({
      ...base,
      pipeline_id: pid,
      pipeline_stage_id: singlePipelineId ? effectiveStageId : undefined,
    }))
    createDealMutation.mutate(deals)
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
                {/* Função da pessoa no negócio (dono, sócio, gerente...) */}
                <Input
                  placeholder="Função no negócio (ex: dono, sócio, gerente)"
                  value={newContact.role}
                  onChange={e => setNewContact(p => ({ ...p, role: e.target.value }))}
                  list="contact-role-suggestions"
                  className="h-8 text-sm bg-white"
                />
                <datalist id="contact-role-suggestions">
                  <option value="Dono" /><option value="Sócio" /><option value="Gerente" />
                  <option value="Líder" /><option value="Diretor(a)" /><option value="Comprador(a)" />
                  <option value="Decisor(a)" /><option value="Financeiro" />
                </datalist>
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
            {/* Funil(is) — pode escolher VÁRIOS: cria um negócio independente por funil */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
                <GitBranch className="h-3.5 w-3.5" /> Funil(is) — escolha um ou mais
              </div>
              <div className="flex flex-wrap gap-1.5">
                {pipelines.map(p => {
                  const on = selectedPipelineIds.includes(p.id)
                  return (
                    <button
                      type="button" key={p.id}
                      onClick={() => { togglePipeline(p.id); setForm(prev => ({ ...prev, pipeline_stage_id: '' })) }}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors inline-flex items-center gap-1 ${on ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'}`}
                    >
                      {on && <Check className="h-3 w-3" />}{p.name}
                    </button>
                  )
                })}
              </div>
              {selectedPipelineIds.length > 1 && (
                <p className="text-[11px] text-indigo-600">
                  Serão criados <b>{selectedPipelineIds.length} negócios independentes</b> (um por funil), vinculados ao mesmo contato — cada um avança e fecha por conta própria.
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Input type="number" placeholder="Valor (R$)" value={form.value} onChange={e => u('value', e.target.value)} className="text-sm" />
              {singlePipelineId ? (
                <Select value={effectiveStageId} onValueChange={v => u('pipeline_stage_id', v)}>
                  <SelectTrigger className="text-sm"><SelectValue placeholder="Etapa" /></SelectTrigger>
                  <SelectContent>
                    {activeStages.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : (
                <div className="flex items-center px-3 rounded-md border border-slate-200 bg-slate-50 text-xs text-slate-400">
                  1ª etapa de cada funil
                </div>
              )}
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
              {createDealMutation.isPending
                ? 'Salvando...'
                : selectedPipelineIds.length > 1 ? `Criar ${selectedPipelineIds.length} negócios` : 'Criar negócio'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
