import { useState, useMemo, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Search, Plus, LayoutGrid, List, Phone,
  Mail, Building2, Clock, ChevronDown, ChevronRight,
  MessageSquare, ArrowUpDown, X,
  Trash2, Activity, CalendarDays, Tag,
  Zap, Globe, Users, Trophy, TrendingUp,
  FileText, Lightbulb, Send, Edit3, Check, User,
  Filter, Pencil, BarChart3, Target, AlertTriangle,
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PageContainer } from '@/components/layout/PageContainer'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'
import { crmApi } from '@/services/api'
import type {
  Deal, PipelineStage, CrmStats,
} from '@/types'

// ============================================
// Utility Functions
// ============================================

function formatCurrency(value: number | null | undefined): string {
  if (value == null) return '-'
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '-'
  const d = new Date(dateStr)
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
}

function formatDateFull(dateStr: string | null | undefined): string {
  if (!dateStr) return '-'
  const d = new Date(dateStr)
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

function daysSince(dateStr: string | null | undefined): number {
  if (!dateStr) return 0
  const d = new Date(dateStr)
  const now = new Date()
  return Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24))
}

function getAgingBorderClass(deal: Deal, stage: PipelineStage | undefined): string {
  if (!stage?.max_days || !deal.stage_entered_at) return 'border-l-emerald-400'
  const days = deal.days_in_stage ?? daysSince(deal.stage_entered_at)
  const ratio = days / stage.max_days
  if (ratio > 1) return 'border-l-red-400'
  if (ratio > 0.7) return 'border-l-amber-400'
  return 'border-l-emerald-400'
}

function temperatureColor(temp: string): string {
  if (temp === 'hot') return 'bg-red-500'
  if (temp === 'warm') return 'bg-amber-500'
  return 'bg-sky-500'
}

function temperatureLabel(temp: string): string {
  if (temp === 'hot') return 'Quente'
  if (temp === 'warm') return 'Morno'
  return 'Frio'
}

function sourceLabel(source: string | null): string {
  const map: Record<string, string> = {
    whatsapp: 'WhatsApp', indicacao: 'Indicacao', inbound: 'Inbound',
    outbound: 'Outbound', evento: 'Evento',
  }
  return source ? (map[source] || source) : '-'
}

function sourceIcon(source: string | null) {
  if (source === 'whatsapp') return <MessageSquare className="h-3 w-3" />
  if (source === 'indicacao') return <Users className="h-3 w-3" />
  if (source === 'inbound') return <Globe className="h-3 w-3" />
  if (source === 'outbound') return <Send className="h-3 w-3" />
  if (source === 'evento') return <CalendarDays className="h-3 w-3" />
  return null
}

function activityIcon(type: string) {
  if (type === 'call') return <Phone className="h-3.5 w-3.5" />
  if (type === 'email') return <Mail className="h-3.5 w-3.5" />
  if (type === 'meeting') return <Users className="h-3.5 w-3.5" />
  if (type === 'note') return <FileText className="h-3.5 w-3.5" />
  if (type === 'whatsapp') return <MessageSquare className="h-3.5 w-3.5" />
  return <Activity className="h-3.5 w-3.5" />
}

// ============================================
// Main CRM Component
// ============================================

