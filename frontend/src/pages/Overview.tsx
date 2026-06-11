import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle, Clock, UserX, Target, TrendingDown,
  Database, CheckCircle2, ArrowRight,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { PageContainer } from '@/components/layout/PageContainer'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'
import { crmApi } from '@/services/api'

function pct(part: number, total: number) {
  return total > 0 ? Math.round((part / total) * 100) : 0
}

function daysSince(iso: string) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
}

function StaleBadge({ days }: { days: number }) {
  if (days === 0) return <span className="text-emerald-600 font-medium">0</span>
  if (days <= 3) return <span className="text-amber-500 font-medium">{days}</span>
  return <span className="text-red-500 font-bold">{days}</span>
}

export default function Overview() {
  const navigate = useNavigate()

  const { data, isLoading } = useQuery({
    queryKey: ['crm-manager-overview'],
    queryFn: () => crmApi.manager.overview(),
    refetchInterval: 5 * 60 * 1000,
  })

  if (isLoading) {
    return (
      <PageContainer>
        <div className="flex justify-center py-24"><LoadingSpinner /></div>
      </PageContainer>
    )
  }

  const health = data?.health ?? { total_open: 0, stopped_7d: 0, stopped_30d: 0, stopped_60d: 0 }
  const accountability = data?.accountability ?? []
  const friction = data?.friction ?? []
  const discipline = data?.discipline ?? { total: 0, open_total: 0, no_owner: 0, open_no_owner: 0, no_value: 0, won_no_value: 0 }

  const healthPct7 = pct(health.stopped_7d, health.total_open)
  const noOwnerPct = pct(discipline.open_no_owner, discipline.open_total)
  const noValuePct = pct(discipline.no_value, discipline.total)

  return (
    <PageContainer>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-slate-900">Cockpit do Gestor</h1>
        <p className="text-sm text-slate-500">O que está travado, quem está atrasado e onde os leads morrem</p>
      </div>

      {/* ── 1. SAÚDE DO PIPELINE ────────────────────────────── */}
      <div className="mb-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-3">
          Saúde do pipeline
        </p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Target className="h-4 w-4 text-slate-400" />
              <span className="text-[11px] text-slate-500 uppercase tracking-wide">Abertos</span>
            </div>
            <p className="text-2xl font-bold text-slate-900">{health.total_open}</p>
            <p className="text-[11px] text-slate-400 mt-0.5">leads em andamento</p>
          </CardContent>
        </Card>

        <Card className={healthPct7 >= 50 ? 'border-amber-300' : ''}>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Clock className="h-4 w-4 text-amber-400" />
              <span className="text-[11px] text-slate-500 uppercase tracking-wide">+7 dias parados</span>
            </div>
            <p className={`text-2xl font-bold ${healthPct7 >= 50 ? 'text-amber-600' : 'text-slate-700'}`}>
              {health.stopped_7d}
            </p>
            <p className="text-[11px] text-slate-400 mt-0.5">{healthPct7}% dos abertos</p>
          </CardContent>
        </Card>

        <Card className={health.stopped_30d > 0 ? 'border-orange-200' : ''}>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Clock className="h-4 w-4 text-orange-400" />
              <span className="text-[11px] text-slate-500 uppercase tracking-wide">+30 dias parados</span>
            </div>
            <p className={`text-2xl font-bold ${health.stopped_30d > 0 ? 'text-orange-600' : 'text-slate-700'}`}>
              {health.stopped_30d}
            </p>
            <p className="text-[11px] text-slate-400 mt-0.5">{pct(health.stopped_30d, health.total_open)}% dos abertos</p>
          </CardContent>
        </Card>

        <Card className={health.stopped_60d > 0 ? 'border-red-300' : ''}>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle className="h-4 w-4 text-red-400" />
              <span className="text-[11px] text-slate-500 uppercase tracking-wide">+60 dias parados</span>
            </div>
            <p className={`text-2xl font-bold ${health.stopped_60d > 0 ? 'text-red-600' : 'text-slate-700'}`}>
              {health.stopped_60d}
            </p>
            <p className="text-[11px] text-slate-400 mt-0.5">esquecidos</p>
          </CardContent>
        </Card>
      </div>

      {/* ── 2+3. ACCOUNTABILITY + GARGALOS ──────────────────── */}
      <div className="grid lg:grid-cols-3 gap-5 mb-6">

        {/* Accountability */}
        <div className="lg:col-span-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-3">
            Responsabilidade por executivo
          </p>
          <Card>
            <CardContent className="p-0">
              {accountability.length === 0 ? (
                <p className="text-sm text-slate-400 py-8 text-center">Nenhum lead distribuído ainda.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100">
                      <th className="text-left text-[10px] font-semibold uppercase text-slate-400 px-4 py-2.5">Executivo</th>
                      <th className="text-right text-[10px] font-semibold uppercase text-slate-400 px-3 py-2.5">Abertos</th>
                      <th className="text-right text-[10px] font-semibold uppercase text-slate-400 px-3 py-2.5">+7d parados</th>
                      <th className="text-right text-[10px] font-semibold uppercase text-slate-400 px-3 py-2.5">+30d parados</th>
                      <th className="text-right text-[10px] font-semibold uppercase text-slate-400 px-4 py-2.5">Última mov.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accountability.map((exec) => (
                      <tr key={exec.executive} className="border-b border-slate-50 hover:bg-slate-50">
                        <td className="px-4 py-2.5 font-medium text-slate-800">{exec.executive}</td>
                        <td className="px-3 py-2.5 text-right text-slate-600">{exec.total_leads}</td>
                        <td className="px-3 py-2.5 text-right">
                          <StaleBadge days={exec.stale_7d} />
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          {exec.stale_30d > 0
                            ? <span className="text-red-600 font-bold">{exec.stale_30d}</span>
                            : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-4 py-2.5 text-right text-slate-400 text-xs">
                          {exec.last_activity
                            ? `${daysSince(exec.last_activity)}d atrás`
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Gargalos */}
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-3">
            Onde os leads morrem
          </p>
          <Card>
            <CardContent className="p-4">
              {friction.length === 0 ? (
                <p className="text-sm text-slate-400 py-8 text-center">Nenhum gargalo identificado.</p>
              ) : (
                <div className="space-y-3">
                  {friction.map((f) => (
                    <div key={`${f.pipeline}-${f.stage}`}>
                      <div className="flex items-center justify-between mb-0.5">
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-slate-700 truncate">{f.stage}</p>
                          <p className="text-[10px] text-slate-400 truncate">{f.pipeline}</p>
                        </div>
                        <span className={`text-sm font-bold flex-shrink-0 ml-2 ${
                          f.loss_rate >= 60 ? 'text-red-600' :
                          f.loss_rate >= 35 ? 'text-orange-500' : 'text-amber-500'
                        }`}>
                          {f.loss_rate}%
                        </span>
                      </div>
                      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            f.loss_rate >= 60 ? 'bg-red-400' :
                            f.loss_rate >= 35 ? 'bg-orange-400' : 'bg-amber-400'
                          }`}
                          style={{ width: `${f.loss_rate}%` }}
                        />
                      </div>
                      <p className="text-[10px] text-slate-400 mt-0.5">{f.lost} de {f.total} perdidos</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ── 4. DISCIPLINA DE DADOS ───────────────────────────── */}
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-3">
        Disciplina de dados
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <Card className={noOwnerPct >= 30 ? 'border-red-200' : ''}>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <UserX className={`h-4 w-4 ${noOwnerPct >= 30 ? 'text-red-400' : 'text-slate-400'}`} />
              <span className="text-[11px] text-slate-500 uppercase tracking-wide">Sem dono</span>
            </div>
            <p className={`text-2xl font-bold ${noOwnerPct >= 30 ? 'text-red-600' : 'text-slate-700'}`}>
              {discipline.open_no_owner}
            </p>
            <p className="text-[11px] text-slate-400 mt-0.5">{noOwnerPct}% dos abertos</p>
          </CardContent>
        </Card>

        <Card className={noValuePct >= 50 ? 'border-amber-200' : ''}>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <TrendingDown className={`h-4 w-4 ${noValuePct >= 50 ? 'text-amber-500' : 'text-slate-400'}`} />
              <span className="text-[11px] text-slate-500 uppercase tracking-wide">Sem valor</span>
            </div>
            <p className={`text-2xl font-bold ${noValuePct >= 50 ? 'text-amber-600' : 'text-slate-700'}`}>
              {discipline.no_value}
            </p>
            <p className="text-[11px] text-slate-400 mt-0.5">{noValuePct}% do total</p>
          </CardContent>
        </Card>

        <Card className={discipline.won_no_value > 0 ? 'border-orange-200' : ''}>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Database className={`h-4 w-4 ${discipline.won_no_value > 0 ? 'text-orange-400' : 'text-slate-400'}`} />
              <span className="text-[11px] text-slate-500 uppercase tracking-wide">Ganhos sem $$</span>
            </div>
            <p className={`text-2xl font-bold ${discipline.won_no_value > 0 ? 'text-orange-600' : 'text-slate-700'}`}>
              {discipline.won_no_value}
            </p>
            <p className="text-[11px] text-slate-400 mt-0.5">não contabilizados</p>
          </CardContent>
        </Card>

        <Card className={discipline.total > 0 && noOwnerPct < 15 && noValuePct < 30 ? 'border-emerald-200' : ''}>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle2 className={`h-4 w-4 ${noOwnerPct < 15 && noValuePct < 30 ? 'text-emerald-500' : 'text-slate-400'}`} />
              <span className="text-[11px] text-slate-500 uppercase tracking-wide">Total de leads</span>
            </div>
            <p className="text-2xl font-bold text-slate-700">{discipline.total}</p>
            <p className="text-[11px] text-slate-400 mt-0.5">{discipline.open_total} em aberto</p>
          </CardContent>
        </Card>
      </div>

      {/* Atalhos */}
      <div className="flex gap-3 flex-wrap">
        <button
          onClick={() => navigate('/crm')}
          className="flex items-center gap-1.5 text-xs text-indigo-600 hover:text-indigo-800 border border-indigo-100 bg-indigo-50 rounded-lg px-3 py-2 transition-colors"
        >
          <Target className="h-3.5 w-3.5" /> Abrir CRM <ArrowRight className="h-3 w-3" />
        </button>
        <button
          onClick={() => navigate('/crm/journey')}
          className="flex items-center gap-1.5 text-xs text-slate-600 hover:text-slate-800 border border-slate-200 rounded-lg px-3 py-2 transition-colors"
        >
          Ver Jornada do Lead <ArrowRight className="h-3 w-3" />
        </button>
      </div>
    </PageContainer>
  )
}
