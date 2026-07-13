import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Building2, Plus, Search, Users, Target } from 'lucide-react'
import { PageContainer } from '@/components/layout/PageContainer'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { LoadingSpinner, EmptyState } from '@/components/shared/LoadingSpinner'
import { crmApi } from '@/services/api'
import { formatCurrency } from '@/lib/utils'

function NewCompanyModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({ name: '', cnpj: '', segment: '', city: '', state: '', phone: '', email: '', website: '' })
  const u = (f: string, v: string) => setForm(p => ({ ...p, [f]: v }))
  const createMutation = useMutation({
    mutationFn: () => crmApi.companies.create({
      name: form.name.trim(), cnpj: form.cnpj.trim() || null, segment: form.segment.trim() || null,
      city: form.city.trim() || null, state: form.state.trim() || null,
      phone: form.phone.trim() || null, email: form.email.trim() || null, website: form.website.trim() || null,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['crm-companies'] }); onClose() },
  })
  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Nova Empresa</DialogTitle>
          <DialogDescription>Cadastre uma empresa no CRM.</DialogDescription>
        </DialogHeader>
        <form onSubmit={e => { e.preventDefault(); if (form.name.trim()) createMutation.mutate() }} className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="text-xs font-medium text-slate-600 mb-1 block">Nome da empresa *</label>
            <Input value={form.name} onChange={e => u('name', e.target.value)} placeholder="Empresa" className="text-sm" />
          </div>
          <div><label className="text-xs font-medium text-slate-600 mb-1 block">CNPJ</label><Input value={form.cnpj} onChange={e => u('cnpj', e.target.value)} className="text-sm" /></div>
          <div><label className="text-xs font-medium text-slate-600 mb-1 block">Segmento</label><Input value={form.segment} onChange={e => u('segment', e.target.value)} className="text-sm" /></div>
          <div><label className="text-xs font-medium text-slate-600 mb-1 block">Cidade</label><Input value={form.city} onChange={e => u('city', e.target.value)} className="text-sm" /></div>
          <div><label className="text-xs font-medium text-slate-600 mb-1 block">UF</label><Input value={form.state} onChange={e => u('state', e.target.value)} className="text-sm" /></div>
          <div><label className="text-xs font-medium text-slate-600 mb-1 block">Telefone</label><Input value={form.phone} onChange={e => u('phone', e.target.value)} className="text-sm" /></div>
          <div><label className="text-xs font-medium text-slate-600 mb-1 block">E-mail</label><Input type="email" value={form.email} onChange={e => u('email', e.target.value)} className="text-sm" /></div>
          <div className="col-span-2"><label className="text-xs font-medium text-slate-600 mb-1 block">Website</label><Input value={form.website} onChange={e => u('website', e.target.value)} placeholder="https://" className="text-sm" /></div>
          <div className="col-span-2 flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={!form.name.trim() || createMutation.isPending}>{createMutation.isPending ? 'Salvando...' : 'Criar Empresa'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default function Empresas() {
  const [search, setSearch] = useState('')
  const [showNew, setShowNew] = useState(false)
  const { data, isLoading } = useQuery({
    queryKey: ['crm-companies', search],
    queryFn: () => crmApi.companies.list({ search: search || undefined }),
  })
  const companies = data?.companies ?? []

  return (
    <PageContainer>
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Building2 className="h-5 w-5 text-indigo-500" />
          <h1 className="text-2xl font-bold">Empresas</h1>
        </div>
        <Button onClick={() => setShowNew(true)}><Plus className="h-4 w-4 mr-1.5" /> Nova Empresa</Button>
      </div>

      <div className="relative max-w-sm">
        <Search className="h-4 w-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
        <Input placeholder="Buscar por nome, CNPJ ou e-mail..." value={search} onChange={e => setSearch(e.target.value)} className="pl-8" />
      </div>

      {isLoading ? (
        <LoadingSpinner />
      ) : companies.length === 0 ? (
        <EmptyState message="Nenhuma empresa cadastrada" />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {companies.map(c => (
            <Link key={c.id} to={`/crm/empresas/${c.id}`}>
              <Card className="hover:shadow-md transition-shadow cursor-pointer h-full">
                <CardContent className="py-4">
                  <div className="flex items-start gap-3">
                    <div className="h-9 w-9 rounded-lg bg-indigo-50 flex items-center justify-center shrink-0">
                      <Building2 className="h-4 w-4 text-indigo-500" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-slate-800 truncate">{c.name}</p>
                      {c.segment && <p className="text-xs text-slate-400 truncate">{c.segment}</p>}
                      <div className="flex items-center gap-3 mt-2 text-xs text-slate-500">
                        <span className="flex items-center gap-1"><Users className="h-3 w-3" />{c.contacts_count ?? 0}</span>
                        <span className="flex items-center gap-1"><Target className="h-3 w-3" />{c.deals_count ?? 0}</span>
                        <span className="ml-auto font-medium text-emerald-600">{formatCurrency(c.pipeline_value)}</span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      {showNew && <NewCompanyModal onClose={() => setShowNew(false)} />}
    </PageContainer>
  )
}