export default function CRM() {
  const queryClient = useQueryClient()

  // Pipeline selection state
  const [selectedPipelineId, setSelectedPipelineId] = useState<string | null>(null)

  // View and filter state
  const [view, setView] = useState<'kanban' | 'list' | 'dashboard'>('kanban')
  const [search, setSearch] = useState('')
  const [tempFilter, setTempFilter] = useState('all')
  const [ownerFilter, setOwnerFilter] = useState('all')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [sortBy, setSortBy] = useState('recent')

  // Modal state
  const [selectedDealId, setSelectedDealId] = useState<string | null>(null)
  const [showNewDeal, setShowNewDeal] = useState(false)
  const [showAutomations, setShowAutomations] = useState(false)
  const [showFilters, setShowFilters] = useState(false)
  const filterRef = useRef<HTMLDivElement>(null)

  // Close filter dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setShowFilters(false)
      }
    }
    if (showFilters) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showFilters])

  // Kanban collapsed state for won/lost
  const [wonExpanded, setWonExpanded] = useState(false)
  const [lostExpanded, setLostExpanded] = useState(false)

  // List view sort
  const [listSort, setListSort] = useState<{ col: string; dir: 'asc' | 'desc' }>({ col: 'updated_at', dir: 'desc' })

  // Data fetching
  const { data: pipelinesData, isLoading: pipelinesLoading, isError: pipelinesError } = useQuery({
    queryKey: ['crm-pipelines'],
    queryFn: () => crmApi.pipelines.list(),
    retry: 1,
  })
  const pipelines = pipelinesData?.pipelines ?? []
  const hasPipelines = pipelines.length > 0 && !pipelinesError

  // Auto-select first pipeline if none selected
  useEffect(() => {
    if (pipelines.length > 0 && !selectedPipelineId) {
      setSelectedPipelineId(pipelines[0].id)
    }
  }, [pipelines, selectedPipelineId])

  const { data: pipelineData, isLoading: pipelineLoading } = useQuery({
    queryKey: ['crm-pipeline', selectedPipelineId],
    queryFn: () => crmApi.pipeline(selectedPipelineId || undefined),
    enabled: hasPipelines ? !!selectedPipelineId : true,
  })

  const { data: dealsData, isLoading: dealsLoading } = useQuery({
    queryKey: ['crm-deals', selectedPipelineId],
    queryFn: () => crmApi.deals.list(selectedPipelineId ? { pipeline_id: selectedPipelineId } : {}),
    enabled: hasPipelines ? !!selectedPipelineId : true,
  })

  const { data: statsData } = useQuery({
    queryKey: ['crm-stats', selectedPipelineId],
    queryFn: () => crmApi.stats(selectedPipelineId || undefined),
    enabled: hasPipelines ? !!selectedPipelineId : true,
  })

  const stages = pipelineData?.stages ?? []
  const allDeals = dealsData?.deals ?? []
  const stats = statsData as CrmStats | undefined
  const selectedPipeline = pipelines.find(p => p.id === selectedPipelineId)

  // Unique owners from deals
  const owners = useMemo(() => {
    const map = new Map<string, string>()
    allDeals.forEach(d => {
      if (d.owner_id && d.owner_name) map.set(d.owner_id, d.owner_name)
    })
    return Array.from(map, ([id, name]) => ({ id, name }))
  }, [allDeals])

  // Filter and sort deals
  const filteredDeals = useMemo(() => {
    let deals = [...allDeals]
    if (search) {
      const q = search.toLowerCase()
      deals = deals.filter(d =>
        d.title.toLowerCase().includes(q) ||
        (d.contact_name && d.contact_name.toLowerCase().includes(q)) ||
        (d.company_name && d.company_name.toLowerCase().includes(q))
      )
    }
    if (tempFilter !== 'all') {
      const map: Record<string, string> = { quente: 'hot', morno: 'warm', frio: 'cold' }
      deals = deals.filter(d => d.temperature === map[tempFilter])
    }
    if (ownerFilter !== 'all') {
      deals = deals.filter(d => d.owner_id === ownerFilter)
    }
    if (sourceFilter !== 'all') {
      deals = deals.filter(d => d.source === sourceFilter)
    }
    if (sortBy === 'value') {
      deals.sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
    } else if (sortBy === 'stage_age') {
      deals.sort((a, b) => (b.days_in_stage ?? 0) - (a.days_in_stage ?? 0))
    } else {
      deals.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    }
    return deals
  }, [allDeals, search, tempFilter, ownerFilter, sourceFilter, sortBy])

  const hasFilters = search || tempFilter !== 'all' || ownerFilter !== 'all' || sourceFilter !== 'all'

  const clearFilters = () => {
    setSearch('')
    setTempFilter('all')
    setOwnerFilter('all')
    setSourceFilter('all')
  }

  // Move deal mutation
  const moveDealMutation = useMutation({
    mutationFn: ({ dealId, stageId }: { dealId: string; stageId: string }) =>
      crmApi.deals.moveStage(dealId, stageId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['crm-deals', selectedPipelineId] })
      queryClient.invalidateQueries({ queryKey: ['crm-stats', selectedPipelineId] })
      queryClient.invalidateQueries({ queryKey: ['crm-pipelines'] })
    },
  })

  if ((!pipelinesError && pipelinesLoading) || pipelineLoading || dealsLoading) return <PageContainer><LoadingSpinner /></PageContainer>

  const activeStages = stages.filter(s => !s.is_won && !s.is_lost).sort((a, b) => a.position - b.position)
  const wonStage = stages.find(s => s.is_won)
  const lostStage = stages.find(s => s.is_lost)

  const openDeals = filteredDeals.filter(d => d.status === 'open')
  const wonDeals = filteredDeals.filter(d => d.status === 'won')
  const lostDeals = filteredDeals.filter(d => d.status === 'lost')

  const pipelineValue = openDeals.reduce((sum, d) => sum + (d.value ?? 0), 0)
  const wonValue = wonDeals.reduce((sum, d) => sum + (d.value ?? 0), 0)
  const totalClosed = wonDeals.length + lostDeals.length
  const conversionRate = totalClosed > 0 ? Math.round((wonDeals.length / totalClosed) * 100) : 0

  return (
    <PageContainer>
      {/* ============================================ */}
      {/* HEADER SECTION */}
      {/* ============================================ */}
      <div className="space-y-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">CRM</h1>
            <p className="text-sm text-slate-500 mt-0.5">{selectedPipeline?.name || 'Pipeline de vendas'}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowAutomations(true)}>
              <Zap className="h-4 w-4 mr-1.5" />
              Automacoes
            </Button>
            <Button size="sm" onClick={() => setShowNewDeal(true)}>
              <Plus className="h-4 w-4 mr-1.5" />
              Novo Lead
            </Button>
          </div>
        </div>

        {/* Pipeline Tabs */}
        {pipelines.length > 1 && (
          <div className="flex items-center gap-1 overflow-x-auto pb-1">
            {pipelines.map(p => (
              <button
                key={p.id}
                onClick={() => setSelectedPipelineId(p.id)}
                className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  selectedPipelineId === p.id
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {p.name}
                {p.open_deals && parseInt(p.open_deals) > 0 && (
                  <span className={`text-[10px] rounded-full h-4 min-w-[16px] px-1 inline-flex items-center justify-center ${
                    selectedPipelineId === p.id ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-500'
                  }`}>
                    {p.open_deals}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        {/* Stats Bar */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Card className="shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Deals Abertos</p>
                <TrendingUp className="h-4 w-4 text-slate-400" />
              </div>
              <p className="text-2xl font-semibold text-slate-900 mt-1">{stats?.stats.open_deals ?? openDeals.length}</p>
            </CardContent>
          </Card>
          <Card className="shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Pipeline</p>
                <Activity className="h-4 w-4 text-slate-400" />
              </div>
              <p className="text-2xl font-semibold text-slate-900 mt-1">{formatCurrency(pipelineValue)}</p>
            </CardContent>
          </Card>
          <Card className="shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Ganhos (mes)</p>
                <Trophy className="h-4 w-4 text-slate-400" />
              </div>
              <p className="text-2xl font-semibold text-emerald-600 mt-1">{formatCurrency(wonValue)}</p>
            </CardContent>
          </Card>
          <Card className="shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Conversao</p>
                <Tag className="h-4 w-4 text-slate-400" />
              </div>
              <p className="text-2xl font-semibold text-slate-900 mt-1">{conversionRate}%</p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ============================================ */}
      {/* TOOLBAR */}
      {/* ============================================ */}
      <div className="flex items-center gap-2">
        <div className="inline-flex items-center rounded-lg border bg-white p-0.5">
          <button
            onClick={() => setView('kanban')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${view === 'kanban' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:text-slate-900'}`}
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            Kanban
          </button>
          <button
            onClick={() => setView('list')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${view === 'list' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:text-slate-900'}`}
          >
            <List className="h-3.5 w-3.5" />
            Lista
          </button>
          <button
            onClick={() => setView('dashboard')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${view === 'dashboard' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:text-slate-900'}`}
          >
            <BarChart3 className="h-3.5 w-3.5" />
            Dashboard
          </button>
        </div>

        {view !== 'dashboard' && (
          <div className="relative w-64">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              placeholder="Buscar deal, contato, empresa..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9 h-8 text-sm bg-white"
            />
          </div>
        )}

        {view !== 'dashboard' && <div className="relative" ref={filterRef}>
          <Button
            variant="outline" size="sm"
            className={`h-8 ${hasFilters ? 'border-primary text-primary' : ''}`}
            onClick={() => setShowFilters(!showFilters)}
          >
            <Filter className="h-3.5 w-3.5 mr-1.5" />
            Filtros
            {hasFilters && (
              <span className="ml-1.5 bg-primary text-white text-[10px] rounded-full h-4 w-4 inline-flex items-center justify-center">
                {(tempFilter !== 'all' ? 1 : 0) + (ownerFilter !== 'all' ? 1 : 0) + (sourceFilter !== 'all' ? 1 : 0)}
              </span>
            )}
          </Button>

          {showFilters && (
            <div className="absolute top-full left-0 mt-1 z-50 bg-white rounded-lg border shadow-lg p-3 w-64 space-y-3">
              {/* Temperatura */}
              <div>
                <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Temperatura</p>
                <div className="flex flex-wrap gap-1.5">
                  {[{ v: 'all', l: 'Todos' }, { v: 'quente', l: 'Quente' }, { v: 'morno', l: 'Morno' }, { v: 'frio', l: 'Frio' }].map(opt => (
                    <button
                      key={opt.v}
                      onClick={() => setTempFilter(opt.v)}
                      className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${tempFilter === opt.v ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                    >
                      {opt.l}
                    </button>
                  ))}
                </div>
              </div>

              <div className="border-t border-slate-100" />

              {/* Responsavel */}
              <div>
                <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Responsavel</p>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    onClick={() => setOwnerFilter('all')}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${ownerFilter === 'all' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                  >
                    Todos
                  </button>
                  {owners.map(o => (
                    <button
                      key={o.id}
                      onClick={() => setOwnerFilter(o.id)}
                      className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${ownerFilter === o.id ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                    >
                      {o.name}
                    </button>
                  ))}
                </div>
              </div>

              <div className="border-t border-slate-100" />

              {/* Origem */}
              <div>
                <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Origem</p>
                <div className="flex flex-wrap gap-1.5">
                  {[{ v: 'all', l: 'Todos' }, { v: 'whatsapp', l: 'WhatsApp' }, { v: 'indicacao', l: 'Indicacao' }, { v: 'inbound', l: 'Inbound' }, { v: 'outbound', l: 'Outbound' }, { v: 'evento', l: 'Evento' }].map(opt => (
                    <button
                      key={opt.v}
                      onClick={() => setSourceFilter(opt.v)}
                      className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${sourceFilter === opt.v ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                    >
                      {opt.l}
                    </button>
                  ))}
                </div>
              </div>

              <div className="border-t border-slate-100" />

              {/* Ordenar */}
              <div>
                <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Ordenar por</p>
                <div className="flex flex-wrap gap-1.5">
                  {[{ v: 'recent', l: 'Mais recente' }, { v: 'value', l: 'Maior valor' }, { v: 'stage_age', l: 'Mais antigo' }].map(opt => (
                    <button
                      key={opt.v}
                      onClick={() => setSortBy(opt.v)}
                      className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${sortBy === opt.v ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                    >
                      {opt.l}
                    </button>
                  ))}
                </div>
              </div>

              {hasFilters && (
                <>
                  <div className="border-t border-slate-100" />
                  <button
                    onClick={() => { clearFilters(); setShowFilters(false) }}
                    className="text-xs text-red-500 hover:text-red-600 font-medium w-full text-center py-1"
                  >
                    Limpar todos os filtros
                  </button>
                </>
              )}
            </div>
          )}
        </div>}

        {view !== 'dashboard' && hasFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters} className="h-8 text-xs text-slate-500">
            <X className="h-3.5 w-3.5 mr-1" />
            Limpar
          </Button>
        )}
      </div>

      {/* ============================================ */}
      {/* DASHBOARD VIEW */}
      {/* ============================================ */}
      {view === 'dashboard' && (
        <DashboardView
          stages={activeStages}
          openDeals={openDeals}
          wonDeals={wonDeals}
          lostDeals={lostDeals}
          stats={stats}
          onDealClick={setSelectedDealId}
        />
      )}

      {/* ============================================ */}
      {/* KANBAN VIEW */}
      {/* ============================================ */}
      {view === 'kanban' && (
        <KanbanBoard
          stages={activeStages}
          wonStage={wonStage}
          lostStage={lostStage}
          deals={openDeals}
          wonDeals={wonDeals}
          lostDeals={lostDeals}
          wonExpanded={wonExpanded}
          lostExpanded={lostExpanded}
          onToggleWon={() => setWonExpanded(!wonExpanded)}
          onToggleLost={() => setLostExpanded(!lostExpanded)}
          onDealClick={setSelectedDealId}
          onMoveDeal={(dealId, stageId) => moveDealMutation.mutate({ dealId, stageId })}
          pipelineId={selectedPipelineId}
        />
      )}

      {/* ============================================ */}
      {/* LIST VIEW */}
      {/* ============================================ */}
      {view === 'list' && (
        <ListView
          deals={filteredDeals}
          stages={stages}
          sort={listSort}
          onSort={(col) => {
            setListSort(prev => ({
              col,
              dir: prev.col === col && prev.dir === 'asc' ? 'desc' : 'asc',
            }))
          }}
          onDealClick={setSelectedDealId}
        />
      )}

      {/* ============================================ */}
      {/* MODALS */}
      {/* ============================================ */}
      {selectedDealId && (
        <DealDetailModal
          dealId={selectedDealId}
          stages={stages}
          onClose={() => setSelectedDealId(null)}
          onMoveDeal={(stageId) => {
            moveDealMutation.mutate({ dealId: selectedDealId, stageId })
          }}
        />
      )}

      {showNewDeal && (
        <NewDealModal
          stages={activeStages}
          pipelineId={selectedPipelineId}
          onClose={() => setShowNewDeal(false)}
        />
      )}

      {showAutomations && (
        <AutomationsModal onClose={() => setShowAutomations(false)} />
      )}
    </PageContainer>
  )
}

// ============================================
// DASHBOARD VIEW
// ============================================

const SOURCE_COLORS: Record<string, string> = {
  whatsapp: '#25d366', indicacao: '#8b5cf6', inbound: '#3b82f6',
  outbound: '#f59e0b', evento: '#ec4899',
}
const TEMP_COLORS: Record<string, string> = { hot: '#ef4444', warm: '#f59e0b', cold: '#3b82f6' }

function DashboardView({ stages, openDeals, wonDeals, lostDeals, stats, onDealClick }: {
  stages: PipelineStage[]
  openDeals: Deal[]
  wonDeals: Deal[]
  lostDeals: Deal[]
  stats: CrmStats | undefined
  onDealClick: (id: string) => void
}) {
  // Funnel data: deals per stage in order
  const funnelData = useMemo(() => {
    const sorted = [...stages].sort((a, b) => a.position - b.position)
    const firstCount = openDeals.filter(d => d.pipeline_stage_id === sorted[0]?.id).length || 1
    return sorted.map((s, idx) => {
      const count = openDeals.filter(d => d.pipeline_stage_id === s.id).length
      const value = openDeals.filter(d => d.pipeline_stage_id === s.id).reduce((sum, d) => sum + (d.value ?? 0), 0)
      const prevCount = idx === 0 ? count : openDeals.filter(d => d.pipeline_stage_id === sorted[idx - 1].id).length
      const conversionFromPrev = idx === 0 ? 100 : (prevCount > 0 ? Math.round((count / prevCount) * 100) : 0)
      const conversionFromFirst = Math.round((count / firstCount) * 100)
      return { name: s.name, color: s.color, count, value, conversionFromPrev, conversionFromFirst }
    })
  }, [stages, openDeals])

  // Value by stage for bar chart
  const valueByStage = useMemo(() => {
    return stats?.stages_summary
      ?.filter(s => {
        const st = stages.find(st => st.id === s.id)
        return st && !st.is_won && !st.is_lost
      })
      .sort((a, b) => a.position - b.position)
      .map(s => ({
        name: s.name,
        value: Number(s.total_value) || 0,
        count: Number(s.deal_count) || 0,
        fill: s.color,
      })) ?? []
  }, [stats, stages])

  // Deals by source
  const bySource = useMemo(() => {
    const map: Record<string, number> = {}
    openDeals.forEach(d => {
      const src = d.source || 'outros'
      map[src] = (map[src] || 0) + 1
    })
    return Object.entries(map).map(([name, value]) => ({
      name: sourceLabel(name),
      value,
      fill: SOURCE_COLORS[name] || '#94a3b8',
    }))
  }, [openDeals])

  // Deals by temperature
  const byTemp = useMemo(() => {
    const map: Record<string, number> = { hot: 0, warm: 0, cold: 0 }
    openDeals.forEach(d => { map[d.temperature] = (map[d.temperature] || 0) + 1 })
    return [
      { name: 'Quente', value: map.hot, fill: TEMP_COLORS.hot },
      { name: 'Morno', value: map.warm, fill: TEMP_COLORS.warm },
      { name: 'Frio', value: map.cold, fill: TEMP_COLORS.cold },
    ].filter(d => d.value > 0)
  }, [openDeals])

  // Average days per stage
  const avgDaysPerStage = useMemo(() => {
    return stages.sort((a, b) => a.position - b.position).map(s => {
      const stageDeals = openDeals.filter(d => d.pipeline_stage_id === s.id)
      const totalDays = stageDeals.reduce((sum, d) => sum + (d.days_in_stage ?? 0), 0)
      const avg = stageDeals.length > 0 ? Math.round(totalDays / stageDeals.length) : 0
      return { name: s.name, dias: avg, fill: s.color, max_days: s.max_days }
    })
  }, [stages, openDeals])

  // Top deals
  const topDeals = useMemo(() => {
    return [...openDeals].filter(d => d.value && d.value > 0).sort((a, b) => (b.value ?? 0) - (a.value ?? 0)).slice(0, 5)
  }, [openDeals])

  // Rotting deals
  const rottingDeals = useMemo(() => {
    return openDeals.filter(d => d.is_rotting).sort((a, b) => (b.days_in_stage ?? 0) - (a.days_in_stage ?? 0)).slice(0, 5)
  }, [openDeals])

  // Won this month
  const wonThisMonth = useMemo(() => {
    const now = new Date()
    return wonDeals.filter(d => {
      if (!d.won_date) return false
      const wd = new Date(d.won_date)
      return wd.getMonth() === now.getMonth() && wd.getFullYear() === now.getFullYear()
    })
  }, [wonDeals])

  const totalPipeline = openDeals.reduce((s, d) => s + (d.value ?? 0), 0)
  const wonMonthValue = wonThisMonth.reduce((s, d) => s + (d.value ?? 0), 0)
  const totalClosed = wonDeals.length + lostDeals.length
  const winRate = totalClosed > 0 ? Math.round((wonDeals.length / totalClosed) * 100) : 0
  const avgDealValue = openDeals.length > 0 ? totalPipeline / openDeals.length : 0

  const maxFunnelCount = Math.max(...funnelData.map(d => d.count), 1)

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Card className="shadow-sm">
          <CardContent className="p-4">
            <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Pipeline Total</p>
            <p className="text-xl font-semibold text-slate-900 mt-1">{formatCurrency(totalPipeline)}</p>
            <p className="text-xs text-slate-400 mt-0.5">{openDeals.length} deals abertos</p>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardContent className="p-4">
            <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Ganhos (mes)</p>
            <p className="text-xl font-semibold text-emerald-600 mt-1">{formatCurrency(wonMonthValue)}</p>
            <p className="text-xs text-slate-400 mt-0.5">{wonThisMonth.length} deals ganhos</p>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardContent className="p-4">
            <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Taxa de Conversao</p>
            <p className="text-xl font-semibold text-slate-900 mt-1">{winRate}%</p>
            <p className="text-xs text-slate-400 mt-0.5">{wonDeals.length}W / {lostDeals.length}L</p>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardContent className="p-4">
            <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Ticket Medio</p>
            <p className="text-xl font-semibold text-slate-900 mt-1">{formatCurrency(avgDealValue)}</p>
            <p className="text-xs text-slate-400 mt-0.5">por deal aberto</p>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardContent className="p-4">
            <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Em Risco</p>
            <p className="text-xl font-semibold text-red-600 mt-1">{rottingDeals.length}</p>
            <p className="text-xs text-slate-400 mt-0.5">deals estagnados</p>
          </CardContent>
        </Card>
      </div>

      {/* Funnel + Value by Stage */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Visual Funnel */}
        <Card className="shadow-sm">
          <CardContent className="p-5">
            <h3 className="text-sm font-semibold text-slate-800 mb-4 flex items-center gap-2">
              <Target className="h-4 w-4 text-slate-400" />
              Funil de Vendas
            </h3>
            <div className="space-y-2">
              {funnelData.map((stage, idx) => {
                const widthPercent = maxFunnelCount > 0 ? Math.max((stage.count / maxFunnelCount) * 100, 12) : 12
                return (
                  <div key={stage.name}>
                    <div className="flex items-center gap-3">
                      <div className="flex-1">
                        <div
                          className="relative rounded-md py-2.5 px-3 flex items-center justify-between transition-all"
                          style={{
                            width: `${widthPercent}%`,
                            backgroundColor: stage.color + '20',
                            borderLeft: `4px solid ${stage.color}`,
                            minWidth: '120px',
                          }}
                        >
                          <span className="text-xs font-medium text-slate-700 truncate">{stage.name}</span>
                          <span className="text-sm font-bold text-slate-900 ml-2">{stage.count}</span>
                        </div>
                      </div>
                      <div className="w-20 text-right flex-shrink-0">
                        <span className="text-xs text-slate-500">{formatCurrency(stage.value)}</span>
                      </div>
                    </div>
                    {idx < funnelData.length - 1 && (
                      <div className="flex items-center ml-6 my-0.5">
                        <ChevronDown className="h-3 w-3 text-slate-300" />
                        <span className="text-[10px] text-slate-400 ml-1">
                          {funnelData[idx + 1].conversionFromPrev}% conversao
                        </span>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>

        {/* Value by Stage Bar Chart */}
        <Card className="shadow-sm">
          <CardContent className="p-5">
            <h3 className="text-sm font-semibold text-slate-800 mb-4 flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-slate-400" />
              Valor por Etapa
            </h3>
            {valueByStage.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={valueByStage} layout="vertical" margin={{ left: 10, right: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                  <XAxis type="number" tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`} fontSize={11} tick={{ fill: '#94a3b8' }} />
                  <YAxis type="category" dataKey="name" width={90} fontSize={11} tick={{ fill: '#64748b' }} />
                  <Tooltip
                    formatter={(value) => [formatCurrency(value as number), 'Valor']}
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
                  />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={24}>
                    {valueByStage.map((entry, idx) => (
                      <Cell key={idx} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-[260px] text-sm text-slate-400">Sem dados</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Source + Temperature + Avg Days */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Deals by Source */}
        <Card className="shadow-sm">
          <CardContent className="p-5">
            <h3 className="text-sm font-semibold text-slate-800 mb-4">Deals por Origem</h3>
            {bySource.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={bySource} cx="50%" cy="50%" innerRadius={45} outerRadius={70}
                    dataKey="value" paddingAngle={3} strokeWidth={0}
                  >
                    {bySource.map((entry, idx) => (
                      <Cell key={idx} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-[200px] text-sm text-slate-400">Sem dados</div>
            )}
          </CardContent>
        </Card>

        {/* Deals by Temperature */}
        <Card className="shadow-sm">
          <CardContent className="p-5">
            <h3 className="text-sm font-semibold text-slate-800 mb-4">Temperatura dos Deals</h3>
            {byTemp.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={byTemp} cx="50%" cy="50%" innerRadius={45} outerRadius={70}
                    dataKey="value" paddingAngle={3} strokeWidth={0}
                  >
                    {byTemp.map((entry, idx) => (
                      <Cell key={idx} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-[200px] text-sm text-slate-400">Sem dados</div>
            )}
          </CardContent>
        </Card>

        {/* Average Days per Stage */}
        <Card className="shadow-sm">
          <CardContent className="p-5">
            <h3 className="text-sm font-semibold text-slate-800 mb-4 flex items-center gap-2">
              <Clock className="h-4 w-4 text-slate-400" />
              Tempo Medio por Etapa
            </h3>
            <div className="space-y-3">
              {avgDaysPerStage.map(s => (
                <div key={s.name} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-600">{s.name}</span>
                    <span className="font-medium text-slate-800">
                      {s.dias}d
                      {s.max_days && <span className="text-slate-400"> / {s.max_days}d</span>}
                    </span>
                  </div>
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${s.max_days ? Math.min((s.dias / s.max_days) * 100, 100) : Math.min(s.dias * 5, 100)}%`,
                        backgroundColor: s.max_days && s.dias > s.max_days ? '#ef4444' : s.fill,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Top Deals + Rotting Deals */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Top Deals */}
        <Card className="shadow-sm">
          <CardContent className="p-5">
            <h3 className="text-sm font-semibold text-slate-800 mb-3 flex items-center gap-2">
              <Trophy className="h-4 w-4 text-amber-500" />
              Top Deals (por valor)
            </h3>
            {topDeals.length > 0 ? (
              <div className="space-y-2">
                {topDeals.map((deal, idx) => (
                  <button
                    key={deal.id}
                    onClick={() => onDealClick(deal.id)}
                    className="w-full flex items-center gap-3 p-2.5 rounded-lg hover:bg-slate-50 transition-colors text-left"
                  >
                    <span className="text-sm font-bold text-slate-400 w-5 text-center">{idx + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-800 truncate">{deal.title}</p>
                      <p className="text-xs text-slate-400 truncate">{deal.contact_name || deal.company_name || '-'}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-semibold text-emerald-600">{formatCurrency(deal.value)}</p>
                      <p className="text-[10px] text-slate-400">{deal.stage_name}</p>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-400 text-center py-6">Nenhum deal com valor</p>
            )}
          </CardContent>
        </Card>

        {/* Rotting Deals */}
        <Card className="shadow-sm">
          <CardContent className="p-5">
            <h3 className="text-sm font-semibold text-slate-800 mb-3 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-500" />
              Deals em Risco (estagnados)
            </h3>
            {rottingDeals.length > 0 ? (
              <div className="space-y-2">
                {rottingDeals.map(deal => (
                  <button
                    key={deal.id}
                    onClick={() => onDealClick(deal.id)}
                    className="w-full flex items-center gap-3 p-2.5 rounded-lg hover:bg-red-50/50 transition-colors text-left border border-red-100"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-800 truncate">{deal.title}</p>
                      <p className="text-xs text-slate-400 truncate">{deal.stage_name || '-'}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-semibold text-red-600">{deal.days_in_stage ?? 0} dias</p>
                      <p className="text-[10px] text-slate-400">na etapa</p>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-sm text-emerald-500 text-center py-6 flex items-center justify-center gap-2">
                <Check className="h-4 w-4" /> Nenhum deal estagnado
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

// ============================================
// KANBAN BOARD
// ============================================

function KanbanBoard({
  stages, wonStage, lostStage, deals, wonDeals, lostDeals,
  wonExpanded, lostExpanded, onToggleWon, onToggleLost,
  onDealClick, onMoveDeal, pipelineId,
}: {
  stages: PipelineStage[]
  wonStage: PipelineStage | undefined
  lostStage: PipelineStage | undefined
  deals: Deal[]
  wonDeals: Deal[]
  lostDeals: Deal[]
  wonExpanded: boolean
  lostExpanded: boolean
  onToggleWon: () => void
  onToggleLost: () => void
  onDealClick: (id: string) => void
  onMoveDeal: (dealId: string, stageId: string) => void
  pipelineId: string | null
}) {
  const queryClient = useQueryClient()
  const [dragDealId, setDragDealId] = useState<string | null>(null)
  const [dragOverStage, setDragOverStage] = useState<string | null>(null)
  const [editingStageId, setEditingStageId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editColor, setEditColor] = useState('')
  const [newStageName, setNewStageName] = useState('')
  const [showAddStage, setShowAddStage] = useState(false)

  const updateStageMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) => crmApi.pipeline.update(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['crm-pipeline'] }),
  })
  const deleteStageMutation = useMutation({
    mutationFn: (id: string) => crmApi.pipeline.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['crm-pipeline'] }),
  })
  const createStageMutation = useMutation({
    mutationFn: (d: Record<string, unknown>) => crmApi.pipeline.create(d),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['crm-pipeline'] }); setNewStageName(''); setShowAddStage(false) },
  })

  const startEditing = (stage: PipelineStage) => {
    setEditingStageId(stage.id)
    setEditName(stage.name)
    setEditColor(stage.color)
  }

  const saveEdit = () => {
    if (editingStageId && editName.trim()) {
      updateStageMutation.mutate({ id: editingStageId, data: { name: editName.trim(), color: editColor } })
    }
    setEditingStageId(null)
  }

  const deleteStage = (id: string) => {
    if (confirm('Excluir esta etapa? Deals nela serao perdidos.')) {
      deleteStageMutation.mutate(id)
      setEditingStageId(null)
    }
  }

  const addStage = () => {
    if (newStageName.trim()) {
      createStageMutation.mutate({ name: newStageName.trim(), position: stages.length, color: '#6366f1', pipeline_id: pipelineId })
    }
  }

  const handleDragOver = (e: React.DragEvent, stageId: string) => {
    e.preventDefault()
    setDragOverStage(stageId)
  }

  const handleDrop = (stageId: string) => {
    if (dragDealId) onMoveDeal(dragDealId, stageId)
    setDragDealId(null)
    setDragOverStage(null)
  }

  const handleDragEnd = () => {
    setDragDealId(null)
    setDragOverStage(null)
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-4 -mx-4 px-4 md:-mx-6 md:px-6">
      {stages.map(stage => {
        const stageDeals = deals.filter(d => d.pipeline_stage_id === stage.id)
        const stageValue = stageDeals.reduce((s, d) => s + (d.value ?? 0), 0)
        const isOver = dragOverStage === stage.id
        const isEditing = editingStageId === stage.id

        return (
          <div
            key={stage.id}
            className={`flex-shrink-0 w-72 flex flex-col rounded-lg transition-colors ${isOver ? 'bg-slate-100' : 'bg-slate-50/80'}`}
            onDragOver={(e) => handleDragOver(e, stage.id)}
            onDragLeave={() => setDragOverStage(null)}
            onDrop={() => handleDrop(stage.id)}
          >
            <div className="px-3 py-2.5 border-b border-slate-200/60">
              {isEditing ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={editColor}
                      onChange={e => setEditColor(e.target.value)}
                      className="h-6 w-6 rounded cursor-pointer border-0 p-0 flex-shrink-0"
                    />
                    <input
                      value={editName}
                      onChange={e => setEditName(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditingStageId(null) }}
                      className="flex-1 text-sm font-medium bg-white border rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-primary"
                      autoFocus
                    />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button onClick={saveEdit} className="flex items-center gap-1 text-xs text-emerald-600 hover:text-emerald-700 font-medium">
                      <Check className="h-3 w-3" /> Salvar
                    </button>
                    <button onClick={() => setEditingStageId(null)} className="text-xs text-slate-400 hover:text-slate-600 font-medium">
                      Cancelar
                    </button>
                    <button onClick={() => deleteStage(stage.id)} className="ml-auto flex items-center gap-1 text-xs text-red-400 hover:text-red-600 font-medium">
                      <Trash2 className="h-3 w-3" /> Excluir
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2 group">
                    <span className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: stage.color }} />
                    <span className="text-sm font-medium text-slate-700 truncate">{stage.name}</span>
                    <button
                      onClick={() => startEditing(stage)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-400 hover:text-slate-600 flex-shrink-0"
                      title="Editar etapa"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    <span className="ml-auto text-xs text-slate-400 font-medium">{stageDeals.length}</span>
                  </div>
                  {stageValue > 0 && (
                    <p className="text-xs text-slate-400 mt-0.5 pl-[18px]">{formatCurrency(stageValue)}</p>
                  )}
                </>
              )}
            </div>
            <div className="flex-1 p-2 space-y-2 min-h-[100px] overflow-y-auto max-h-[calc(100vh-380px)]">
              {stageDeals.map(deal => (
                <DealCard
                  key={deal.id}
                  deal={deal}
                  stage={stage}
                  onDragStart={() => setDragDealId(deal.id)}
                  onDragEnd={handleDragEnd}
                  onClick={() => onDealClick(deal.id)}
                />
              ))}
              {stageDeals.length === 0 && (
                <div className="flex items-center justify-center h-16 text-xs text-slate-400 border border-dashed border-slate-200 rounded-md">
                  Nenhum deal
                </div>
              )}
            </div>
          </div>
        )
      })}

      {/* Add Stage Column */}
      <div className="flex-shrink-0 w-72 flex flex-col rounded-lg bg-slate-50/50 border-2 border-dashed border-slate-200">
        {showAddStage ? (
          <div className="p-3 space-y-2">
            <input
              value={newStageName}
              onChange={e => setNewStageName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addStage(); if (e.key === 'Escape') { setShowAddStage(false); setNewStageName('') } }}
              placeholder="Nome da etapa..."
              className="w-full text-sm bg-white border rounded px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary"
              autoFocus
            />
            <div className="flex gap-2">
              <Button size="sm" className="h-7 text-xs" disabled={!newStageName.trim()} onClick={addStage}>
                <Plus className="h-3 w-3 mr-1" /> Adicionar
              </Button>
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setShowAddStage(false); setNewStageName('') }}>
                Cancelar
              </Button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowAddStage(true)}
            className="flex items-center justify-center gap-2 py-6 text-sm text-slate-400 hover:text-slate-600 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Adicionar etapa
          </button>
        )}
      </div>

      {wonStage && (
        <ClosedColumn
          stage={wonStage} deals={wonDeals} expanded={wonExpanded}
          onToggle={onToggleWon} variant="won" onDealClick={onDealClick}
          onDragOver={(e) => handleDragOver(e, wonStage.id)}
          onDragLeave={() => setDragOverStage(null)}
          onDrop={() => handleDrop(wonStage.id)}
          isOver={dragOverStage === wonStage.id}
        />
      )}
      {lostStage && (
        <ClosedColumn
          stage={lostStage} deals={lostDeals} expanded={lostExpanded}
          onToggle={onToggleLost} variant="lost" onDealClick={onDealClick}
          onDragOver={(e) => handleDragOver(e, lostStage.id)}
          onDragLeave={() => setDragOverStage(null)}
          onDrop={() => handleDrop(lostStage.id)}
          isOver={dragOverStage === lostStage.id}
        />
      )}
    </div>
  )
}

// ============================================
// DEAL CARD (Kanban)
// ============================================

function DealCard({ deal, stage, onDragStart, onDragEnd, onClick }: {
  deal: Deal; stage: PipelineStage; onDragStart: () => void; onDragEnd: () => void; onClick: () => void
}) {
  const agingClass = getAgingBorderClass(deal, stage)
  const daysInStage = deal.days_in_stage ?? daysSince(deal.stage_entered_at)

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
      className={`bg-white rounded-md border border-slate-200/80 p-3 cursor-pointer border-l-[3px] ${agingClass} hover:shadow-md hover:-translate-y-px transition-all duration-150`}
    >
      <p className="text-sm font-medium text-slate-800 line-clamp-2 leading-snug">{deal.title}</p>
      {(deal.contact_name || deal.company_name) && (
        <p className="text-xs text-slate-400 mt-1 truncate">
          {deal.contact_name}{deal.company_name ? ` - ${deal.company_name}` : ''}
        </p>
      )}
      {deal.value != null && deal.value > 0 && (
        <p className="text-sm font-medium text-emerald-600 mt-1.5">{formatCurrency(deal.value)}</p>
      )}
      <div className="flex items-center gap-2 mt-2 text-xs text-slate-400">
        <span className={`h-2 w-2 rounded-full ${temperatureColor(deal.temperature)}`} />
        <span className="flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {daysInStage}d
        </span>
        {deal.source && (
          <span className="flex items-center gap-1 ml-auto">
            {sourceIcon(deal.source)}
          </span>
        )}
      </div>
    </div>
  )
}

// ============================================
// CLOSED COLUMN (Won / Lost)
// ============================================

function ClosedColumn({ stage, deals, expanded, onToggle, variant, onDealClick, onDragOver, onDragLeave, onDrop, isOver }: {
  stage: PipelineStage; deals: Deal[]; expanded: boolean; onToggle: () => void
  variant: 'won' | 'lost'; onDealClick: (id: string) => void
  onDragOver: (e: React.DragEvent) => void; onDragLeave: () => void; onDrop: () => void; isOver: boolean
}) {
  const totalValue = deals.reduce((s, d) => s + (d.value ?? 0), 0)
  const bgColor = variant === 'won' ? 'bg-emerald-50/60' : 'bg-red-50/60'
  const dotColor = variant === 'won' ? 'bg-emerald-500' : 'bg-red-500'

  return (
    <div
      className={`flex-shrink-0 rounded-lg transition-colors ${isOver ? 'bg-slate-100' : bgColor} ${expanded ? 'w-64' : 'w-44'}`}
      onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
    >
      <button onClick={onToggle} className="w-full px-3 py-2.5 border-b border-slate-200/40 flex items-center gap-2 text-left">
        {expanded ? <ChevronDown className="h-3.5 w-3.5 text-slate-400" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-400" />}
        <span className={`h-2.5 w-2.5 rounded-full ${dotColor}`} />
        <span className="text-sm font-medium text-slate-700">{stage.name}</span>
        <span className="ml-auto text-xs text-slate-400">{deals.length}</span>
      </button>
      <div className="px-3 py-2">
        <p className="text-xs text-slate-500">{formatCurrency(totalValue)}</p>
        {expanded && (
          <div className="mt-2 space-y-1.5">
            {deals.slice(0, 10).map(deal => (
              <div
                key={deal.id}
                onClick={() => onDealClick(deal.id)}
                className="bg-white/80 rounded p-2 text-xs cursor-pointer hover:bg-white transition-colors"
              >
                <p className="font-medium text-slate-700 truncate">{deal.title}</p>
                {deal.value != null && <p className="text-slate-400 mt-0.5">{formatCurrency(deal.value)}</p>}
              </div>
            ))}
            {deals.length > 10 && (
              <p className="text-xs text-slate-400 text-center">+{deals.length - 10} mais</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================
// LIST VIEW
// ============================================

function ListView({ deals, stages, sort, onSort, onDealClick }: {
  deals: Deal[]; stages: PipelineStage[]
  sort: { col: string; dir: 'asc' | 'desc' }; onSort: (col: string) => void; onDealClick: (id: string) => void
}) {
  const stageMap = useMemo(() => new Map(stages.map(s => [s.id, s])), [stages])

  const sorted = useMemo(() => {
    const list = [...deals]
    const dir = sort.dir === 'asc' ? 1 : -1
    list.sort((a, b) => {
      switch (sort.col) {
        case 'title': return dir * a.title.localeCompare(b.title)
        case 'value': return dir * ((a.value ?? 0) - (b.value ?? 0))
        case 'days_in_stage': return dir * ((a.days_in_stage ?? 0) - (b.days_in_stage ?? 0))
        case 'stage': return dir * ((a.stage_position ?? 0) - (b.stage_position ?? 0))
        default: return dir * (new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime())
      }
    })
    return list
  }, [deals, sort])

  const columns: { key: string; label: string; sortable: boolean }[] = [
    { key: 'title', label: 'Titulo', sortable: true },
    { key: 'contact', label: 'Contato', sortable: false },
    { key: 'company', label: 'Empresa', sortable: false },
    { key: 'stage', label: 'Etapa', sortable: true },
    { key: 'value', label: 'Valor', sortable: true },
    { key: 'temperature', label: 'Temp.', sortable: false },
    { key: 'days_in_stage', label: 'Dias', sortable: true },
    { key: 'owner', label: 'Responsavel', sortable: false },
    { key: 'updated_at', label: 'Atualizado', sortable: true },
  ]

  return (
    <div className="bg-white rounded-lg border border-slate-200 overflow-hidden shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/50">
              {columns.map(col => (
                <th
                  key={col.key}
                  className={`px-4 py-2.5 text-left text-xs font-medium text-slate-500 uppercase tracking-wider whitespace-nowrap ${col.sortable ? 'cursor-pointer hover:text-slate-700 select-none' : ''}`}
                  onClick={() => col.sortable && onSort(col.key)}
                >
                  <span className="inline-flex items-center gap-1">
                    {col.label}
                    {col.sortable && sort.col === col.key && <ArrowUpDown className="h-3 w-3" />}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((deal, idx) => {
              const stage = deal.pipeline_stage_id ? stageMap.get(deal.pipeline_stage_id) : undefined
              return (
                <tr
                  key={deal.id}
                  onClick={() => onDealClick(deal.id)}
                  className={`border-b border-slate-50 cursor-pointer transition-colors hover:bg-slate-50 ${idx % 2 === 1 ? 'bg-slate-50/30' : ''} ${deal.is_rotting ? 'border-l-2 border-l-red-400' : ''}`}
                >
                  <td className="px-4 py-3 font-medium text-slate-800 max-w-[200px] truncate">{deal.title}</td>
                  <td className="px-4 py-3 text-slate-500 max-w-[140px] truncate">{deal.contact_name || '-'}</td>
                  <td className="px-4 py-3 text-slate-500 max-w-[140px] truncate">{deal.company_name || '-'}</td>
                  <td className="px-4 py-3">
                    {stage && (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: stage.color }} />
                        <span className="text-slate-600 text-xs">{stage.name}</span>
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-emerald-600 font-medium whitespace-nowrap">{formatCurrency(deal.value)}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block h-2.5 w-2.5 rounded-full ${temperatureColor(deal.temperature)}`} title={temperatureLabel(deal.temperature)} />
                  </td>
                  <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{deal.days_in_stage ?? '-'}</td>
                  <td className="px-4 py-3 text-slate-500 max-w-[120px] truncate">{deal.owner_name || '-'}</td>
                  <td className="px-4 py-3 text-slate-400 whitespace-nowrap">{formatDate(deal.updated_at)}</td>
                </tr>
              )
            })}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-12 text-center text-slate-400 text-sm">
                  Nenhum deal encontrado
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ============================================
// DEAL DETAIL MODAL
// ============================================

function DealDetailModal({ dealId, stages, onClose, onMoveDeal }: {
  dealId: string; stages: PipelineStage[]; onClose: () => void; onMoveDeal: (stageId: string) => void
}) {
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState('activities')
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [editingValue, setEditingValue] = useState(false)
  const [valueDraft, setValueDraft] = useState('')
  const [newInsight, setNewInsight] = useState({ category: 'note', content: '' })
  const [newActivity, setNewActivity] = useState({ type: 'note', description: '' })

  const { data, isLoading } = useQuery({
    queryKey: ['crm-deal', dealId],
    queryFn: () => crmApi.deals.get(dealId),
  })

  const { data: contactsData } = useQuery({
    queryKey: ['crm-deal-contacts', dealId],
    queryFn: () => crmApi.deals.contacts.list(dealId),
  })

  const updateMutation = useMutation({
    mutationFn: (updateData: Record<string, unknown>) => crmApi.deals.update(dealId, updateData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['crm-deal', dealId] })
      queryClient.invalidateQueries({ queryKey: ['crm-deals'] })
      queryClient.invalidateQueries({ queryKey: ['crm-stats'] })
    },
  })

  const addInsightMutation = useMutation({
    mutationFn: (d: { category: string; content: string }) => crmApi.deals.addInsight(dealId, d),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['crm-deal', dealId] })
      setNewInsight({ category: 'note', content: '' })
    },
  })

  const addActivityMutation = useMutation({
    mutationFn: (d: { type: string; description?: string }) => crmApi.deals.addActivity(dealId, d),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['crm-deal', dealId] })
      setNewActivity({ type: 'note', description: '' })
    },
  })

  if (isLoading) {
    return (
      <Dialog open onOpenChange={() => onClose()}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Carregando...</DialogTitle><DialogDescription>Aguarde</DialogDescription></DialogHeader>
          <LoadingSpinner />
        </DialogContent>
      </Dialog>
    )
  }

  if (!data) return null

  const deal = data.deal
  const insights = data.insights ?? []
  const activities = data.activities ?? []
  const products = data.products ?? []
  const contacts = contactsData?.contacts ?? []

  const activeStages = stages.filter(s => !s.is_won && !s.is_lost).sort((a, b) => a.position - b.position)
  const wonStage = stages.find(s => s.is_won)
  const lostStage = stages.find(s => s.is_lost)

  const handleSaveTitle = () => {
    if (titleDraft.trim() && titleDraft !== deal.title) updateMutation.mutate({ title: titleDraft.trim() })
    setEditingTitle(false)
  }

  const handleSaveValue = () => {
    const numVal = parseFloat(valueDraft)
    if (!isNaN(numVal)) updateMutation.mutate({ value: numVal })
    setEditingValue(false)
  }

  const submitInsight = () => {
    if (newInsight.content.trim()) addInsightMutation.mutate({ category: newInsight.category, content: newInsight.content.trim() })
  }

  const submitActivity = () => {
    if (newActivity.description.trim()) addActivityMutation.mutate({ type: newActivity.type, description: newActivity.description.trim() })
  }

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto p-0">
        <DialogHeader className="sr-only">
          <DialogTitle>{deal.title}</DialogTitle>
          <DialogDescription>Detalhes do deal</DialogDescription>
        </DialogHeader>

        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-slate-100">
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              {editingTitle ? (
                <div className="flex items-center gap-2">
                  <Input
                    value={titleDraft}
                    onChange={e => setTitleDraft(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleSaveTitle()}
                    autoFocus
                    className="text-lg font-semibold h-auto py-1"
                  />
                  <Button size="sm" variant="ghost" onClick={handleSaveTitle}><Check className="h-4 w-4" /></Button>
                </div>
              ) : (
                <h2
                  className="text-lg font-semibold text-slate-900 cursor-pointer hover:text-slate-600 transition-colors"
                  onClick={() => { setEditingTitle(true); setTitleDraft(deal.title) }}
                >
                  {deal.title}
                  <Edit3 className="inline-block h-3.5 w-3.5 ml-2 text-slate-400" />
                </h2>
              )}
              <p className="text-sm text-slate-400 mt-0.5">Criado em {formatDateFull(deal.created_at)}</p>
            </div>
          </div>

          {/* Stage pills */}
          <div className="flex items-center gap-1 mt-4 overflow-x-auto pb-1">
            {activeStages.map(s => {
              const isCurrent = deal.pipeline_stage_id === s.id
              return (
                <button
                  key={s.id}
                  onClick={() => !isCurrent && onMoveDeal(s.id)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all whitespace-nowrap ${
                    isCurrent ? 'text-white shadow-sm' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                  }`}
                  style={isCurrent ? { backgroundColor: s.color } : undefined}
                >
                  <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: isCurrent ? '#fff' : s.color }} />
                  {s.name}
                </button>
              )
            })}
            {wonStage && (
              <button
                onClick={() => onMoveDeal(wonStage.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all whitespace-nowrap ${deal.status === 'won' ? 'bg-emerald-500 text-white' : 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'}`}
              >
                <Trophy className="h-3 w-3" />
                {wonStage.name}
              </button>
            )}
            {lostStage && (
              <button
                onClick={() => onMoveDeal(lostStage.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all whitespace-nowrap ${deal.status === 'lost' ? 'bg-red-500 text-white' : 'bg-red-50 text-red-600 hover:bg-red-100'}`}
              >
                <X className="h-3 w-3" />
                {lostStage.name}
              </button>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="flex flex-col lg:flex-row">
          {/* Left Column 60% */}
          <div className="flex-[3] px-6 py-4 space-y-5 lg:border-r border-slate-100">
            {/* Contact Info */}
            <section>
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Contato</h3>
              <div className="grid grid-cols-2 gap-3">
                {deal.contact_name && (
                  <div className="flex items-center gap-2 text-sm text-slate-600">
                    <User className="h-4 w-4 text-slate-400 flex-shrink-0" />
                    <span className="truncate">{deal.contact_name}</span>
                  </div>
                )}
                {deal.contact_email && (
                  <div className="flex items-center gap-2 text-sm text-slate-600">
                    <Mail className="h-4 w-4 text-slate-400 flex-shrink-0" />
                    <a href={`mailto:${deal.contact_email}`} className="truncate hover:text-slate-900 transition-colors">{deal.contact_email}</a>
                  </div>
                )}
                {deal.contact_phone && (
                  <div className="flex items-center gap-2 text-sm text-slate-600">
                    <Phone className="h-4 w-4 text-slate-400 flex-shrink-0" />
                    <a href={`https://wa.me/${deal.contact_phone.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer" className="hover:text-slate-900 transition-colors">
                      {deal.contact_phone}
                    </a>
                  </div>
                )}
                {deal.company_name && (
                  <div className="flex items-center gap-2 text-sm text-slate-600">
                    <Building2 className="h-4 w-4 text-slate-400 flex-shrink-0" />
                    <span className="truncate">{deal.company_name}</span>
                  </div>
                )}
              </div>
            </section>

            {/* Insights */}
            <section>
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Insights</h3>
              {insights.length > 0 ? (
                <div className="space-y-2">
                  {insights.map(insight => (
                    <div key={insight.id} className="bg-slate-50 rounded-md p-3">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="secondary" className="text-[10px] h-5">{insight.category}</Badge>
                        <span className="text-[10px] text-slate-400">{formatDate(insight.created_at)}</span>
                      </div>
                      <p className="text-sm text-slate-600">{insight.content}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-400">Nenhum insight registrado</p>
              )}
              <div className="mt-3 flex gap-2">
                <Select value={newInsight.category} onValueChange={v => setNewInsight(p => ({ ...p, category: v }))}>
                  <SelectTrigger className="w-[110px] h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="note">Nota</SelectItem>
                    <SelectItem value="need">Necessidade</SelectItem>
                    <SelectItem value="objection">Objecao</SelectItem>
                    <SelectItem value="budget">Orcamento</SelectItem>
                    <SelectItem value="timeline">Prazo</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  placeholder="Adicionar insight..."
                  value={newInsight.content}
                  onChange={e => setNewInsight(p => ({ ...p, content: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter') submitInsight() }}
                  className="flex-1 h-8 text-sm"
                />
                <Button size="sm" variant="outline" className="h-8" disabled={!newInsight.content.trim() || addInsightMutation.isPending} onClick={submitInsight}>
                  <Lightbulb className="h-3.5 w-3.5" />
                </Button>
              </div>
            </section>

            {/* Products */}
            {products.length > 0 && (
              <section>
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Produtos / Servicos</h3>
                <div className="bg-slate-50 rounded-md overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200/60">
                        <th className="px-3 py-2 text-left text-xs font-medium text-slate-500">Descricao</th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-slate-500">Qtd</th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-slate-500">Unit.</th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-slate-500">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {products.map(p => (
                        <tr key={p.id} className="border-b border-slate-100 last:border-0">
                          <td className="px-3 py-2 text-slate-700">{p.description}</td>
                          <td className="px-3 py-2 text-right text-slate-500">{p.quantity}</td>
                          <td className="px-3 py-2 text-right text-slate-500">{formatCurrency(p.unit_price)}</td>
                          <td className="px-3 py-2 text-right font-medium text-slate-700">{formatCurrency(p.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-slate-100/50">
                        <td colSpan={3} className="px-3 py-2 text-right text-xs font-medium text-slate-500">Total</td>
                        <td className="px-3 py-2 text-right font-semibold text-slate-800">
                          {formatCurrency(products.reduce((s, p) => s + (p.total ?? 0), 0))}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </section>
            )}
          </div>

          {/* Right Column 40% */}
          <div className="flex-[2] px-6 py-4 space-y-4 bg-slate-50/30">
            <div>
              <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">Valor</label>
              {editingValue ? (
                <div className="flex items-center gap-2 mt-1">
                  <Input type="number" value={valueDraft} onChange={e => setValueDraft(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSaveValue()} autoFocus className="h-8 text-sm" />
                  <Button size="sm" variant="ghost" className="h-8" onClick={handleSaveValue}><Check className="h-4 w-4" /></Button>
                </div>
              ) : (
                <p
                  className="text-lg font-semibold text-emerald-600 mt-0.5 cursor-pointer hover:text-emerald-700 transition-colors"
                  onClick={() => { setEditingValue(true); setValueDraft(String(deal.value ?? 0)) }}
                >
                  {formatCurrency(deal.value)}
                  <Edit3 className="inline-block h-3 w-3 ml-1.5 text-slate-400" />
                </p>
              )}
            </div>
            <div>
              <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">Temperatura</label>
              <Select value={deal.temperature} onValueChange={v => updateMutation.mutate({ temperature: v })}>
                <SelectTrigger className="mt-1 h-8 text-sm bg-white"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="hot"><span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-red-500" /> Quente</span></SelectItem>
                  <SelectItem value="warm"><span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-amber-500" /> Morno</span></SelectItem>
                  <SelectItem value="cold"><span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-sky-500" /> Frio</span></SelectItem>
                </SelectContent>
              </Select>
            </div>
            {deal.score != null && (
              <div>
                <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">Score</label>
                <div className="mt-1.5 flex items-center gap-3">
                  <div className="flex-1 h-2 bg-slate-200 rounded-full overflow-hidden">
                    <div className="h-full bg-indigo-500 rounded-full transition-all" style={{ width: `${Math.min(deal.score, 100)}%` }} />
                  </div>
                  <span className="text-sm font-medium text-slate-600 w-8 text-right">{deal.score}</span>
                </div>
              </div>
            )}
            <div>
              <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">Probabilidade</label>
              <p className="text-sm font-medium text-slate-700 mt-0.5">{deal.probability}%</p>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">Fechamento previsto</label>
              <Input
                type="date"
                value={deal.expected_close_date?.split('T')[0] ?? ''}
                onChange={e => updateMutation.mutate({ expected_close_date: e.target.value || null })}
                className="mt-1 h-8 text-sm bg-white"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">Proximo follow-up</label>
              <Input
                type="date"
                value={deal.next_follow_up?.split('T')[0] ?? ''}
                onChange={e => updateMutation.mutate({ next_follow_up: e.target.value || null })}
                className="mt-1 h-8 text-sm bg-white"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">Origem</label>
              <p className="text-sm text-slate-600 mt-0.5 flex items-center gap-1.5">
                {sourceIcon(deal.source)}
                {sourceLabel(deal.source)}
              </p>
            </div>
            {deal.tags && deal.tags.length > 0 && (
              <div>
                <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">Tags</label>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {deal.tags.map(tag => (
                    <Badge key={tag} variant="outline" className="text-xs">{tag}</Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Bottom Tabs */}
        <div className="border-t border-slate-100 px-6 py-4">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList>
              <TabsTrigger value="activities">Atividades</TabsTrigger>
              <TabsTrigger value="contacts">Contatos</TabsTrigger>
            </TabsList>

            <TabsContent value="activities" className="mt-4">
              <div className="flex gap-2 mb-4">
                <Select value={newActivity.type} onValueChange={v => setNewActivity(p => ({ ...p, type: v }))}>
                  <SelectTrigger className="w-[120px] h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="note">Nota</SelectItem>
                    <SelectItem value="call">Ligacao</SelectItem>
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="meeting">Reuniao</SelectItem>
                    <SelectItem value="whatsapp">WhatsApp</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  placeholder="Registrar atividade..."
                  value={newActivity.description}
                  onChange={e => setNewActivity(p => ({ ...p, description: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter') submitActivity() }}
                  className="flex-1 h-8 text-sm"
                />
                <Button size="sm" variant="outline" className="h-8" disabled={!newActivity.description.trim() || addActivityMutation.isPending} onClick={submitActivity}>
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="space-y-0">
                {activities.map((act, idx) => (
                  <div key={act.id} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <div className="h-7 w-7 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 flex-shrink-0">
                        {activityIcon(act.type)}
                      </div>
                      {idx < activities.length - 1 && <div className="w-px flex-1 bg-slate-200 my-1" />}
                    </div>
                    <div className="pb-4 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-slate-600 capitalize">{act.type}</span>
                        {act.user_name && <span className="text-xs text-slate-400">por {act.user_name}</span>}
                        <span className="text-xs text-slate-400 ml-auto whitespace-nowrap">{formatDate(act.created_at)}</span>
                      </div>
                      {act.description && <p className="text-sm text-slate-600 mt-0.5">{act.description}</p>}
                    </div>
                  </div>
                ))}
                {activities.length === 0 && (
                  <p className="text-sm text-slate-400 py-4 text-center">Nenhuma atividade registrada</p>
                )}
              </div>
            </TabsContent>

            <TabsContent value="contacts" className="mt-4">
              <div className="grid gap-3 sm:grid-cols-2">
                {contacts.map(c => (
                  <div key={c.id} className="bg-slate-50 rounded-lg p-3">
                    <div className="flex items-center gap-2">
                      <div className="h-8 w-8 rounded-full bg-slate-200 flex items-center justify-center text-xs font-medium text-slate-600">
                        {c.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-700 truncate">{c.name}</p>
                        {c.role && <Badge variant="secondary" className="text-[10px] h-4 mt-0.5">{c.role}</Badge>}
                      </div>
                      {c.is_primary && <Badge variant="outline" className="text-[10px] h-4 ml-auto">Principal</Badge>}
                    </div>
                    <div className="mt-2 space-y-1">
                      {c.email && <p className="text-xs text-slate-500 flex items-center gap-1.5"><Mail className="h-3 w-3" />{c.email}</p>}
                      {c.phone && <p className="text-xs text-slate-500 flex items-center gap-1.5"><Phone className="h-3 w-3" />{c.phone}</p>}
                    </div>
                  </div>
                ))}
                {contacts.length === 0 && (
                  <p className="text-sm text-slate-400 py-4 text-center col-span-2">Nenhum contato adicional</p>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ============================================
// NEW DEAL MODAL
// ============================================

function NewDealModal({ stages, pipelineId, onClose }: { stages: PipelineStage[]; pipelineId: string | null; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState({
    title: '', contact_name: '', contact_phone: '', contact_email: '',
    company_name: '', value: '', source: 'inbound', temperature: 'warm',
    pipeline_stage_id: stages[0]?.id ?? '', notes: '',
  })

  const createMutation = useMutation({
    mutationFn: (d: Record<string, unknown>) => crmApi.deals.create(d),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['crm-deals'] })
      queryClient.invalidateQueries({ queryKey: ['crm-stats'] })
      queryClient.invalidateQueries({ queryKey: ['crm-pipelines'] })
      onClose()
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.title.trim()) return
    createMutation.mutate({
      title: form.title.trim(),
      contact_name: form.contact_name.trim() || null,
      contact_phone: form.contact_phone.trim() || null,
      contact_email: form.contact_email.trim() || null,
      company_name: form.company_name.trim() || null,
      value: form.value ? parseFloat(form.value) : null,
      source: form.source,
      temperature: form.temperature,
      pipeline_stage_id: form.pipeline_stage_id,
      pipeline_id: pipelineId,
    })
  }

  const u = (field: string, value: string) => setForm(p => ({ ...p, [field]: value }))

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Novo Lead</DialogTitle>
          <DialogDescription>Preencha as informacoes do lead</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="text-xs font-medium text-slate-600 mb-1 block">Titulo *</label>
              <Input value={form.title} onChange={e => u('title', e.target.value)} placeholder="Ex: Projeto app mobile" className="text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">Nome do contato</label>
              <Input value={form.contact_name} onChange={e => u('contact_name', e.target.value)} placeholder="Nome" className="text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">Telefone</label>
              <Input value={form.contact_phone} onChange={e => u('contact_phone', e.target.value)} placeholder="(11) 99999-9999" className="text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">Email</label>
              <Input type="email" value={form.contact_email} onChange={e => u('contact_email', e.target.value)} placeholder="email@empresa.com" className="text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">Empresa</label>
              <Input value={form.company_name} onChange={e => u('company_name', e.target.value)} placeholder="Empresa" className="text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">Valor (R$)</label>
              <Input type="number" value={form.value} onChange={e => u('value', e.target.value)} placeholder="0,00" className="text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">Etapa</label>
              <Select value={form.pipeline_stage_id} onValueChange={v => u('pipeline_stage_id', v)}>
                <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {stages.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">Origem</label>
              <Select value={form.source} onValueChange={v => u('source', v)}>
                <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="whatsapp">WhatsApp</SelectItem>
                  <SelectItem value="indicacao">Indicacao</SelectItem>
                  <SelectItem value="inbound">Inbound</SelectItem>
                  <SelectItem value="outbound">Outbound</SelectItem>
                  <SelectItem value="evento">Evento</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">Temperatura</label>
              <Select value={form.temperature} onValueChange={v => u('temperature', v)}>
                <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="hot">Quente</SelectItem>
                  <SelectItem value="warm">Morno</SelectItem>
                  <SelectItem value="cold">Frio</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2">
              <label className="text-xs font-medium text-slate-600 mb-1 block">Observacoes</label>
              <Textarea value={form.notes} onChange={e => u('notes', e.target.value)} placeholder="Notas sobre o lead..." rows={2} className="text-sm" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={!form.title.trim() || createMutation.isPending}>
              {createMutation.isPending ? 'Criando...' : 'Criar Lead'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ============================================
// AUTOMATIONS MODAL
// ============================================

function AutomationsModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient()
  const [showNew, setShowNew] = useState(false)
  const [newForm, setNewForm] = useState({
    name: '', trigger_type: 'stage_change',
    trigger_config: {} as Record<string, unknown>,
    action_type: 'send_notification',
    action_config: {} as Record<string, unknown>,
  })

  const { data, isLoading } = useQuery({
    queryKey: ['crm-automations'],
    queryFn: () => crmApi.automations.list(),
  })

  const toggleMutation = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) => crmApi.automations.update(id, { is_active }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['crm-automations'] }),
  })

  const createMutation = useMutation({
    mutationFn: (d: Record<string, unknown>) => crmApi.automations.create(d),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['crm-automations'] })
      setShowNew(false)
      setNewForm({ name: '', trigger_type: 'stage_change', trigger_config: {}, action_type: 'send_notification', action_config: {} })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => crmApi.automations.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['crm-automations'] }),
  })

  const automations = data?.automations ?? []

  const triggerTypes = [
    { value: 'stage_change', label: 'Mudanca de etapa' },
    { value: 'deal_created', label: 'Deal criado' },
    { value: 'deal_rotting', label: 'Deal parado' },
    { value: 'value_change', label: 'Valor alterado' },
    { value: 'temperature_change', label: 'Temperatura alterada' },
  ]

  const actionTypes = [
    { value: 'send_notification', label: 'Enviar notificacao' },
    { value: 'send_email', label: 'Enviar email' },
    { value: 'send_whatsapp', label: 'Enviar WhatsApp' },
    { value: 'create_task', label: 'Criar tarefa' },
    { value: 'update_deal', label: 'Atualizar deal' },
  ]

  const handleCreate = () => {
    if (newForm.name.trim()) {
      createMutation.mutate({
        name: newForm.name.trim(),
        trigger_type: newForm.trigger_type,
        trigger_config: newForm.trigger_config,
        action_type: newForm.action_type,
        action_config: newForm.action_config,
      })
    }
  }

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Automacoes</DialogTitle>
          <DialogDescription>Configure acoes automaticas para o pipeline</DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <LoadingSpinner />
        ) : (
          <div className="space-y-3 max-h-[350px] overflow-y-auto">
            {automations.map(auto => (
              <div key={auto.id} className="flex items-center gap-3 bg-slate-50 rounded-md p-3 group">
                <button
                  onClick={() => toggleMutation.mutate({ id: auto.id, is_active: !auto.is_active })}
                  className={`h-5 w-9 rounded-full relative flex-shrink-0 transition-colors ${auto.is_active ? 'bg-emerald-500' : 'bg-slate-300'}`}
                >
                  <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${auto.is_active ? 'translate-x-4' : 'translate-x-0.5'}`} />
                </button>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-700 truncate">{auto.name}</p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {triggerTypes.find(t => t.value === auto.trigger_type)?.label ?? auto.trigger_type}
                    {' -> '}
                    {actionTypes.find(t => t.value === auto.action_type)?.label ?? auto.action_type}
                  </p>
                </div>
                <Button
                  variant="ghost" size="sm"
                  className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500"
                  onClick={() => deleteMutation.mutate(auto.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
            {automations.length === 0 && !showNew && (
              <p className="text-sm text-slate-400 text-center py-6">Nenhuma automacao configurada</p>
            )}
          </div>
        )}

        {showNew && (
          <div className="border border-slate-200 rounded-md p-4 space-y-3 bg-white">
            <Input placeholder="Nome da automacao" value={newForm.name} onChange={e => setNewForm(p => ({ ...p, name: e.target.value }))} className="text-sm" />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-slate-500 mb-1 block">Gatilho</label>
                <Select value={newForm.trigger_type} onValueChange={v => setNewForm(p => ({ ...p, trigger_type: v }))}>
                  <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {triggerTypes.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-500 mb-1 block">Acao</label>
                <Select value={newForm.action_type} onValueChange={v => setNewForm(p => ({ ...p, action_type: v }))}>
                  <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {actionTypes.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setShowNew(false)}>Cancelar</Button>
              <Button size="sm" disabled={!newForm.name.trim() || createMutation.isPending} onClick={handleCreate}>Salvar</Button>
            </div>
          </div>
        )}

        <div className="flex justify-between pt-2">
          {!showNew && (
            <Button variant="outline" size="sm" onClick={() => setShowNew(true)}>
              <Plus className="h-3.5 w-3.5 mr-1.5" /> Nova Automacao
            </Button>
          )}
          <Button variant="outline" onClick={onClose} className="ml-auto">Fechar</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
