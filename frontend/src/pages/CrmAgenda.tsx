import { useMemo, useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval,
  format, addMonths, subMonths, isSameMonth, isSameDay, parseISO,
} from 'date-fns'
import { ptBR } from 'date-fns/locale'
import {
  CalendarDays, ChevronLeft, ChevronRight, Phone, Video, Mail,
  MessageSquare, StickyNote, CheckCircle2, XCircle, Link2, Unlink, RefreshCw,
} from 'lucide-react'
import { PageContainer } from '@/components/layout/PageContainer'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'
import { crmApi, integrationsApi } from '@/services/api'
import type { AgendaActivity } from '@/types'

function typeIcon(type: string) {
  switch (type) {
    case 'call': return <Phone className="h-3 w-3" />
    case 'meeting': return <Video className="h-3 w-3" />
    case 'email': return <Mail className="h-3 w-3" />
    case 'whatsapp': return <MessageSquare className="h-3 w-3" />
    default: return <StickyNote className="h-3 w-3" />
  }
}

const typeColor: Record<string, string> = {
  call: 'bg-blue-100 text-blue-700 border-blue-200',
  meeting: 'bg-violet-100 text-violet-700 border-violet-200',
  email: 'bg-amber-100 text-amber-700 border-amber-200',
  whatsapp: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  note: 'bg-slate-100 text-slate-600 border-slate-200',
  task: 'bg-indigo-100 text-indigo-700 border-indigo-200',
}

