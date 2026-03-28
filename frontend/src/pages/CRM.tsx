import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { crmApi, usersApi } from '@/services/api'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  DollarSign, Users, TrendingUp, Plus, Phone, Mail, Building2,
  Thermometer, MessageSquare, ChevronRight, X, Clock, Target,
  Lightbulb, AlertCircle, Calendar, User as UserIcon,
} from 'lucide-react'
import type { Deal, PipelineStage, DealInsight, DealActivity } from '@/types'

const TEMPERATURE_CONFIG = {
  hot: { label: 'Quente', color: 'bg-red-100 text-red-700', icon: '🔥' },
  warm: { label: 'Morno', color: 'bg-amber-100 text-amber-700', icon: '🌤️' },
  cold: { label: 'Frio', color: 'bg-blue-100 text-blue-700', icon: '❄️' },
}

const INSIGHT_ICONS: Record<string, typeof Lightbulb> = {
  need: Target,
  budget: DollarSign,
  timeline: Calendar,
  decision_maker: UserIcon,
  objection: AlertCircle,
  interest: Lightbulb,
  next_step: ChevronRight,
  general: MessageSquare,
}

const INSIGHT_LABELS: Record<string, string> = {
  need: 'Necessidade',
  budget: 'Orcamento',
  timeline: 'Prazo',
  decision_maker: 'Decisor',
  objection: 'Objecao',
  interest: 'Interesse',
  next_step: 'Proximo passo',
  general: 'Geral',
}

function formatCurrency(value: number | null) {
  if (!value) return '-'
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
}

