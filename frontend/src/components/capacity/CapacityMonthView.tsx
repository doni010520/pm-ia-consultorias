import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { capacityApi, usersApi } from '@/services/api'
import { Button } from '@/components/ui/button'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { BlockModal } from './BlockModal'
import type { DayCapacity } from '@/types'

const DAY_NAMES = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab', 'Dom']

function toMonthStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function formatMonthTitle(month: string): string {
  const [year, mon] = month.split('-').map(Number)
  const months = ['Janeiro', 'Fevereiro', 'Marco', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
  return `${months[mon - 1]} ${year}`
}

export function CapacityMonthView() {
  const [selectedUser, setSelectedUser] = useState('')
  const [currentMonth, setCurrentMonth] = useState(() => toMonthStr(new Date()))
  const [users, setUsers] = useState<{ id: string; name: string }[]>([])
  const [blockModalOpen, setBlockModalOpen] = useState(false)

  useEffect(() => {
    usersApi.list().then((data) => {
      setUsers(data.users)
      if (data.users.length > 0 && !selectedUser) {
        setSelectedUser(data.users[0].id)
      }
    })
  }, [])

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['capacity-consultant', selectedUser, currentMonth],
    queryFn: () => capacityApi.consultant(selectedUser, currentMonth),
    enabled: !!selectedUser,
  })

  // Navegacao de mes
  function prevMonth() {
    const [y, m] = currentMonth.split('-').map(Number)
    const d = new Date(y, m - 2, 1)
    setCurrentMonth(toMonthStr(d))
  }
  function nextMonth() {
    const [y, m] = currentMonth.split('-').map(Number)
    const d = new Date(y, m, 1)
    setCurrentMonth(toMonthStr(d))
  }

  // Montar grid do calendario
  const [year, month] = currentMonth.split('-').map(Number)
  const firstDay = new Date(year, month - 1, 1)
  const lastDay = new Date(year, month, 0)
  const daysInMonth = lastDay.getDate()

  // Dia da semana do primeiro dia (0=Dom, ajustar para Seg=0)
  let startDayOfWeek = firstDay.getDay() - 1
  if (startDayOfWeek < 0) startDayOfWeek = 6

  // Indexar dias por data
  const dayMap: Record<string, DayCapacity> = {}
  if (data?.days) {
    for (const day of data.days) {
      dayMap[day.date] = day
    }
  }

  // Gerar celulas do grid (incluindo vazias no inicio)
  const cells: (DayCapacity | null)[] = []
  for (let i = 0; i < startDayOfWeek; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    cells.push(dayMap[dateStr] || { date: dateStr, is_weekend: false, is_blocked: false, block_reason: null, daily_capacity: 0, allocations: [], tasks: [], total_allocated: 0, available: 0 })
  }

  // Resumo do mes
  const workingDays = data?.days?.filter((d) => !d.is_weekend && !d.is_blocked) || []
  const totalCapacity = workingDays.reduce((s, d) => s + d.daily_capacity, 0)
  const totalAllocated = workingDays.reduce((s, d) => s + d.total_allocated, 0)
  const totalAvailable = workingDays.reduce((s, d) => s + d.available, 0)
  const utilPct = totalCapacity > 0 ? Math.round((totalAllocated / totalCapacity) * 100) : 0

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <select
            value={selectedUser}
            onChange={(e) => setSelectedUser(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>

          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={prevMonth}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm font-medium w-40 text-center">{formatMonthTitle(currentMonth)}</span>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={nextMonth}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Resumo do mes */}
          <div className="flex items-center gap-4 text-xs">
            <span>Capacidade: <strong>{Math.round(totalCapacity)}h</strong></span>
            <span>Alocado: <strong>{Math.round(totalAllocated)}h</strong></span>
            <span className={utilPct > 100 ? 'text-red-600' : utilPct > 80 ? 'text-amber-600' : 'text-green-600'}>
              Livre: <strong>{Math.round(totalAvailable)}h</strong> ({utilPct}% utilizado)
            </span>
          </div>
          <Button size="sm" variant="outline" onClick={() => setBlockModalOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> Bloqueio
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          {/* Header dias da semana */}
          <div className="grid grid-cols-7 bg-muted/50">
            {DAY_NAMES.map((name) => (
              <div key={name} className="text-center text-xs font-medium py-2 border-b">
                {name}
              </div>
            ))}
          </div>

          {/* Grid de dias */}
          <div className="grid grid-cols-7">
            {cells.map((day, idx) => (
              <DayCell key={idx} day={day} />
            ))}
          </div>
        </div>
      )}

      <BlockModal
        open={blockModalOpen}
        onOpenChange={setBlockModalOpen}
        onSuccess={() => refetch()}
        preselectedUserId={selectedUser}
      />
    </div>
  )
}

