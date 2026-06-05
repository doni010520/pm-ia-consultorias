import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  Users, UserX, UserCheck, AlertTriangle, Filter, ArrowRight, Target, Route,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PageContainer } from '@/components/layout/PageContainer'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'
import { crmApi } from '@/services/api'

const PERIOD_LABEL: Record<string, string> = {
  '7d': 'últimos 7 dias',
  '30d': 'últimos 30 dias',
  '90d': 'últimos 90 dias',
  all: 'todo o período',
}

export default function Overview() {
  const navigate = useNavigate()
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

  const { data, isLoading } = useQuery({
    queryKey: ['crm-overview-distribution', period],
    queryFn: () => crmApi.journey.distribution(dateRange()),
  })

  const total = data?.total_leads ?? 0
  const undistributed = data?.undistributed ?? 0
  const distributed = data?.distributed ?? 0
  const undistPct = total > 0 ? Math.round((undistributed / total) * 100) : 0
  const distPct = total > 0 ? Math.round((distributed / total) * 100) : 0
  const byExec = data?.by_executive ?? []
  const maxExec = byExec.reduce((m, e) => Math.max(m, e.leads), 0)
  const undistByPipeline = data?.undistributed_by_pipeline ?? []

  return (
    <PageContainer>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Visão Geral — Comercial</h1>
          <p className="text-sm text-slate-500">Como está a entrada e a distribuição dos seus leads</p>
        </div>
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-slate-400" />
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-[150px] h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="7d">Últimos 7 dias</SelectItem>
              <SelectItem value="30d">Últimos 30 dias</SelectItem>
              <SelectItem value="90d">Últimos 90 dias</SelectItem>
              <SelectItem value="all">Todo período</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><LoadingSpinner /></div>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <Card>
              <CardContent className="p-5">
                <div className="flex items-center gap-2 mb-1">
                  <Users className="h-4 w-4 text-slate-400" />
                  <span className="text-xs text-slate-500 uppercase tracking-wider">Leads no período</span>
                </div>
                <p className="text-3xl font-bold text-slate-900">{total}</p>
                <p className="text-xs text-slate-400 mt-0.5">{PERIOD_LABEL[period]}</p>
              </CardContent>
            </Card>

            <Card className={undistPct >= 40 ? 'border-red-200' : undistPct >= 15 ? 'border-amber-200' : ''}>
              <CardContent className="p-5">
                <div className="flex items-center gap-2 mb-1">
                  {undistPct >= 40
                    ? <AlertTriangle className="h-4 w-4 text-red-500" />
                    : <UserX className="h-4 w-4 text-amber-500" />}
                  <span className="text-xs text-slate-500 uppercase tracking-wider">Sem executivo</span>
                </div>
                <p className={`text-3xl font-bold ${undistPct >= 40 ? 'text-red-600' : 'text-amber-600'}`}>
                  {undistributed}
                </p>
                <p className="text-xs text-slate-400 mt-0.5">{undistPct}% dos leads ainda não foram distribuídos</p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-5">
                <div className="flex items-center gap-2 mb-1">
                  <UserCheck className="h-4 w-4 text-emerald-500" />
                  <span className="text-xs text-slate-500 uppercase tracking-wider">Distribuídos</span>
                </div>
                <p className="text-3xl font-bold text-emerald-600">{distributed}</p>
                <p className="text-xs text-slate-400 mt-0.5">{distPct}% encaminhados a executivos</p>
              </CardContent>
            </Card>
          </div>

          <div className="grid lg:grid-cols-3 gap-6">
            {/* Leads por executivo */}
            <div className="lg:col-span-2">
              <Card>
                <CardContent className="p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-sm font-semibold text-slate-700">Leads por executivo</h2>
                    <button
                      onClick={() => navigate('/crm/journey')}
                      className="text-xs text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
                    >
                      Ver jornada completa <ArrowRight className="h-3 w-3" />
                    </button>
                  </div>
                  {byExec.length === 0 ? (
                    <p className="text-sm text-slate-400 py-8 text-center">Nenhum lead distribuído no período.</p>
                  ) : (
                    <div className="space-y-2.5">
                      {byExec.map(e => (
                        <div key={e.executive} className="space-y-1">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-medium text-slate-700">{e.executive}</span>
                            <span className="text-slate-400">
                              <span className="font-semibold text-slate-600">{e.leads}</span> leads
                              {e.open > 0 && <> · {e.open} em aberto</>}
                              {e.lost > 0 && <> · <span className="text-red-400">{e.lost} perdidos</span></>}
                            </span>
                          </div>
                          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-indigo-500 rounded-full"
                              style={{ width: `${maxExec > 0 ? (e.leads / maxExec) * 100 : 0}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Não distribuídos: onde estão parados */}
            <div>
              <Card>
                <CardContent className="p-5">
                  <h2 className="text-sm font-semibold text-slate-700 mb-4">Leads parados (sem executivo)</h2>
                  {undistByPipeline.length === 0 ? (
                    <p className="text-sm text-slate-400 py-8 text-center">Tudo distribuído. 🎉</p>
                  ) : (
                    <div className="space-y-2">
                      {undistByPipeline.map(p => (
                        <div key={p.pipeline} className="flex items-center justify-between p-2.5 rounded-lg bg-amber-50 border border-amber-100">
                          <span className="text-xs font-medium text-slate-700 truncate">{p.pipeline}</span>
                          <span className="text-sm font-bold text-amber-600 flex-shrink-0 ml-2">{p.leads}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <button
                    onClick={() => navigate('/crm')}
                    className="mt-4 w-full flex items-center justify-center gap-1.5 text-xs text-slate-600 hover:text-slate-900 border border-slate-200 rounded-lg py-2 transition-colors"
                  >
                    <Target className="h-3.5 w-3.5" /> Abrir o CRM
                  </button>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Atalhos */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-6">
            <button onClick={() => navigate('/crm')} className="flex items-center gap-2 p-3 rounded-lg border border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm transition-all text-left">
              <Target className="h-5 w-5 text-indigo-500" />
              <div>
                <p className="text-sm font-medium text-slate-800">CRM</p>
                <p className="text-[11px] text-slate-400">Funis e negócios</p>
              </div>
            </button>
            <button onClick={() => navigate('/crm/journey')} className="flex items-center gap-2 p-3 rounded-lg border border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm transition-all text-left">
              <Route className="h-5 w-5 text-indigo-500" />
              <div>
                <p className="text-sm font-medium text-slate-800">Jornada do Lead</p>
                <p className="text-[11px] text-slate-400">Funil e origem</p>
              </div>
            </button>
            <button onClick={() => navigate('/rica')} className="flex items-center gap-2 p-3 rounded-lg border border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm transition-all text-left">
              <Users className="h-5 w-5 text-indigo-500" />
              <div>
                <p className="text-sm font-medium text-slate-800">Rica AI</p>
                <p className="text-[11px] text-slate-400">Desempenho do bot</p>
              </div>
            </button>
          </div>
        </>
      )}
    </PageContainer>
  )
}
