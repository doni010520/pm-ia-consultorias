/**
 * components/crm/RicaDashboard.tsx
 *
 * Painel de KPIs da Rica AI.
 * 5 cards clicaveis com drill-down para lista de leads.
 *
 * Cards:
 *   1. Leads Qualificados (hoje/semana/mes)
 *   2. Distribuicao por Executivo (bar chart)
 *   3. Leads por Produto (bar chart)
 *   4. Sem Retorno (leads pendentes)
 *   5. Taxa de Acao (% executivos que agiram)
 */

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts'
import {
  Bot, Users, Package, AlertTriangle, TrendingUp,
  Phone, ChevronRight, ExternalLink,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { crmApi } from '@/services/api'
import type { RicaStats } from '@/types'

const EXEC_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#ec4899', '#06b6d4', '#f97316', '#6366f1', '#14b8a6',
]

const PRODUCT_COLORS = [
  '#6366f1', '#8b5cf6', '#a78bfa', '#c4b5fd', '#ddd6fe',
  '#818cf8', '#7c3aed', '#6d28d9', '#5b21b6', '#4c1d95',
]

interface RicaDashboardProps {
  onDealClick: (dealId: string) => void
}

export function RicaDashboard({ onDealClick }: RicaDashboardProps) {
  const [activeModal, setActiveModal] = useState<string | null>(null)

  const { data: ricaStats, isLoading } = useQuery({
    queryKey: ['rica-stats'],
    queryFn: () => crmApi.rica.stats(),
    refetchInterval: 60_000, // atualiza a cada 1 min
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Bot className="h-6 w-6 text-indigo-400 animate-pulse mr-2" />
        <span className="text-sm text-slate-500">Carregando dados da Rica...</span>
      </div>
    )
  }

  if (!ricaStats) return null

  const raw = ricaStats as Partial<RicaStats>
  const stats: RicaStats = {
    qualified_leads: raw.qualified_leads ?? { today: 0, week: 0, month: 0, total: 0 },
    by_executive: raw.by_executive ?? [],
    by_product: raw.by_product ?? [],
    pending_followups: raw.pending_followups ?? { count: 0, deals: [] },
    action_rate: raw.action_rate ?? { total_assigned: 0, exec_acted: 0, rate: 0 },
    recent_leads: raw.recent_leads ?? [],
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Bot className="h-5 w-5 text-indigo-500" />
        <h3 className="text-sm font-semibold text-slate-800">Rica IA — Performance</h3>
        <Badge variant="outline" className="text-[10px] font-normal text-indigo-500 border-indigo-200">
          Mes atual
        </Badge>
      </div>

      {/* 5 KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">

        {/* Card 1: Leads Qualificados */}
        <Card
          className="shadow-sm cursor-pointer hover:shadow-md hover:border-indigo-200 transition-all"
          onClick={() => setActiveModal('leads')}
        >
          <CardContent className="p-4">
            <div className="flex items-center gap-1.5 mb-1">
              <Bot className="h-3.5 w-3.5 text-indigo-500" />
              <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Leads Qualificados</p>
            </div>
            <p className="text-2xl font-bold text-indigo-600">{stats.qualified_leads.month}</p>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-[10px] text-slate-400">Hoje: {stats.qualified_leads.today}</span>
              <span className="text-[10px] text-slate-300">|</span>
              <span className="text-[10px] text-slate-400">Semana: {stats.qualified_leads.week}</span>
            </div>
          </CardContent>
        </Card>

        {/* Card 2: Por Executivo */}
        <Card
          className="shadow-sm cursor-pointer hover:shadow-md hover:border-blue-200 transition-all"
          onClick={() => setActiveModal('executives')}
        >
          <CardContent className="p-4">
            <div className="flex items-center gap-1.5 mb-1">
              <Users className="h-3.5 w-3.5 text-blue-500" />
              <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Por Executivo</p>
            </div>
            <p className="text-2xl font-bold text-blue-600">{stats.by_executive.length}</p>
            <p className="text-[10px] text-slate-400 mt-1">
              {stats.by_executive[0]
                ? `Top: ${stats.by_executive[0].name.split(' ')[0]} (${stats.by_executive[0].count})`
                : 'Sem dados'}
            </p>
          </CardContent>
        </Card>

        {/* Card 3: Por Produto */}
        <Card
          className="shadow-sm cursor-pointer hover:shadow-md hover:border-violet-200 transition-all"
          onClick={() => setActiveModal('products')}
        >
          <CardContent className="p-4">
            <div className="flex items-center gap-1.5 mb-1">
              <Package className="h-3.5 w-3.5 text-violet-500" />
              <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Por Produto</p>
            </div>
            <p className="text-2xl font-bold text-violet-600">{stats.by_product.length}</p>
            <p className="text-[10px] text-slate-400 mt-1">
              {stats.by_product[0]
                ? `Top: ${stats.by_product[0].product.slice(0, 18)}${stats.by_product[0].product.length > 18 ? '...' : ''}`
                : 'Sem dados'}
            </p>
          </CardContent>
        </Card>

        {/* Card 4: Sem Retorno */}
        <Card
          className="shadow-sm cursor-pointer hover:shadow-md hover:border-amber-200 transition-all"
          onClick={() => setActiveModal('pending')}
        >
          <CardContent className="p-4">
            <div className="flex items-center gap-1.5 mb-1">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
              <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Sem Retorno</p>
            </div>
            <p className={`text-2xl font-bold ${stats.pending_followups.count > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
              {stats.pending_followups.count}
            </p>
            <p className="text-[10px] text-slate-400 mt-1">
              {stats.pending_followups.count > 0 ? 'leads sem acao do exec' : 'todos com retorno'}
            </p>
          </CardContent>
        </Card>

        {/* Card 5: Taxa de Acao */}
        <Card
          className="shadow-sm cursor-pointer hover:shadow-md hover:border-emerald-200 transition-all"
          onClick={() => setActiveModal('rate')}
        >
          <CardContent className="p-4">
            <div className="flex items-center gap-1.5 mb-1">
              <TrendingUp className="h-3.5 w-3.5 text-emerald-500" />
              <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Taxa de Acao</p>
            </div>
            <p className={`text-2xl font-bold ${stats.action_rate.rate >= 70 ? 'text-emerald-600' : stats.action_rate.rate >= 40 ? 'text-amber-600' : 'text-red-600'}`}>
              {stats.action_rate.rate}%
            </p>
            <p className="text-[10px] text-slate-400 mt-1">
              {stats.action_rate.exec_acted}/{stats.action_rate.total_assigned} leads atendidos
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Mini charts inline (executivos + produtos) */}
      {(stats.by_executive.length > 0 || stats.by_product.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Executive bar chart */}
          {stats.by_executive.length > 0 && (
            <Card className="shadow-sm">
              <CardContent className="p-4">
                <h4 className="text-xs font-semibold text-slate-700 mb-3 flex items-center gap-1.5">
                  <Users className="h-3.5 w-3.5 text-blue-400" />
                  Leads por Executivo (mes)
                </h4>
                <ResponsiveContainer width="100%" height={Math.max(stats.by_executive.length * 36, 120)}>
                  <BarChart data={stats.by_executive} layout="vertical" margin={{ left: 0, right: 20 }}>
                    <XAxis type="number" hide />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={110}
                      tick={{ fontSize: 11, fill: '#64748b' }}
                      tickFormatter={(v: string) => v.split(' ')[0] ?? v}
                    />
                    <Tooltip
                      formatter={(value) => [`${value} leads`, 'Leads']}
                      contentStyle={{ fontSize: 12 }}
                    />
                    <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                      {stats.by_executive.map((_, idx) => (
                        <Cell key={idx} fill={EXEC_COLORS[idx % EXEC_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Product pie chart */}
          {stats.by_product.length > 0 && (
            <Card className="shadow-sm">
              <CardContent className="p-4">
                <h4 className="text-xs font-semibold text-slate-700 mb-3 flex items-center gap-1.5">
                  <Package className="h-3.5 w-3.5 text-violet-400" />
                  Leads por Produto (mes)
                </h4>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={stats.by_product}
                      dataKey="count"
                      nameKey="product"
                      cx="50%"
                      cy="50%"
                      outerRadius={70}
                      innerRadius={35}
                      paddingAngle={2}
                      label={({ name, value }: { name?: string; value?: number }) => {
                        return `${(name ?? '').split(' ')[0]} (${value ?? 0})`
                      }}
                    >
                      {stats.by_product.map((_, idx) => (
                        <Cell key={idx} fill={PRODUCT_COLORS[idx % PRODUCT_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value, name) => [`${value} leads`, name]}
                      contentStyle={{ fontSize: 12 }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* ─── Modals (drill-down) ─────────────────────────────────── */}

      {/* Modal: Leads Qualificados */}
      <Dialog open={activeModal === 'leads'} onOpenChange={() => setActiveModal(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bot className="h-5 w-5 text-indigo-500" />
              Leads Qualificados pela Rica (mes)
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-1 mt-2">
            {stats.recent_leads.length === 0 && (
              <p className="text-sm text-slate-400 py-4 text-center">Nenhum lead neste periodo</p>
            )}
            {stats.recent_leads.map(lead => (
              <LeadRow key={lead.id} lead={lead} onClick={() => { setActiveModal(null); onDealClick(lead.id) }} />
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal: Por Executivo */}
      <Dialog open={activeModal === 'executives'} onOpenChange={() => setActiveModal(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="h-5 w-5 text-blue-500" />
              Distribuicao por Executivo
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 mt-2">
            {stats.by_executive.map(exec => {
              const execLeads = stats.recent_leads.filter(l => l.executive_name === exec.name)
              return (
                <div key={exec.user_id}>
                  <div className="flex items-center justify-between px-2 py-1.5 bg-slate-50 rounded-md">
                    <span className="text-sm font-medium text-slate-700">{exec.name}</span>
                    <Badge variant="outline" className="text-xs">{exec.count} leads</Badge>
                  </div>
                  <div className="pl-3 space-y-0.5 mt-1">
                    {execLeads.map(lead => (
                      <LeadRow key={lead.id} lead={lead} compact onClick={() => { setActiveModal(null); onDealClick(lead.id) }} />
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal: Por Produto */}
      <Dialog open={activeModal === 'products'} onOpenChange={() => setActiveModal(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="h-5 w-5 text-violet-500" />
              Leads por Produto
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 mt-2">
            {stats.by_product.map(prod => {
              const prodLeads = stats.recent_leads.filter(l => l.product === prod.product)
              return (
                <div key={prod.product}>
                  <div className="flex items-center justify-between px-2 py-1.5 bg-slate-50 rounded-md">
                    <span className="text-sm font-medium text-slate-700">{prod.product}</span>
                    <Badge variant="outline" className="text-xs">{prod.count} leads</Badge>
                  </div>
                  <div className="pl-3 space-y-0.5 mt-1">
                    {prodLeads.map(lead => (
                      <LeadRow key={lead.id} lead={lead} compact onClick={() => { setActiveModal(null); onDealClick(lead.id) }} />
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal: Sem Retorno */}
      <Dialog open={activeModal === 'pending'} onOpenChange={() => setActiveModal(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Leads Sem Retorno do Executivo
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs text-slate-400 -mt-1 mb-2">
            Leads encaminhados pela Rica onde o executivo ainda nao registrou acao.
          </p>
          <div className="space-y-1">
            {stats.pending_followups.deals.length === 0 && (
              <p className="text-sm text-emerald-500 py-4 text-center">Todos os leads tiveram retorno!</p>
            )}
            {stats.pending_followups.deals.map(deal => (
              <LeadRow
                key={deal.id}
                lead={{ ...deal, status: 'open', product: null }}
                onClick={() => { setActiveModal(null); onDealClick(deal.id) }}
              />
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal: Taxa de Acao */}
      <Dialog open={activeModal === 'rate'} onOpenChange={() => setActiveModal(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-emerald-500" />
              Taxa de Acao dos Executivos
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="text-center py-4">
              <p className={`text-5xl font-bold ${stats.action_rate.rate >= 70 ? 'text-emerald-600' : stats.action_rate.rate >= 40 ? 'text-amber-600' : 'text-red-600'}`}>
                {stats.action_rate.rate}%
              </p>
              <p className="text-sm text-slate-500 mt-2">
                {stats.action_rate.exec_acted} de {stats.action_rate.total_assigned} leads tiveram acao do executivo
              </p>
            </div>
            {/* Visual bar */}
            <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${stats.action_rate.rate >= 70 ? 'bg-emerald-500' : stats.action_rate.rate >= 40 ? 'bg-amber-500' : 'bg-red-500'}`}
                style={{ width: `${Math.min(stats.action_rate.rate, 100)}%` }}
              />
            </div>
            <div className="flex justify-between text-[10px] text-slate-400">
              <span>0%</span>
              <span>Meta: 70%</span>
              <span>100%</span>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─── Sub-component: LeadRow ──────────────────────────────────────

interface LeadRowProps {
  lead: {
    id: string
    contact_name: string | null
    contact_phone: string | null
    executive_name?: string | null
    product?: string | null
    assigned_at: string
    assigned_via?: string | null
    status?: string
  }
  compact?: boolean
  onClick: () => void
}

function LeadRow({ lead, compact, onClick }: LeadRowProps) {
  const dateStr = new Date(lead.assigned_at).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })

  if (compact) {
    return (
      <button
        onClick={onClick}
        className="w-full flex items-center justify-between px-2 py-1 hover:bg-slate-50 rounded text-left transition-colors group"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs text-slate-600 truncate">{lead.contact_name || 'Sem nome'}</span>
          {lead.product && (
            <span className="text-[10px] text-slate-400 truncate hidden sm:inline">{lead.product}</span>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span className="text-[10px] text-slate-400">{dateStr}</span>
          <ChevronRight className="h-3 w-3 text-slate-300 group-hover:text-indigo-400" />
        </div>
      </button>
    )
  }

  return (
    <button
      onClick={onClick}
      className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-slate-50 rounded-lg border border-transparent hover:border-slate-200 text-left transition-all group"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-slate-700 truncate">
            {lead.contact_name || 'Sem nome'}
          </span>
          {lead.status === 'won' && <Badge className="bg-emerald-50 text-emerald-600 text-[10px]">Ganho</Badge>}
          {lead.status === 'lost' && <Badge className="bg-red-50 text-red-600 text-[10px]">Perdido</Badge>}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          {lead.executive_name && (
            <span className="text-[10px] text-blue-500">{lead.executive_name}</span>
          )}
          {lead.product && (
            <>
              <span className="text-[10px] text-slate-300">|</span>
              <span className="text-[10px] text-violet-500">{lead.product}</span>
            </>
          )}
          {lead.contact_phone && (
            <>
              <span className="text-[10px] text-slate-300">|</span>
              <Phone className="h-2.5 w-2.5 text-slate-300" />
              <span className="text-[10px] text-slate-400">{lead.contact_phone.replace(/^55/, '')}</span>
            </>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0 ml-2">
        <span className="text-[10px] text-slate-400">{dateStr}</span>
        <ExternalLink className="h-3.5 w-3.5 text-slate-300 group-hover:text-indigo-400" />
      </div>
    </button>
  )
}
