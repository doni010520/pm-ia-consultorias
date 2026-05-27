import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { Route, Users, TrendingUp, Clock, Filter } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { PageContainer } from '@/components/layout/PageContainer'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'
import { crmApi } from '@/services/api'

// ============================================
// Helpers
// ============================================

const EVENT_LABELS: Record<string, string> = {
  lead_created: 'Lead Criado',
  triagem_entered: 'Entrou na Triagem',
  qualified: 'Qualificado',
  owner_assigned: 'Executivo Atribuído',
  first_response: '1ª Resposta',
  meeting_scheduled: 'Reunião Agendada',
  proposal_sent: 'Proposta Enviada',
  negotiation_started: 'Negociação',
  won: 'Ganho',
  lost: 'Perdido',
}

const EVENT_COLORS: Record<string, string> = {
  lead_created: '#94a3b8',
  triagem_entered: '#60a5fa',
  qualified: '#818cf8',
  owner_assigned: '#a78bfa',
  first_response: '#34d399',
  meeting_scheduled: '#10b981',
  proposal_sent: '#f59e0b',
  negotiation_started: '#f97316',
  won: '#22c55e',
  lost: '#ef4444',
}

const FUNNEL_ORDER = [
  'lead_created', 'triagem_entered', 'qualified', 'owner_assigned',
  'first_response', 'meeting_scheduled', 'proposal_sent', 'negotiation_started',
  'won', 'lost',
]

const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: 'WhatsApp', email: 'E-mail', form: 'Formulário',
  manual: 'Manual', import: 'Importação', direct: 'Direto', unknown: 'Desconhecido',
}

function formatHours(hours: number | null | undefined): string {
  if (hours == null) return '-'
  if (hours < 24) return `${Math.round(hours)}h`
  return `${Math.round(hours / 24)}d`
}

// ============================================
// Page
// ============================================

