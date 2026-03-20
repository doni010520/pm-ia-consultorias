import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { capacityApi } from '@/services/api'
import { Card, CardContent } from '@/components/ui/card'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { AlertTriangle, Clock, Users, TrendingUp } from 'lucide-react'
import type { ConsultantUtilization } from '@/types'

const MONTH_NAMES: Record<string, string> = {
  '01': 'Jan', '02': 'Fev', '03': 'Mar', '04': 'Abr', '05': 'Mai', '06': 'Jun',
  '07': 'Jul', '08': 'Ago', '09': 'Set', '10': 'Out', '11': 'Nov', '12': 'Dez',
}

function formatMonth(m: string): string {
  const [, mon] = m.split('-')
  return MONTH_NAMES[mon] || mon
}

export function CapacityCharts() {
  const [selectedConsultant, setSelectedConsultant] = useState('all')
  const { data, isLoading } = useQuery({
    queryKey: ['capacity-summary'],
    queryFn: () => capacityApi.summary(4),
  })

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    )
  }

  if (!data) return null

  // Filtrar por consultor selecionado
  const filteredConsultants = selectedConsultant === 'all'
    ? data.consultants_utilization
    : data.consultants_utilization.filter((c: ConsultantUtilization) => c.id === selectedConsultant)

  const filteredAlerts = selectedConsultant === 'all'
    ? data.overallocation_alerts
    : data.overallocation_alerts.filter((a: { user_id: string }) => a.user_id === selectedConsultant)

  // Agrupar por mes para grafico empilhado
  const monthlyData: Record<string, Record<string, number>> = {}
  for (const c of filteredConsultants) {
    for (const m of c.months) {
      const key = formatMonth(m.month)
      if (!monthlyData[key]) monthlyData[key] = { month: key as unknown as number }
      monthlyData[key][c.name.split(' ')[0]] = m.utilization_pct
    }
  }
  const barChartData = Object.values(monthlyData)
  const consultantNames = filteredConsultants.map((c: ConsultantUtilization) => c.name.split(' ')[0])
  const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16']

  // Cards de resumo
  const currentWeek = data.team_free_hours_weekly[0]
  const nextWeek = data.team_free_hours_weekly[1]
  const totalAlerts = filteredAlerts.length

  return (
    <div className="space-y-6">
      {/* Filtro de consultor */}
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium">Consultor:</label>
        <select
          value={selectedConsultant}
          onChange={(e) => setSelectedConsultant(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="all">Todos</option>
          {data.consultants_utilization.map((c: ConsultantUtilization) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      {/* Cards de resumo */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-100">
                <Users className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Consultores</p>
                <p className="text-xl font-bold">{data.consultants_utilization.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-100">
                <Clock className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Horas livres esta semana</p>
                <p className="text-xl font-bold">{currentWeek ? `${currentWeek.free.toFixed(0)}h` : '-'}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-100">
                <TrendingUp className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Horas livres proxima semana</p>
                <p className="text-xl font-bold">{nextWeek ? `${nextWeek.free.toFixed(0)}h` : '-'}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${totalAlerts > 0 ? 'bg-red-100' : 'bg-green-100'}`}>
                <AlertTriangle className={`h-5 w-5 ${totalAlerts > 0 ? 'text-red-600' : 'text-green-600'}`} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Superalocacoes</p>
                <p className="text-xl font-bold">{totalAlerts}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Grafico de utilizacao por consultor */}
      <Card>
        <CardContent className="p-4">
          <h3 className="text-sm font-medium mb-4">Utilizacao por Consultor (%)</h3>
          <div style={{ height: 350 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={barChartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} domain={[0, 'auto']} />
                <Tooltip
                  formatter={(value: unknown, name: unknown) => [`${value}%`, String(name)]}
                  labelFormatter={(label) => `Mes: ${label}`}
                />
                <Legend />
                {consultantNames.map((name: string, idx: number) => (
                  <Bar key={name} dataKey={name} fill={colors[idx % colors.length]} />
                ))}
                {/* Linha de referencia 100% */}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Horas livres por semana da equipe */}
      <Card>
        <CardContent className="p-4">
          <h3 className="text-sm font-medium mb-4">Horas Livres da Equipe por Semana</h3>
          <div style={{ height: 250 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.team_free_hours_weekly.slice(0, 12)}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="week_start"
                  tick={{ fontSize: 10 }}
                  tickFormatter={(v) => {
                    const d = new Date(v + 'T12:00:00')
                    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
                  }}
                />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip
                  labelFormatter={(v) => {
                    const d = new Date(v + 'T12:00:00')
                    return `Semana de ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
                  }}
                  formatter={(value: unknown, name: unknown) => {
                    const labels: Record<string, string> = { free: 'Livre', total_allocated: 'Alocado', total_capacity: 'Capacidade' }
                    return [`${Number(value).toFixed(0)}h`, labels[String(name)] || String(name)]
                  }}
                />
                <Legend formatter={(v) => {
                  const labels: Record<string, string> = { free: 'Livre', total_allocated: 'Alocado' }
                  return labels[v] || v
                }} />
                <Bar dataKey="total_allocated" fill="#3b82f6" stackId="a" />
                <Bar dataKey="free" fill="#22c55e" stackId="a" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Alertas de superalocacao */}
      {filteredAlerts.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <h3 className="text-sm font-medium mb-3 text-red-600 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" /> Alertas de Superalocacao
            </h3>
            <div className="space-y-2">
              {filteredAlerts.map((alert, idx) => (
                <div key={idx} className="flex items-center justify-between p-3 rounded-lg bg-red-50 border border-red-100">
                  <div>
                    <span className="font-medium text-sm">{alert.user_name}</span>
                    <span className="text-xs text-muted-foreground ml-2">
                      {formatMonth(alert.month.split('-')[1])}/{alert.month.split('-')[0]}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-red-600 font-bold text-sm">{alert.utilization_pct}%</span>
                    <span className="text-xs text-muted-foreground ml-2">
                      ({alert.allocated.toFixed(0)}h / {alert.capacity.toFixed(0)}h)
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
