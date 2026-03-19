import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { capacityApi } from '@/services/api'
import { Button } from '@/components/ui/button'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { BlockModal } from './BlockModal'
import type { TimelineConsultant } from '@/types'

function getMonday(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  return d
}

function addWeeks(date: Date, weeks: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + weeks * 7)
  return d
}

function toDateStr(d: Date): string {
  return d.toISOString().split('T')[0]
}

function formatWeekLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00')
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
}

function formatMonthLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00')
  const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
  return `${months[d.getMonth()]} ${d.getFullYear()}`
}

const WEEKS_VISIBLE = 12

export function CapacityTimeline() {
  const [startMonday, setStartMonday] = useState(() => getMonday(new Date()))
  const [blockModalOpen, setBlockModalOpen] = useState(false)

  const startDate = toDateStr(startMonday)
  const endDate = toDateStr(addWeeks(startMonday, WEEKS_VISIBLE))

  const { data, isLoading } = useQuery({
    queryKey: ['capacity-timeline', startDate, endDate],
    queryFn: () => capacityApi.timeline(startDate, endDate),
  })

  // Gerar labels das semanas
  const weekLabels: string[] = []
  for (let i = 0; i < WEEKS_VISIBLE; i++) {
    weekLabels.push(toDateStr(addWeeks(startMonday, i)))
  }

  // Agrupar semanas por mes para header
  const monthGroups: { label: string; span: number }[] = []
  let currentMonth = ''
  for (const wk of weekLabels) {
    const ml = formatMonthLabel(wk)
    if (ml === currentMonth) {
      monthGroups[monthGroups.length - 1].span++
    } else {
      monthGroups.push({ label: ml, span: 1 })
      currentMonth = ml
    }
  }

  function getUtilColor(pct: number): string {
    if (pct > 100) return 'bg-red-500'
    if (pct > 80) return 'bg-amber-500'
    if (pct > 50) return 'bg-blue-500'
    return 'bg-green-500'
  }

  function getBarStyle(segment: { start_date: string | null; end_date: string | null; color: string }, weeks: string[]): { left: string; width: string; color: string } | null {
    const segStart = segment.start_date || '1900-01-01'
    const segEnd = segment.end_date || '2100-12-31'

    let startIdx = -1
    let endIdx = -1

    for (let i = 0; i < weeks.length; i++) {
      const weekEnd = toDateStr(addWeeks(new Date(weeks[i] + 'T12:00:00'), 1))
      if (startIdx === -1 && weekEnd > segStart) startIdx = i
      if (weeks[i] <= segEnd) endIdx = i
    }

    if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) return null

    const left = `${(startIdx / weeks.length) * 100}%`
    const width = `${((endIdx - startIdx + 1) / weeks.length) * 100}%`

    return { left, width, color: segment.color }
  }

  return (
    <div className="space-y-4">
      {/* Header controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => setStartMonday(addWeeks(startMonday, -4))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium">
            {formatWeekLabel(weekLabels[0])} — {formatWeekLabel(weekLabels[weekLabels.length - 1])}
          </span>
          <Button variant="outline" size="icon" onClick={() => setStartMonday(addWeeks(startMonday, 4))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setStartMonday(getMonday(new Date()))}>
            Hoje
          </Button>
        </div>
        <Button size="sm" onClick={() => setBlockModalOpen(true)}>
          <Plus className="h-4 w-4 mr-1" /> Bloqueio
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
        </div>
      ) : (
        <div className="border rounded-lg overflow-x-auto">
          <table className="w-full text-sm" style={{ minWidth: '900px' }}>
            <thead>
              {/* Linha de meses */}
              <tr className="bg-muted/50">
                <th className="text-left p-2 font-medium border-r w-48 sticky left-0 bg-muted/50 z-10">Consultor</th>
                {monthGroups.map((mg, i) => (
                  <th key={i} colSpan={mg.span} className="text-center p-1 text-xs font-medium border-r">
                    {mg.label}
                  </th>
                ))}
                <th className="w-16 text-center p-1 text-xs font-medium">%</th>
              </tr>
              {/* Linha de semanas */}
              <tr className="bg-muted/30 border-b">
                <th className="border-r sticky left-0 bg-muted/30 z-10"></th>
                {weekLabels.map((wk) => (
                  <th key={wk} className="text-center p-1 text-xs text-muted-foreground border-r font-normal">
                    {formatWeekLabel(wk)}
                  </th>
                ))}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data?.consultants?.map((consultant: TimelineConsultant) => (
                <ConsultantRow
                  key={consultant.id}
                  consultant={consultant}
                  weekLabels={weekLabels}
                  getBarStyle={getBarStyle}
                  getUtilColor={getUtilColor}
                />
              ))}
              {(!data?.consultants || data.consultants.length === 0) && (
                <tr>
                  <td colSpan={WEEKS_VISIBLE + 2} className="text-center py-8 text-muted-foreground">
                    Nenhum consultor encontrado
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Legenda */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded bg-blue-500 inline-block" /> Projeto
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded bg-gray-400 inline-block" style={{ background: 'repeating-linear-gradient(45deg, #9ca3af, #9ca3af 2px, #d1d5db 2px, #d1d5db 4px)' }} /> Bloqueado
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded bg-green-500 inline-block" /> {'<50%'}
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded bg-blue-500 inline-block" /> 50-80%
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded bg-amber-500 inline-block" /> 80-100%
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded bg-red-500 inline-block" /> {'>100%'}
        </span>
      </div>

      <BlockModal open={blockModalOpen} onOpenChange={setBlockModalOpen} onSuccess={() => {}} />
    </div>
  )
}