function DayCell({ day }: { day: DayCapacity | null }) {
  if (!day) {
    return <div className="min-h-[90px] border-b border-r bg-muted/10" />
  }

  const dayNum = parseInt(day.date.split('-')[2])
  const isToday = day.date === new Date().toISOString().split('T')[0]

  if (day.is_weekend) {
    return (
      <div className="min-h-[90px] border-b border-r bg-muted/20 p-1">
        <span className="text-xs text-muted-foreground">{dayNum}</span>
      </div>
    )
  }

  if (day.is_blocked) {
    return (
      <div className="min-h-[90px] border-b border-r p-1" style={{ background: 'repeating-linear-gradient(45deg, #f3f4f6, #f3f4f6 3px, #e5e7eb 3px, #e5e7eb 6px)' }}>
        <span className="text-xs font-medium">{dayNum}</span>
        <div className="mt-1 text-xs text-muted-foreground truncate">
          {day.block_reason || 'Bloqueado'}
        </div>
      </div>
    )
  }

  const utilPct = day.daily_capacity > 0 ? Math.round((day.total_allocated / day.daily_capacity) * 100) : 0

  return (
    <div className={`min-h-[90px] border-b border-r p-1 ${isToday ? 'ring-2 ring-primary ring-inset' : ''}`}>
      <div className="flex items-center justify-between">
        <span className={`text-xs font-medium ${isToday ? 'bg-primary text-white rounded-full w-5 h-5 flex items-center justify-center' : ''}`}>
          {dayNum}
        </span>
        <span className={`text-[10px] font-medium ${
          utilPct > 100 ? 'text-red-600' : utilPct > 80 ? 'text-amber-600' : 'text-green-600'
        }`}>
          {Math.round(day.available)}h livre
        </span>
      </div>

      {/* Alocacoes */}
      <div className="mt-1 space-y-0.5">
        {day.allocations.map((a, i) => (
          <div
            key={i}
            className="text-[10px] px-1 py-0.5 rounded truncate text-white"
            style={{ backgroundColor: a.color || '#3b82f6' }}
            title={`${a.project_name}: ${a.daily_hours}h`}
          >
            {a.project_name} {Math.round(a.daily_hours)}h
          </div>
        ))}
        {day.tasks.map((t, i) => (
          <div
            key={`t-${i}`}
            className="text-[10px] px-1 py-0.5 rounded truncate bg-purple-100 text-purple-700"
            title={`${t.title}${t.estimated_hours ? `: ${t.estimated_hours}h` : ''}`}
          >
            {t.title}{t.estimated_hours ? ` ${Math.round(t.estimated_hours)}h` : ''}
          </div>
        ))}
      </div>

      {/* Barra de utilizacao */}
      <div className="mt-auto pt-1">
        <div className="h-1 bg-muted rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full ${
              utilPct > 100 ? 'bg-red-500' : utilPct > 80 ? 'bg-amber-500' : 'bg-green-500'
            }`}
            style={{ width: `${Math.min(utilPct, 100)}%` }}
          />
        </div>
      </div>
    </div>
  )
}