// ── Card de conexão com o Google Agenda ──────────────────────────────────────
function GoogleConnectCard() {
  const qc = useQueryClient()
  const { data: status, isLoading } = useQuery({
    queryKey: ['google-status'],
    queryFn: () => integrationsApi.google.status(),
  })

  const connectMutation = useMutation({
    mutationFn: () => integrationsApi.google.connect(),
    onSuccess: (res) => { if (res.url) window.location.href = res.url },
  })
  const disconnectMutation = useMutation({
    mutationFn: () => integrationsApi.google.disconnect(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['google-status'] }),
  })

  if (isLoading) return null

  if (!status?.configured) {
    return (
      <Card className="border-amber-200 bg-amber-50/50">
        <CardContent className="py-3 flex items-center gap-2 text-sm text-amber-700">
          <XCircle className="h-4 w-4" />
          Integração com Google Agenda não configurada no servidor (defina GOOGLE_CLIENT_ID/SECRET).
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className={status.connected ? 'border-emerald-200 bg-emerald-50/40' : 'border-slate-200'}>
      <CardContent className="py-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-sm">
          {status.connected ? (
            <>
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              <span className="text-slate-700">
                Google Agenda conectado
                {status.email && <span className="text-slate-500"> — {status.email}</span>}
              </span>
            </>
          ) : (
            <>
              <CalendarDays className="h-4 w-4 text-slate-500" />
              <span className="text-slate-600">
                Conecte seu Google Agenda para receber lembretes das atividades agendadas.
              </span>
            </>
          )}
        </div>
        {status.connected ? (
          <Button
            variant="outline" size="sm"
            onClick={() => disconnectMutation.mutate()}
            disabled={disconnectMutation.isPending}
          >
            <Unlink className="h-3.5 w-3.5 mr-1.5" /> Desconectar
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={() => connectMutation.mutate()}
            disabled={connectMutation.isPending}
          >
            <Link2 className="h-3.5 w-3.5 mr-1.5" /> Conectar Google Agenda
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

export default function CrmAgenda() {
  const [cursor, setCursor] = useState(() => new Date())
  const [searchParams, setSearchParams] = useSearchParams()
  const qc = useQueryClient()

  // Banner de retorno do OAuth (?google=connected|error)
  const [banner, setBanner] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null)
  useEffect(() => {
    const g = searchParams.get('google')
    if (g === 'connected') {
      setBanner({ kind: 'ok', msg: 'Google Agenda conectado com sucesso!' })
      qc.invalidateQueries({ queryKey: ['google-status'] })
    } else if (g === 'error') {
      setBanner({ kind: 'err', msg: `Não foi possível conectar (${searchParams.get('reason') || 'erro'}).` })
    }
    if (g) {
      searchParams.delete('google'); searchParams.delete('reason')
      setSearchParams(searchParams, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Intervalo do grid (semanas completas que cobrem o mês)
  const gridStart = startOfWeek(startOfMonth(cursor), { weekStartsOn: 0 })
  const gridEnd = endOfWeek(endOfMonth(cursor), { weekStartsOn: 0 })
  const days = useMemo(() => eachDayOfInterval({ start: gridStart, end: gridEnd }), [gridStart, gridEnd])

  const { data, isLoading } = useQuery({
    queryKey: ['crm-agenda', gridStart.toISOString(), gridEnd.toISOString()],
    queryFn: () => crmApi.agenda({ start: gridStart.toISOString(), end: gridEnd.toISOString() }),
  })

  const byDay = useMemo(() => {
    const map = new Map<string, AgendaActivity[]>()
    for (const a of data?.activities ?? []) {
      if (!a.scheduled_at) continue
      const key = format(parseISO(a.scheduled_at), 'yyyy-MM-dd')
      const arr = map.get(key) ?? []
      arr.push(a)
      map.set(key, arr)
    }
    return map
  }, [data])

  const today = new Date()

  return (
    <PageContainer>
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-5 w-5 text-indigo-500" />
          <h1 className="text-2xl font-bold">Agenda</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setCursor(d => subMonths(d, 1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium capitalize min-w-[140px] text-center">
            {format(cursor, 'MMMM yyyy', { locale: ptBR })}
          </span>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setCursor(d => addMonths(d, 1))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" className="h-8" onClick={() => setCursor(new Date())}>Hoje</Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => qc.invalidateQueries({ queryKey: ['crm-agenda'] })} title="Atualizar">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {banner && (
        <div className={`text-sm rounded-md px-3 py-2 ${banner.kind === 'ok' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          {banner.msg}
        </div>
      )}

      <GoogleConnectCard />

      <Card>
        <CardContent className="p-0">
          {/* Cabeçalho dos dias da semana */}
          <div className="grid grid-cols-7 border-b bg-slate-50 text-center">
            {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map(d => (
              <div key={d} className="py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{d}</div>
            ))}
          </div>

          {isLoading ? (
            <div className="py-16"><LoadingSpinner /></div>
          ) : (
            <div className="grid grid-cols-7">
              {days.map((day) => {
                const key = format(day, 'yyyy-MM-dd')
                const items = byDay.get(key) ?? []
                const inMonth = isSameMonth(day, cursor)
                const isToday = isSameDay(day, today)
                return (
                  <div
                    key={key}
                    className={`min-h-[104px] border-b border-r p-1.5 flex flex-col gap-1 ${inMonth ? 'bg-white' : 'bg-slate-50/60'}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className={`text-xs font-medium ${isToday ? 'bg-indigo-600 text-white rounded-full h-5 w-5 flex items-center justify-center' : inMonth ? 'text-slate-600' : 'text-slate-300'}`}>
                        {format(day, 'd')}
                      </span>
                      {items.length > 0 && (
                        <span className="text-[10px] text-slate-400">{items.length}</span>
                      )}
                    </div>
                    <div className="flex flex-col gap-1 overflow-hidden">
                      {items.slice(0, 4).map((a) => (
                        <div
                          key={a.id}
                          title={`${format(parseISO(a.scheduled_at), 'HH:mm')} · ${a.deal_title || a.contact_name || 'Lead'}${a.description ? ' — ' + a.description : ''}${a.owner_name ? ' · ' + a.owner_name : ''}`}
                          className={`text-[10px] leading-tight rounded border px-1 py-0.5 flex items-center gap-1 truncate ${typeColor[a.type] || typeColor.note}`}
                        >
                          {typeIcon(a.type)}
                          <span className="font-medium">{format(parseISO(a.scheduled_at), 'HH:mm')}</span>
                          <span className="truncate">{a.contact_name || a.deal_title || 'Lead'}</span>
                          {a.google_event_id && <CalendarDays className="h-2.5 w-2.5 ml-auto opacity-60 shrink-0" />}
                        </div>
                      ))}
                      {items.length > 4 && (
                        <span className="text-[10px] text-slate-400">+{items.length - 4} mais</span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-slate-400 flex items-center gap-1">
        <CalendarDays className="h-3 w-3" />
        O ícone indica atividades já sincronizadas com o Google Agenda do responsável.
      </p>
    </PageContainer>
  )
}