function ConsultantRow({
  consultant,
  weekLabels,
  getBarStyle,
  getUtilColor,
}: {
  consultant: TimelineConsultant
  weekLabels: string[]
  getBarStyle: (seg: { start_date: string | null; end_date: string | null; color: string }, weeks: string[]) => { left: string; width: string; color: string } | null
  getUtilColor: (pct: number) => string
}) {
  // Mapear semanas do consultant.weeks por week_start
  const weekMap: Record<string, { capacity: number; allocated: number }> = {}
  for (const w of consultant.weeks) {
    weekMap[w.week_start] = w
  }

  return (
    <tr className="border-b hover:bg-muted/20">
      <td className="p-2 border-r sticky left-0 bg-card z-10">
        <div className="font-medium text-sm truncate">{consultant.name}</div>
        <div className="text-xs text-muted-foreground">{consultant.weekly_capacity}h/sem</div>
      </td>
      {weekLabels.map((wk) => {
        const week = weekMap[wk]
        const utilPct = week && week.capacity > 0 ? Math.round((week.allocated / week.capacity) * 100) : 0

        // Verificar se ha bloqueio nesta semana
        const hasBlock = consultant.block_segments.some((b) => {
          const bStart = b.start_date.substring(0, 10)
          const bEnd = b.end_date.substring(0, 10)
          const weekEnd = toDateStr(addWeeks(new Date(wk + 'T12:00:00'), 1))
          return bStart < weekEnd && bEnd >= wk
        })

        return (
          <td key={wk} className="p-0 border-r relative" style={{ height: '40px' }}>
            {hasBlock ? (
              <div
                className="absolute inset-0 opacity-60"
                style={{ background: 'repeating-linear-gradient(45deg, #9ca3af, #9ca3af 2px, #e5e7eb 2px, #e5e7eb 4px)' }}
                title="Bloqueado"
              />
            ) : week ? (
              <div className="absolute inset-x-0 bottom-0" style={{ height: `${Math.min(utilPct, 100)}%` }}>
                <div className={`w-full h-full ${getUtilColor(utilPct)} opacity-30`} />
              </div>
            ) : null}
            {week && !hasBlock && (
              <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
                {utilPct > 0 ? `${utilPct}%` : ''}
              </div>
            )}
          </td>
        )
      })}
      <td className="text-center p-1">
        <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${
          consultant.utilization_pct > 100
            ? 'bg-red-100 text-red-700'
            : consultant.utilization_pct > 80
              ? 'bg-amber-100 text-amber-700'
              : 'bg-green-100 text-green-700'
        }`}>
          {consultant.utilization_pct}%
        </span>
      </td>
    </tr>
  )
}