function formatDate(dateStr: string) {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

function formatDateTime(dateStr: string) {
  return new Date(dateStr).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

// ============================================
// Deal Card (Kanban)
// ============================================
function DealCard({ deal, onClick }: { deal: Deal; onClick: () => void }) {
  const temp = TEMPERATURE_CONFIG[deal.temperature] || TEMPERATURE_CONFIG.warm

  return (
    <div
      onClick={onClick}
      className="bg-white rounded-lg border p-3 cursor-pointer hover:shadow-md transition-shadow space-y-2"
    >
      <div className="flex items-start justify-between">
        <h4 className="text-sm font-medium leading-tight line-clamp-2">{deal.title}</h4>
        <span className={`text-xs px-1.5 py-0.5 rounded-full shrink-0 ml-2 ${temp.color}`}>
          {temp.icon}
        </span>
      </div>

      {deal.contact_name && (
        <p className="text-xs text-muted-foreground flex items-center gap-1">
          <UserIcon className="h-3 w-3" />
          {deal.contact_name}
        </p>
      )}

      {deal.company_name && (
        <p className="text-xs text-muted-foreground flex items-center gap-1">
          <Building2 className="h-3 w-3" />
          {deal.company_name}
        </p>
      )}

      <div className="flex items-center justify-between">
        {deal.value ? (
          <span className="text-xs font-semibold text-green-700">{formatCurrency(deal.value)}</span>
        ) : (
          <span className="text-xs text-muted-foreground">Sem valor</span>
        )}
        <span className="text-xs text-muted-foreground">{formatDate(deal.created_at)}</span>
      </div>

      {deal.insights && deal.insights.length > 0 && (
        <div className="flex gap-1 flex-wrap">
          {deal.insights.slice(0, 3).map((insight) => {
            const Icon = INSIGHT_ICONS[insight.category] || MessageSquare
            return (
              <span key={insight.id} className="text-xs bg-slate-100 px-1.5 py-0.5 rounded flex items-center gap-0.5" title={insight.content}>
                <Icon className="h-3 w-3" />
                {INSIGHT_LABELS[insight.category] || insight.category}
              </span>
            )
          })}
          {deal.insights.length > 3 && (
            <span className="text-xs text-muted-foreground">+{deal.insights.length - 3}</span>
          )}
        </div>
      )}
    </div>
  )
}

// ============================================
// Deal Detail Modal
// ============================================
function DealModal({
  dealId,
  stages,
  onClose,
}: {
  dealId: string
  stages: PipelineStage[]
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<'insights' | 'activities'>('insights')
  const [newInsight, setNewInsight] = useState({ category: 'general', content: '' })

  const { data, isLoading } = useQuery({
    queryKey: ['crm-deal', dealId],
    queryFn: () => crmApi.deals.get(dealId),
  })

  const updateDeal = useMutation({
    mutationFn: (updates: Record<string, unknown>) => crmApi.deals.update(dealId, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['crm-deal', dealId] })
      queryClient.invalidateQueries({ queryKey: ['crm-deals'] })
    },
  })

  const moveStage = useMutation({
    mutationFn: (stageId: string) => crmApi.deals.moveStage(dealId, stageId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['crm-deal', dealId] })
      queryClient.invalidateQueries({ queryKey: ['crm-deals'] })
    },
  })

  const addInsight = useMutation({
    mutationFn: (data: { category: string; content: string }) =>
      crmApi.deals.addInsight(dealId, { ...data, source: 'manual' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['crm-deal', dealId] })
      queryClient.invalidateQueries({ queryKey: ['crm-deals'] })
      setNewInsight({ category: 'general', content: '' })
    },
  })

  if (isLoading || !data) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
        <div className="bg-white rounded-xl p-8">
          <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
        </div>
      </div>
    )
  }

  const { deal, insights, activities } = data
  const temp = TEMPERATURE_CONFIG[deal.temperature] || TEMPERATURE_CONFIG.warm

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b sticky top-0 bg-white rounded-t-xl">
          <div>
            <h2 className="text-lg font-semibold">{deal.title}</h2>
            <p className="text-sm text-muted-foreground">
              {deal.contact_name} {deal.company_name ? `- ${deal.company_name}` : ''}
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-muted rounded-lg">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Info cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="p-3 bg-muted/50 rounded-lg">
              <p className="text-xs text-muted-foreground">Valor</p>
              <p className="text-sm font-bold text-green-700">{formatCurrency(deal.value)}</p>
            </div>
            <div className="p-3 bg-muted/50 rounded-lg">
              <p className="text-xs text-muted-foreground">Temperatura</p>
              <select
                value={deal.temperature}
                onChange={(e) => updateDeal.mutate({ temperature: e.target.value })}
                className="text-sm font-medium bg-transparent border-none p-0 cursor-pointer"
              >
                <option value="hot">🔥 Quente</option>
                <option value="warm">🌤️ Morno</option>
                <option value="cold">❄️ Frio</option>
              </select>
            </div>
            <div className="p-3 bg-muted/50 rounded-lg">
              <p className="text-xs text-muted-foreground">Fonte</p>
              <p className="text-sm font-medium">{deal.source || '-'}</p>
            </div>
            <div className="p-3 bg-muted/50 rounded-lg">
              <p className="text-xs text-muted-foreground">Criado em</p>
              <p className="text-sm font-medium">{formatDateTime(deal.created_at)}</p>
            </div>
          </div>

          {/* Contact info */}
          <div className="flex flex-wrap gap-3">
            {deal.contact_phone && (
              <a href={`https://wa.me/${deal.contact_phone}`} target="_blank" rel="noreferrer"
                className="flex items-center gap-1.5 text-sm text-green-700 hover:underline">
                <Phone className="h-4 w-4" /> {deal.contact_phone}
              </a>
            )}
            {deal.contact_email && (
              <a href={`mailto:${deal.contact_email}`}
                className="flex items-center gap-1.5 text-sm text-blue-700 hover:underline">
                <Mail className="h-4 w-4" /> {deal.contact_email}
              </a>
            )}
          </div>

          {/* Pipeline stages */}
          <div>
            <p className="text-xs text-muted-foreground mb-2">Etapa do Funil</p>
            <div className="flex gap-1 flex-wrap">
              {stages.map((stage) => (
                <button
                  key={stage.id}
                  onClick={() => moveStage.mutate(stage.id)}
                  className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                    deal.pipeline_stage_id === stage.id
                      ? 'text-white font-medium'
                      : 'bg-white hover:bg-muted'
                  }`}
                  style={deal.pipeline_stage_id === stage.id ? { backgroundColor: stage.color, borderColor: stage.color } : {}}
                >
                  {stage.name}
                </button>
              ))}
            </div>
          </div>

          {/* Tabs: Insights / Activities */}
          <div className="border-t pt-4">
            <div className="flex gap-4 mb-3">
              <button
                onClick={() => setActiveTab('insights')}
                className={`text-sm font-medium pb-1 ${activeTab === 'insights' ? 'border-b-2 border-primary text-primary' : 'text-muted-foreground'}`}
              >
                Insights da IA ({insights.length})
              </button>
              <button
                onClick={() => setActiveTab('activities')}
                className={`text-sm font-medium pb-1 ${activeTab === 'activities' ? 'border-b-2 border-primary text-primary' : 'text-muted-foreground'}`}
              >
                Atividades ({activities.length})
              </button>
            </div>

            {activeTab === 'insights' && (
              <div className="space-y-2">
                {/* Add insight form */}
                <div className="flex gap-2">
                  <select
                    value={newInsight.category}
                    onChange={(e) => setNewInsight((p) => ({ ...p, category: e.target.value }))}
                    className="h-9 rounded-md border px-2 text-sm"
                  >
                    {Object.entries(INSIGHT_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                  <input
                    value={newInsight.content}
                    onChange={(e) => setNewInsight((p) => ({ ...p, content: e.target.value }))}
                    placeholder="Adicionar insight manualmente..."
                    className="flex-1 h-9 rounded-md border px-3 text-sm"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newInsight.content.trim()) {
                        addInsight.mutate(newInsight)
                      }
                    }}
                  />
                  <Button
                    size="sm"
                    disabled={!newInsight.content.trim()}
                    onClick={() => addInsight.mutate(newInsight)}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>

                {insights.map((insight) => {
                  const Icon = INSIGHT_ICONS[insight.category] || MessageSquare
                  return (
                    <div key={insight.id} className="flex gap-2 p-2 rounded-lg bg-muted/50">
                      <Icon className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium">{INSIGHT_LABELS[insight.category] || insight.category}</span>
                          <span className="text-xs text-muted-foreground">{formatDateTime(insight.created_at)}</span>
                          {insight.source !== 'manual' && (
                            <span className="text-xs bg-purple-100 text-purple-700 px-1.5 rounded">IA</span>
                          )}
                        </div>
                        <p className="text-sm">{insight.content}</p>
                      </div>
                    </div>
                  )
                })}

                {insights.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    Nenhum insight ainda. O agente de IA adicionara automaticamente.
                  </p>
                )}
              </div>
            )}

            {activeTab === 'activities' && (
              <div className="space-y-2">
                {activities.map((activity) => (
                  <div key={activity.id} className="flex gap-2 p-2 rounded-lg bg-muted/50">
                    <Clock className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium capitalize">{activity.type.replace('_', ' ')}</span>
                        <span className="text-xs text-muted-foreground">{formatDateTime(activity.created_at)}</span>
                        {activity.user_name && (
                          <span className="text-xs text-muted-foreground">por {activity.user_name}</span>
                        )}
                      </div>
                      {activity.description && <p className="text-sm">{activity.description}</p>}
                    </div>
                  </div>
                ))}

                {activities.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    Nenhuma atividade registrada.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================
// New Deal Modal
// ============================================
function NewDealModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({
    title: '',
    contact_name: '',
    contact_phone: '',
    contact_email: '',
    company_name: '',
    value: '',
    source: 'whatsapp',
    temperature: 'warm',
  })

  const createDeal = useMutation({
    mutationFn: () =>
      crmApi.deals.create({
        ...form,
        value: form.value ? parseFloat(form.value) : null,
      }),
    onSuccess: () => {
      onCreated()
      onClose()
    },
  })

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold">Novo Lead</h2>
          <button onClick={onClose} className="p-2 hover:bg-muted rounded-lg">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <div>
            <label className="text-sm font-medium">Nome do contato *</label>
            <input
              value={form.contact_name}
              onChange={(e) => setForm((p) => ({ ...p, contact_name: e.target.value, title: `Lead - ${e.target.value}` }))}
              className="mt-1 w-full h-9 rounded-md border px-3 text-sm"
              placeholder="Nome do lead"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium">WhatsApp</label>
              <input
                value={form.contact_phone}
                onChange={(e) => setForm((p) => ({ ...p, contact_phone: e.target.value }))}
                className="mt-1 w-full h-9 rounded-md border px-3 text-sm"
                placeholder="5511999999999"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Email</label>
              <input
                value={form.contact_email}
                onChange={(e) => setForm((p) => ({ ...p, contact_email: e.target.value }))}
                className="mt-1 w-full h-9 rounded-md border px-3 text-sm"
                placeholder="email@empresa.com"
              />
            </div>
          </div>

          <div>
            <label className="text-sm font-medium">Empresa</label>
            <input
              value={form.company_name}
              onChange={(e) => setForm((p) => ({ ...p, company_name: e.target.value }))}
              className="mt-1 w-full h-9 rounded-md border px-3 text-sm"
              placeholder="Nome da empresa"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-sm font-medium">Valor estimado</label>
              <input
                type="number"
                value={form.value}
                onChange={(e) => setForm((p) => ({ ...p, value: e.target.value }))}
                className="mt-1 w-full h-9 rounded-md border px-3 text-sm"
                placeholder="15000"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Fonte</label>
              <select
                value={form.source}
                onChange={(e) => setForm((p) => ({ ...p, source: e.target.value }))}
                className="mt-1 w-full h-9 rounded-md border px-3 text-sm"
              >
                <option value="whatsapp">WhatsApp</option>
                <option value="indicacao">Indicacao</option>
                <option value="inbound">Inbound</option>
                <option value="outbound">Outbound</option>
                <option value="evento">Evento</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-medium">Temperatura</label>
              <select
                value={form.temperature}
                onChange={(e) => setForm((p) => ({ ...p, temperature: e.target.value }))}
                className="mt-1 w-full h-9 rounded-md border px-3 text-sm"
              >
                <option value="hot">🔥 Quente</option>
                <option value="warm">🌤️ Morno</option>
                <option value="cold">❄️ Frio</option>
              </select>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 p-4 border-t">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button
            disabled={!form.contact_name.trim() || createDeal.isPending}
            onClick={() => createDeal.mutate()}
          >
            {createDeal.isPending ? 'Criando...' : 'Criar Lead'}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ============================================
// Main CRM Page
// ============================================
export default function CRM() {
  const queryClient = useQueryClient()
  const [selectedDeal, setSelectedDeal] = useState<string | null>(null)
  const [showNewDeal, setShowNewDeal] = useState(false)
  const [dragDealId, setDragDealId] = useState<string | null>(null)

  const { data: stagesData } = useQuery({
    queryKey: ['crm-pipeline'],
    queryFn: () => crmApi.pipeline(),
  })

  const { data: dealsData, isLoading } = useQuery({
    queryKey: ['crm-deals'],
    queryFn: () => crmApi.deals.list({ status: 'open' }),
  })

  const { data: statsData } = useQuery({
    queryKey: ['crm-stats'],
    queryFn: () => crmApi.stats(),
  })

  const moveStage = useMutation({
    mutationFn: ({ dealId, stageId }: { dealId: string; stageId: string }) =>
      crmApi.deals.moveStage(dealId, stageId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['crm-deals'] })
      queryClient.invalidateQueries({ queryKey: ['crm-stats'] })
    },
  })

  const stages = stagesData?.stages || []
  const deals = dealsData?.deals || []
  const stats = statsData?.stats

  // Agrupar deals por stage
  const dealsByStage: Record<string, Deal[]> = {}
  for (const stage of stages) {
    dealsByStage[stage.id] = deals.filter((d) => d.pipeline_stage_id === stage.id)
  }

  // Drag and drop handlers
  const handleDragStart = (dealId: string) => {
    setDragDealId(dealId)
  }

  const handleDrop = (stageId: string) => {
    if (dragDealId) {
      moveStage.mutate({ dealId: dragDealId, stageId })
      setDragDealId(null)
    }
  }

  return (
    <main className="flex-1 overflow-x-auto">
      <div className="p-6 min-w-fit">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">CRM</h1>
            <p className="text-sm text-muted-foreground">Pipeline de vendas e gestao de leads</p>
          </div>
          <Button onClick={() => setShowNewDeal(true)}>
            <Plus className="h-4 w-4 mr-2" /> Novo Lead
          </Button>
        </div>

        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-blue-100">
                    <Target className="h-5 w-5 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Deals abertos</p>
                    <p className="text-xl font-bold">{stats.open_deals}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-green-100">
                    <DollarSign className="h-5 w-5 text-green-600" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Valor no pipeline</p>
                    <p className="text-xl font-bold">{formatCurrency(parseFloat(stats.pipeline_value))}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-emerald-100">
                    <TrendingUp className="h-5 w-5 text-emerald-600" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Ganhos (30 dias)</p>
                    <p className="text-xl font-bold">{stats.won_last_30d}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-purple-100">
                    <Users className="h-5 w-5 text-purple-600" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Novos (7 dias)</p>
                    <p className="text-xl font-bold">{stats.new_last_7d}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Kanban Board */}
        {isLoading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
          </div>
        ) : (
          <div className="flex gap-4 overflow-x-auto pb-4">
            {stages.filter((s) => !s.is_won && !s.is_lost).map((stage) => {
              const stageDeals = dealsByStage[stage.id] || []
              return (
                <div
                  key={stage.id}
                  className="flex-shrink-0 w-72"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => handleDrop(stage.id)}
                >
                  {/* Stage header */}
                  <div className="flex items-center gap-2 mb-3 px-1">
                    <div className="h-3 w-3 rounded-full" style={{ backgroundColor: stage.color }} />
                    <h3 className="text-sm font-semibold">{stage.name}</h3>
                    <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                      {stageDeals.length}
                    </span>
                  </div>

                  {/* Cards */}
                  <div className="space-y-2 min-h-[100px] p-2 rounded-lg bg-muted/30">
                    {stageDeals.map((deal) => (
                      <div
                        key={deal.id}
                        draggable
                        onDragStart={() => handleDragStart(deal.id)}
                      >
                        <DealCard deal={deal} onClick={() => setSelectedDeal(deal.id)} />
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}

            {/* Won / Lost columns (collapsed) */}
            {stages.filter((s) => s.is_won || s.is_lost).map((stage) => {
              const stageDeals = dealsByStage[stage.id] || []
              return (
                <div
                  key={stage.id}
                  className="flex-shrink-0 w-48"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => handleDrop(stage.id)}
                >
                  <div className="flex items-center gap-2 mb-3 px-1">
                    <div className="h-3 w-3 rounded-full" style={{ backgroundColor: stage.color }} />
                    <h3 className="text-sm font-semibold">{stage.name}</h3>
                    <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                      {stageDeals.length}
                    </span>
                  </div>
                  <div className="space-y-1 min-h-[100px] p-2 rounded-lg bg-muted/30">
                    {stageDeals.slice(0, 3).map((deal) => (
                      <div
                        key={deal.id}
                        onClick={() => setSelectedDeal(deal.id)}
                        className="text-xs p-2 bg-white rounded border cursor-pointer hover:shadow-sm"
                      >
                        <p className="font-medium truncate">{deal.title}</p>
                        {deal.value && <p className="text-green-700">{formatCurrency(deal.value)}</p>}
                      </div>
                    ))}
                    {stageDeals.length > 3 && (
                      <p className="text-xs text-muted-foreground text-center">+{stageDeals.length - 3} mais</p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Modals */}
      {selectedDeal && (
        <DealModal
          dealId={selectedDeal}
          stages={stages}
          onClose={() => setSelectedDeal(null)}
        />
      )}

      {showNewDeal && (
        <NewDealModal
          onClose={() => setShowNewDeal(false)}
          onCreated={() => {
            queryClient.invalidateQueries({ queryKey: ['crm-deals'] })
            queryClient.invalidateQueries({ queryKey: ['crm-stats'] })
          }}
        />
      )}
    </main>
  )
}