export default function LeadJourney() {
  const [channel, setChannel] = useState<string>('all')
  const [period, setPeriod] = useState<string>('30d')

  const dateRange = () => {
    const to = new Date().toISOString()
    const from = new Date()
    if (period === '7d') from.setDate(from.getDate() - 7)
    else if (period === '30d') from.setDate(from.getDate() - 30)
    else if (period === '90d') from.setDate(from.getDate() - 90)
    else return {}
    return { from: from.toISOString(), to }
  }

  const { data: funnelData, isLoading: funnelLoading } = useQuery({
    queryKey: ['crm-journey-funnel', channel, period],
    queryFn: () => crmApi.journey.funnel({
      ...dateRange(),
      ...(channel !== 'all' ? { first_channel: channel } : {}),
    }),
  })

  const { data: sourcesData, isLoading: sourcesLoading } = useQuery({
    queryKey: ['crm-journey-sources', period],
    queryFn: () => crmApi.journey.sources(dateRange()),
  })

  const funnelRows = funnelData?.funnel ?? []
  const totalLeads = funnelData?.total_leads ?? 0
  const sources = sourcesData?.sources ?? []

  // Ordenar e completar o funil
  const orderedFunnel = FUNNEL_ORDER.flatMap(eventType => {
    const row = funnelRows.find(r => r.event_type === eventType)
    if (!row) return []
    return [{
      name: EVENT_LABELS[eventType] ?? eventType,
      event_type: eventType,
      deals: Number(row.deals_reached),
      avg_time: row.avg_hours_from_creation,
      pct: totalLeads > 0 ? Math.round((Number(row.deals_reached) / totalLeads) * 100) : 0,
    }]
  })

  return (
    <PageContainer>
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-1">
          <Route className="h-6 w-6 text-indigo-600" />
          <h1 className="text-xl font-semibold text-slate-900">Jornada do Lead</h1>
        </div>
        <p className="text-sm text-slate-500">Rastreabilidade completa do caminho percorrido por cada lead</p>
      </div>

      {/* Filtros */}
      <div className="flex gap-3 mb-6 flex-wrap">
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Filter className="h-4 w-4" />
          <span>Filtros:</span>
        </div>
        <Select value={period} onValueChange={setPeriod}>
          <SelectTrigger className="w-[130px] h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="7d">Últimos 7 dias</SelectItem>
            <SelectItem value="30d">Últimos 30 dias</SelectItem>
            <SelectItem value="90d">Últimos 90 dias</SelectItem>
            <SelectItem value="all">Todo período</SelectItem>
          </SelectContent>
        </Select>
        <Select value={channel} onValueChange={setChannel}>
          <SelectTrigger className="w-[150px] h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os canais</SelectItem>
            <SelectItem value="whatsapp">WhatsApp</SelectItem>
            <SelectItem value="email">E-mail</SelectItem>
            <SelectItem value="form">Formulário</SelectItem>
            <SelectItem value="manual">Manual</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Users className="h-4 w-4 text-slate-400" />
              <span className="text-xs text-slate-500 uppercase tracking-wider">Total leads</span>
            </div>
            <p className="text-2xl font-semibold text-slate-900">{totalLeads}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="h-4 w-4 text-emerald-500" />
              <span className="text-xs text-slate-500 uppercase tracking-wider">Taxa de ganho</span>
            </div>
            <p className="text-2xl font-semibold text-emerald-600">
              {totalLeads > 0
                ? `${Math.round(((orderedFunnel.find(r => r.event_type === 'won')?.deals ?? 0) / totalLeads) * 100)}%`
                : '-'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Clock className="h-4 w-4 text-slate-400" />
              <span className="text-xs text-slate-500 uppercase tracking-wider">Tempo 1ª resposta</span>
            </div>
            <p className="text-2xl font-semibold text-slate-900">
              {formatHours(orderedFunnel.find(r => r.event_type === 'first_response')?.avg_time)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Route className="h-4 w-4 text-indigo-400" />
              <span className="text-xs text-slate-500 uppercase tracking-wider">Tempo até ganho</span>
            </div>
            <p className="text-2xl font-semibold text-slate-900">
              {formatHours(orderedFunnel.find(r => r.event_type === 'won')?.avg_time)}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Funil */}
        <div className="lg:col-span-2">
          <Card>
            <CardContent className="p-5">
              <h2 className="text-sm font-semibold text-slate-700 mb-4">Funil de Eventos</h2>
              {funnelLoading ? (
                <div className="flex justify-center py-8"><LoadingSpinner /></div>
              ) : orderedFunnel.length === 0 ? (
                <p className="text-sm text-slate-400 py-8 text-center">
                  Nenhum evento registrado no período.<br />
                  <span className="text-xs">Os eventos começam a ser gravados a partir do deploy da migration 009.</span>
                </p>
              ) : (
                <>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={orderedFunnel} layout="vertical" margin={{ left: 10, right: 30 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 11 }} />
                      <YAxis dataKey="name" type="category" width={130} tick={{ fontSize: 11 }} />
                      <Tooltip
                        formatter={(value, _name, entry) => [
                          `${value} leads (${(entry as { payload?: { pct?: number } }).payload?.pct ?? 0}%)`,
                          'Alcançaram',
                        ]}
                      />
                      <Bar dataKey="deals" radius={[0, 4, 4, 0]}>
                        {orderedFunnel.map(entry => (
                          <Cell key={entry.event_type} fill={EVENT_COLORS[entry.event_type] ?? '#94a3b8'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>

                  {/* Tabela de tempo médio */}
                  <div className="mt-4 border border-slate-100 rounded-lg overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium text-slate-500">Evento</th>
                          <th className="px-3 py-2 text-right font-medium text-slate-500">Leads</th>
                          <th className="px-3 py-2 text-right font-medium text-slate-500">% do total</th>
                          <th className="px-3 py-2 text-right font-medium text-slate-500">Tempo médio</th>
                        </tr>
                      </thead>
                      <tbody>
                        {orderedFunnel.map(row => (
                          <tr key={row.event_type} className="border-t border-slate-50">
                            <td className="px-3 py-2">
                              <div className="flex items-center gap-2">
                                <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: EVENT_COLORS[row.event_type] ?? '#94a3b8' }} />
                                {row.name}
                              </div>
                            </td>
                            <td className="px-3 py-2 text-right font-medium text-slate-700">{row.deals}</td>
                            <td className="px-3 py-2 text-right text-slate-500">{row.pct}%</td>
                            <td className="px-3 py-2 text-right text-slate-500">{formatHours(row.avg_time)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Origem dos leads */}
        <div>
          <Card>
            <CardContent className="p-5">
              <h2 className="text-sm font-semibold text-slate-700 mb-4">Origem dos Leads</h2>
              {sourcesLoading ? (
                <div className="flex justify-center py-8"><LoadingSpinner /></div>
              ) : sources.length === 0 ? (
                <p className="text-sm text-slate-400 py-8 text-center">Nenhum dado de origem disponível</p>
              ) : (
                <div className="space-y-3">
                  {sources.map((s, i) => {
                    const wonRate = s.leads > 0 ? Math.round((s.won / s.leads) * 100) : 0
                    return (
                      <div key={i} className="p-3 bg-slate-50 rounded-lg">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <Badge variant="secondary" className="text-[10px]">
                              {CHANNEL_LABELS[s.channel] ?? s.channel}
                            </Badge>
                            {s.utm_source !== 'direct' && s.utm_source && (
                              <span className="text-[10px] text-slate-400">{s.utm_source}</span>
                            )}
                          </div>
                          <span className="text-sm font-semibold text-slate-700">{s.leads}</span>
                        </div>
                        {s.utm_campaign && (
                          <p className="text-[10px] text-slate-400 mb-1">Campanha: {s.utm_campaign}</p>
                        )}
                        <div className="flex items-center gap-2 mt-1">
                          <div className="flex-1 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-emerald-400 rounded-full"
                              style={{ width: `${wonRate}%` }}
                            />
                          </div>
                          <span className="text-[10px] text-emerald-600 font-medium w-10 text-right">{wonRate}% ganho</span>
                        </div>
                        <div className="flex gap-3 mt-1.5 text-[10px] text-slate-400">
                          <span className="text-emerald-600">✓ {s.won} ganho{s.won !== 1 ? 's' : ''}</span>
                          <span className="text-red-400">✗ {s.lost} perdido{s.lost !== 1 ? 's' : ''}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </PageContainer>
  )
}
