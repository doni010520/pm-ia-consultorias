import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import {
  Target, DollarSign, Percent, TrendingDown, Filter, BadgeCheck, LineChart, ShieldCheck, Layers,
  ArrowUp, ArrowDown, RefreshCw, Settings2, Flag, CheckCircle2, AlertTriangle, XCircle, MinusCircle, Info,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { PageContainer } from '@/components/layout/PageContainer'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'
import { useAuthStore } from '@/stores/authStore'
import { comercialApi, type FontePainel, type PainelComercialData, type PainelFiltros } from '@/services/api'
import { cn } from '@/lib/utils'

// ─── formatação ──────────────────────────────────────────────────────────────

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
const dinheiro = (v: number | null | undefined) => (v === null || v === undefined ? '—' : brl.format(v))
function compacto(v: number | null | undefined) {
  if (v === null || v === undefined) return '—'
  const a = Math.abs(v)
  if (a >= 1_000_000) return `R$ ${(v / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} mi`
  if (a >= 1_000) return `R$ ${(v / 1_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`
  return brl.format(v)
}
const pct = (v: number | null | undefined, casas = 1) =>
  v === null || v === undefined ? '—' : `${(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: casas })}%`
const vezes = (v: number | null | undefined) =>
  v === null || v === undefined ? '—' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}x`

const NOME_MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
function ultimosMeses(n: number) {
  const hoje = new Date()
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1)
    const v = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    return { valor: v, rotulo: `${NOME_MES[d.getMonth()]}/${d.getFullYear()}` }
  })
}
function haQuanto(iso: string | null) {
  if (!iso) return 'nunca'
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min} min`
  const h = Math.round(min / 60)
  return h < 24 ? `há ${h} h` : `há ${Math.round(h / 24)} dias`
}

// Uma matiz (azul) para magnitude; etapas do funil em rampa ordinal clara → escura.
const AZUL = '#2a78d6'
const AZUL_CLARO = '#86b6ef'
const NEUTRO = '#94a3b8'
const RAMPA_FUNIL = ['#86b6ef', '#6da7ec', '#5598e7', '#3987e5', '#2a78d6', '#1c5cab']
const EIXO = { fontSize: 11, fill: '#64748b' }

// ─── peças ───────────────────────────────────────────────────────────────────

function Variacao({ atual, anterior, modo = 'pct' }: { atual: number | null; anterior: number | null; modo?: 'pct' | 'pp' }) {
  if (atual === null || anterior === null || (modo === 'pct' && !anterior)) {
    return <span className="text-xs text-muted-foreground">sem comparação</span>
  }
  const delta = modo === 'pct' ? (atual - anterior) / anterior : (atual - anterior) * 100
  const sobe = delta >= 0
  const Icone = sobe ? ArrowUp : ArrowDown
  return (
    <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
      vs mês anterior
      <span className={cn('inline-flex items-center font-medium', sobe ? 'text-emerald-700' : 'text-red-700')}>
        <Icone className="h-3 w-3" />
        {modo === 'pct' ? pct(Math.abs(delta)) : `${Math.abs(delta).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} p.p.`}
      </span>
    </span>
  )
}

function Kpi({ icone: Icone, titulo, valor, rodape, dica }: {
  icone: typeof Target; titulo: string; valor: string; rodape?: React.ReactNode; dica?: string
}) {
  return (
    <Card title={dica}>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-600">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-50 text-blue-700">
            <Icone className="h-4 w-4" />
          </span>
          {titulo}
        </div>
        <div className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">{valor}</div>
        <div className="mt-1 min-h-4">{rodape}</div>
      </CardContent>
    </Card>
  )
}

function Bloco({ titulo, nota, children, className }: { titulo: string; nota?: string; children: React.ReactNode; className?: string }) {
  return (
    <Card className={className}>
      <CardContent className="p-4">
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-800">{titulo}</h3>
          {nota && <span className="text-xs text-muted-foreground">{nota}</span>}
        </div>
        {children}
      </CardContent>
    </Card>
  )
}

function DicaGrafico({ active, payload, label, formato = compacto }: {
  active?: boolean; payload?: { value: number; payload: Record<string, unknown> }[]; label?: string; formato?: (v: number) => string
}) {
  if (!active || !payload?.length) return null
  const p = payload[0]
  const negocios = p.payload.negocios as number | undefined
  return (
    <div className="rounded-md border bg-white px-3 py-2 text-xs shadow-md">
      <div className="font-medium text-slate-800">{label ?? (p.payload.nome as string)}</div>
      <div className="text-slate-600">{formato(p.value)}</div>
      {negocios !== undefined && <div className="text-slate-500">{negocios} negócios</div>}
    </div>
  )
}

function Seletor({ rotulo, valor, onChange, opcoes, todos = 'Todos' }: {
  rotulo: string; valor: string; onChange: (v: string) => void; opcoes: { valor: string; rotulo: string }[]; todos?: string | null
}) {
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs font-medium text-slate-600">
      {rotulo}
      <select
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-full rounded-md border border-input bg-white px-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        {todos !== null && <option value="">{todos}</option>}
        {opcoes.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
      </select>
    </label>
  )
}

const NIVEL = {
  verde: { icone: CheckCircle2, cor: 'text-emerald-700', rotulo: 'Verde' },
  amarelo: { icone: AlertTriangle, cor: 'text-amber-700', rotulo: 'Amarelo' },
  vermelho: { icone: XCircle, cor: 'text-red-700', rotulo: 'Vermelho' },
  sem_dado: { icone: MinusCircle, cor: 'text-slate-500', rotulo: 'Sem dado' },
} as const

// ─── janelas: metas e RD ─────────────────────────────────────────────────────

type MetaSalva = { executivo: string | null; valor: number }

function JanelaMetas({ aberta, onClose, mes, executivos }: { aberta: boolean; onClose: () => void; mes: string; executivos: string[] }) {
  const { data } = useQuery({ queryKey: ['comercial-metas', mes], queryFn: () => comercialApi.metas(mes), enabled: aberta })
  const rotuloMes = ultimosMeses(24).find((m) => m.valor === mes)?.rotulo ?? mes
  return (
    <Dialog open={aberta} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Metas de {rotuloMes}</DialogTitle>
          <DialogDescription>
            A meta total vale para o painel sem filtro. Sem meta total, o painel usa a soma das metas dos executivos.
          </DialogDescription>
        </DialogHeader>
        {data
          ? <FormMetas key={mes} mes={mes} salvas={data.metas} executivos={executivos} onClose={onClose} />
          : <div className="flex justify-center py-8"><LoadingSpinner /></div>}
      </DialogContent>
    </Dialog>
  )
}

function FormMetas({ mes, salvas, executivos, onClose }: { mes: string; salvas: MetaSalva[]; executivos: string[]; onClose: () => void }) {
  const qc = useQueryClient()
  const [total, setTotal] = useState(String(salvas.find((m) => !m.executivo)?.valor ?? ''))
  const [porExec, setPorExec] = useState<Record<string, string>>(
    () => Object.fromEntries(salvas.filter((m) => m.executivo).map((m) => [m.executivo as string, String(m.valor)])),
  )

  const nomes = useMemo(() => [...new Set([...executivos, ...Object.keys(porExec)])].sort(), [executivos, porExec])
  const somaExec = Object.values(porExec).reduce((t, v) => t + (Number(v) || 0), 0)
  const salvar = useMutation({
    mutationFn: () => comercialApi.salvarMetas(mes, [
      { executivo: null, valor: Number(total) || 0 },
      ...Object.entries(porExec).map(([executivo, v]) => ({ executivo, valor: Number(v) || 0 })),
    ]),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['painel-comercial'] })
      qc.invalidateQueries({ queryKey: ['comercial-metas', mes] })
      onClose()
    },
  })

  return (
    <>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Meta total da empresa (R$)
          <Input type="number" min={0} value={total} onChange={(e) => setTotal(e.target.value)} placeholder="Ex.: 300000" />
        </label>
        <div className="mt-2 space-y-2">
          <div className="flex items-baseline justify-between text-sm font-medium">
            <span>Por executivo (R$)</span>
            <span className="text-xs text-muted-foreground">soma: {dinheiro(somaExec)}</span>
          </div>
          {nomes.map((n) => (
            <div key={n} className="flex items-center gap-2">
              <span className="w-48 truncate text-sm text-slate-700" title={n}>{n}</span>
              <Input
                type="number" min={0} value={porExec[n] ?? ''} placeholder="sem meta"
                onChange={(e) => setPorExec((p) => ({ ...p, [n]: e.target.value }))}
              />
            </div>
          ))}
        </div>
        {salvar.error && <p className="text-sm text-red-700">{(salvar.error as Error).message}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => salvar.mutate()} disabled={salvar.isPending}>{salvar.isPending ? 'Salvando…' : 'Salvar metas'}</Button>
        </div>
    </>
  )
}

function JanelaRd({ aberta, onClose, admin }: { aberta: boolean; onClose: () => void; admin: boolean }) {
  const qc = useQueryClient()
  const { data: status } = useQuery({ queryKey: ['comercial-rd'], queryFn: comercialApi.rd.status, enabled: aberta })
  const [token, setToken] = useState('')
  const conectar = useMutation({
    mutationFn: () => comercialApi.rd.conectar(token.trim()),
    onSuccess: () => { setToken(''); qc.invalidateQueries({ queryKey: ['comercial-rd'] }); qc.invalidateQueries({ queryKey: ['painel-comercial'] }) },
  })
  const sync = useMutation({
    mutationFn: comercialApi.rd.sincronizar,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['comercial-rd'] }); qc.invalidateQueries({ queryKey: ['painel-comercial'] }) },
  })

  return (
    <Dialog open={aberta} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Conexão com o RD Station CRM</DialogTitle>
          <DialogDescription>
            O painel copia as negociações do RD a cada 30 minutos. O token precisa ser de um usuário com visibilidade
            Geral em Negociações, senão só aparecem os negócios dele.
          </DialogDescription>
        </DialogHeader>
        {status?.conectado ? (
          <div className="rounded-md border bg-slate-50 p-3 text-sm">
            <div><span className="text-muted-foreground">Token de:</span> {status.dono_token}</div>
            <div>
              <span className="text-muted-foreground">Última sincronização:</span> {haQuanto(status.last_sync_at)}
              {status.last_sync_status === 'ok' && ` · ${status.deals_sincronizados} negociações`}
            </div>
            {status.last_sync_status === 'erro' && <div className="mt-1 text-red-700">Erro: {status.last_sync_error}</div>}
            <Button size="sm" variant="outline" className="mt-2" onClick={() => sync.mutate()} disabled={sync.isPending}>
              <RefreshCw className={cn('mr-1 h-3.5 w-3.5', sync.isPending && 'animate-spin')} />
              {sync.isPending ? 'Sincronizando…' : 'Sincronizar agora'}
            </Button>
            {sync.error && <p className="mt-1 text-red-700">{(sync.error as Error).message}</p>}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Ainda não conectado.</p>
        )}
        {admin ? (
          <div className="space-y-2">
            <label className="flex flex-col gap-1 text-sm font-medium">
              {status?.conectado ? 'Trocar token' : 'Token da instância'}
              <Input value={token} onChange={(e) => setToken(e.target.value)} placeholder="No RD: seu nome → Perfil → Token da instância" />
            </label>
            {conectar.error && <p className="text-sm text-red-700">{(conectar.error as Error).message}</p>}
            {conectar.data?.aviso && <p className="text-sm text-amber-700">{conectar.data.aviso}</p>}
            {conectar.data && !conectar.data.aviso && (
              <p className="text-sm text-emerald-700">Conectado: {conectar.data.deals} negociações sincronizadas.</p>
            )}
            <div className="flex justify-end">
              <Button onClick={() => conectar.mutate()} disabled={!token.trim() || conectar.isPending}>
                {conectar.isPending ? 'Conectando e sincronizando…' : 'Conectar'}
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Só um administrador pode trocar o token.</p>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ─── página ──────────────────────────────────────────────────────────────────

const FONTES: { valor: FontePainel; rotulo: string }[] = [
  { valor: 'rd', rotulo: 'RD Station' },
  { valor: 'crm', rotulo: 'Nosso CRM' },
  { valor: 'consolidado', rotulo: 'Consolidado' },
]

export default function PainelComercial() {
  const user = useAuthStore((s) => s.user)
  const podeVer = user?.role === 'admin' || user?.role === 'manager'
  const meses = useMemo(() => ultimosMeses(18), [])
  const [fonte, setFonte] = useState<FontePainel>('rd')
  const [filtros, setFiltros] = useState<PainelFiltros>({ mes: meses[0].valor })
  const [janela, setJanela] = useState<'metas' | 'rd' | null>(null)
  const setF = (k: keyof PainelFiltros) => (v: string) => setFiltros((f) => ({ ...f, [k]: v || undefined }))

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['painel-comercial', fonte, filtros],
    queryFn: () => comercialApi.painel(fonte, filtros),
    enabled: podeVer,
    placeholderData: (anterior) => anterior,
    refetchInterval: 5 * 60 * 1000,
  })

  if (!podeVer) {
    return <PageContainer><p className="py-24 text-center text-muted-foreground">O Painel Comercial é visível para gestores e administradores.</p></PageContainer>
  }

  return (
    <PageContainer>
      <div className="space-y-4">
        {/* Cabeçalho */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Painel Comercial</h1>
            <p className="text-sm text-muted-foreground">Meta, pipeline, forecast, performance e canais de aquisição</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-md border bg-white p-0.5" role="tablist" aria-label="Fonte dos dados">
              {FONTES.map((f) => (
                <button
                  key={f.valor}
                  role="tab"
                  aria-selected={fonte === f.valor}
                  onClick={() => setFonte(f.valor)}
                  className={cn('rounded px-3 py-1.5 text-sm font-medium transition-colors',
                    fonte === f.valor ? 'bg-blue-700 text-white' : 'text-slate-600 hover:bg-slate-100')}
                >
                  {f.rotulo}
                </button>
              ))}
            </div>
            <Button variant="outline" size="sm" onClick={() => setJanela('metas')}><Flag className="mr-1 h-4 w-4" />Metas</Button>
            <Button variant="outline" size="sm" onClick={() => setJanela('rd')}><Settings2 className="mr-1 h-4 w-4" />RD Station</Button>
          </div>
        </div>

        {/* Filtros */}
        <Card>
          <CardContent className="flex flex-col gap-3 p-3 sm:flex-row sm:flex-wrap">
            <Seletor rotulo="Período" valor={filtros.mes} onChange={setF('mes')} todos={null} opcoes={meses} />
            <Seletor rotulo="Executivo" valor={filtros.executivo ?? ''} onChange={setF('executivo')} opcoes={(data?.opcoes.executivos ?? []).map((v) => ({ valor: v, rotulo: v }))} />
            <Seletor rotulo="Produto" valor={filtros.produto ?? ''} onChange={setF('produto')} opcoes={(data?.opcoes.produtos ?? []).map((v) => ({ valor: v, rotulo: v }))} />
            <Seletor rotulo="Funil" valor={filtros.funil ?? ''} onChange={setF('funil')} opcoes={(data?.opcoes.funis ?? []).map((v) => ({ valor: v, rotulo: v }))} />
            <Seletor rotulo="Origem" valor={filtros.origem ?? ''} onChange={setF('origem')} opcoes={(data?.opcoes.origens ?? []).map((v) => ({ valor: v, rotulo: v }))} />
            <Seletor rotulo="Região" valor={filtros.regiao ?? ''} onChange={setF('regiao')} opcoes={(data?.opcoes.regioes ?? []).map((v) => ({ valor: v, rotulo: v }))} />
          </CardContent>
        </Card>

        {isLoading && <div className="flex justify-center py-24"><LoadingSpinner /></div>}
        {error && <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">Não foi possível carregar o painel: {(error as Error).message}</p>}
        {data && <Conteudo data={data} atualizando={isFetching} abrirMetas={() => setJanela('metas')} abrirRd={() => setJanela('rd')} />}
      </div>

      <JanelaMetas aberta={janela === 'metas'} onClose={() => setJanela(null)} mes={filtros.mes} executivos={data?.opcoes.executivos ?? []} />
      <JanelaRd aberta={janela === 'rd'} onClose={() => setJanela(null)} admin={user?.role === 'admin'} />
    </PageContainer>
  )
}

function Conteudo({ data, atualizando, abrirMetas, abrirRd }: {
  data: PainelComercialData; atualizando: boolean; abrirMetas: () => void; abrirRd: () => void
}) {
  const k = data.kpis
  const usaRd = data.fonte !== 'crm'

  if (data.fonte === 'rd' && !data.rd) {
    return (
      <Card><CardContent className="flex flex-col items-center gap-3 py-16 text-center">
        <Layers className="h-10 w-10 text-blue-700" />
        <p className="max-w-md text-sm text-slate-600">O RD Station ainda não está conectado. Cole o token da instância de um usuário admin do RD para trazer as negociações.</p>
        <Button onClick={abrirRd}>Conectar RD Station</Button>
      </CardContent></Card>
    )
  }

  const barrasMeta = [
    { nome: 'Meta', valor: data.metaRealizadoForecast.meta ?? 0, cor: NEUTRO },
    { nome: 'Vendido', valor: data.metaRealizadoForecast.vendido, cor: AZUL },
    { nome: 'Projeção', valor: data.metaRealizadoForecast.projecao, cor: AZUL_CLARO },
  ]

  return (
    <div className={cn('space-y-4 transition-opacity', atualizando && 'opacity-70')}>
      {/* Avisos */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {usaRd && data.rd && (
          <span>RD Station sincronizado {haQuanto(data.rd.last_sync_at)}{data.rd.last_sync_status === 'erro' && <span className="text-red-700"> · última tentativa falhou</span>}</span>
        )}
        {k.meta === null && (
          <button onClick={abrirMetas} className="text-amber-700 underline-offset-2 hover:underline">
            Sem meta cadastrada para este mês: cadastre para ver atingimento, gap e cobertura
          </button>
        )}
      </div>
      {data.qualidade.abertosSemValor > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {data.qualidade.abertosSemValor} de {k.abertos} negócios abertos estão sem valor e não entram no pipeline nem no forecast.
            {data.qualidade.abertosSemProduto > 0 && ` ${data.qualidade.abertosSemProduto} estão sem produto.`}
          </span>
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Kpi icone={Target} titulo="Meta do mês" valor={compacto(k.meta)} rodape={k.meta === null && <span className="text-xs text-muted-foreground">não cadastrada</span>} />
        <Kpi icone={DollarSign} titulo="Vendido" valor={compacto(k.vendido)} rodape={<Variacao atual={k.vendido} anterior={k.vendidoAnt} />} dica={`${k.ganhosMes} negócios ganhos no mês`} />
        <Kpi icone={Percent} titulo="% Atingimento" valor={pct(k.atingimento)} rodape={<Variacao atual={k.atingimento} anterior={k.atingimentoAnt} modo="pp" />} />
        <Kpi icone={TrendingDown} titulo="Gap da meta" valor={compacto(k.gap)} />
        <Kpi icone={Filter} titulo="Pipeline aberto" valor={compacto(k.pipeline)} rodape={<span className="text-xs text-muted-foreground">{k.abertos} negócios abertos</span>} />
        <Kpi icone={BadgeCheck} titulo="Pipeline qualificado" valor={compacto(k.qualificado)} rodape={<span className="text-xs text-muted-foreground">da apresentação em diante</span>} />
        <Kpi icone={LineChart} titulo="Forecast ponderado" valor={compacto(k.ponderado)} rodape={<span className="text-xs text-muted-foreground">valor × chance da etapa</span>} />
        <Kpi icone={ShieldCheck} titulo="Commit" valor={compacto(k.commit)} rodape={<span className="text-xs text-muted-foreground">negociação e fechamento</span>} />
        <Kpi icone={Layers} titulo="Cobertura de pipeline" valor={vezes(k.cobertura)} rodape={<span className="text-xs text-muted-foreground">pipeline ÷ gap</span>} />
      </div>

      {/* Funil, meta x realizado, forecast */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Bloco titulo="Funil comercial" nota="negócios abertos">
          <div className="space-y-1.5">
            {data.funil.map((f, i) => {
              const largura = 100 - i * 9
              return (
                <div key={f.etapa} className="flex items-center gap-3">
                  <div className="flex flex-1 justify-center">
                    <div
                      className="flex h-7 items-center justify-center rounded text-xs font-medium text-white"
                      style={{ width: `${largura}%`, background: RAMPA_FUNIL[i], color: i < 2 ? '#0f172a' : '#fff' }}
                      title={`${f.etapa}: ${f.negocios} negócios, ${dinheiro(f.valor)} (chance ${pct(f.chance, 0)})`}
                    >
                      {f.etapa}
                    </div>
                  </div>
                  <div className="w-24 text-right text-xs tabular-nums text-slate-700">
                    <div className="font-medium">{f.negocios}</div>
                    <div className="text-muted-foreground">{compacto(f.valor)}</div>
                  </div>
                </div>
              )
            })}
          </div>
        </Bloco>

        <Bloco titulo="Meta x Vendido x Projeção" nota="projeção = vendido + commit">
          <div className="h-56">
            <ResponsiveContainer>
              <BarChart data={barrasMeta} margin={{ top: 24, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#eef2f7" />
                <XAxis dataKey="nome" tick={EIXO} axisLine={false} tickLine={false} />
                <YAxis tick={EIXO} axisLine={false} tickLine={false} tickFormatter={(v) => compacto(v).replace('R$ ', '')} width={56} />
                <Tooltip content={<DicaGrafico />} cursor={{ fill: '#f1f5f9' }} />
                <Bar dataKey="valor" radius={[4, 4, 0, 0]} maxBarSize={72}>
                  {barrasMeta.map((b) => <Cell key={b.nome} fill={b.cor} />)}
                  <LabelList dataKey="valor" position="top" formatter={(v) => compacto(Number(v)).replace('R$ ', '')} style={{ fontSize: 11, fill: '#334155', whiteSpace: 'nowrap' }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Bloco>

        <Bloco titulo="Forecast 30 / 60 / 90 dias" nota="ponderado, acumulado">
          <div className="h-56">
            <ResponsiveContainer>
              <BarChart data={data.forecast.map((f) => ({ nome: `${f.dias} dias`, valor: f.valor }))} margin={{ top: 24, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#eef2f7" />
                <XAxis dataKey="nome" tick={EIXO} axisLine={false} tickLine={false} />
                <YAxis tick={EIXO} axisLine={false} tickLine={false} tickFormatter={(v) => compacto(v).replace('R$ ', '')} width={56} />
                <Tooltip content={<DicaGrafico />} cursor={{ fill: '#f1f5f9' }} />
                <Bar dataKey="valor" fill={AZUL} radius={[4, 4, 0, 0]} maxBarSize={72}>
                  <LabelList dataKey="valor" position="top" formatter={(v) => compacto(Number(v)).replace('R$ ', '')} style={{ fontSize: 11, fill: '#334155', whiteSpace: 'nowrap' }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Pela previsão de fechamento quando existe; senão pela etapa (negociação/fechamento em 30, proposta em 60, apresentação em 90).</p>
        </Bloco>
      </div>

      {/* Pipeline por produto e por executivo, saúde */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Bloco titulo="Pipeline por produto">
          <BarrasHorizontais dados={data.porProduto} />
        </Bloco>
        <Bloco titulo="Pipeline por executivo">
          <BarrasHorizontais dados={data.porExecutivo.slice(0, 10)} />
        </Bloco>
        <Bloco titulo="Saúde comercial">
          <ul className="divide-y">
            {data.saude.map((s) => {
              const n = NIVEL[s.nivel]
              return (
                <li key={s.chave} className="flex items-center justify-between gap-2 py-2 text-sm" title={s.regra}>
                  <span className="text-slate-700">{s.nome}</span>
                  <span className="flex items-center gap-2 tabular-nums">
                    <span className="text-slate-600">{s.formato === 'x' ? vezes(s.valor) : pct(s.valor, 0)}</span>
                    <span className={cn('inline-flex w-24 items-center gap-1 text-xs font-medium', n.cor)}>
                      <n.icone className="h-3.5 w-3.5" />{n.rotulo}
                    </span>
                  </span>
                </li>
              )
            })}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">Passe o mouse sobre cada linha para ver a regra.</p>
        </Bloco>
      </div>

      {/* Gestão do pipeline */}
      <Bloco titulo="Gestão do pipeline" nota="parados = abertos sem atualização há mais de 30 dias">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b text-left text-xs font-medium text-slate-500">
                <th className="py-2 pr-3">Executivo</th>
                <th className="px-3 text-right">Meta</th>
                <th className="px-3 text-right">Vendido</th>
                <th className="px-3 text-right">Gap</th>
                <th className="px-3 text-right">Pipeline</th>
                <th className="px-3 text-right">Forecast</th>
                <th className="px-3 text-right">Cobertura</th>
                <th className="px-3 text-right">Abertos</th>
                <th className="pl-3 text-right">Parados</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {data.executivos.map((e) => (
                <tr key={e.nome} className="border-b last:border-0">
                  <td className="py-2 pr-3 text-slate-800">{e.nome}</td>
                  <td className="px-3 text-right">{dinheiro(e.meta)}</td>
                  <td className="px-3 text-right">{dinheiro(e.vendido)}</td>
                  <td className={cn('px-3 text-right', e.gap ? 'font-medium text-red-700' : '')}>{dinheiro(e.gap)}</td>
                  <td className="px-3 text-right">{dinheiro(e.pipeline)}</td>
                  <td className="px-3 text-right">{dinheiro(e.forecast)}</td>
                  <td className="px-3 text-right">{vezes(e.cobertura)}</td>
                  <td className="px-3 text-right">{e.abertos}</td>
                  <td className={cn('pl-3 text-right', e.parados > 0 && e.parados / Math.max(e.abertos, 1) > 0.4 ? 'font-medium text-red-700' : '')}>{e.parados}</td>
                </tr>
              ))}
              {!data.executivos.length && <tr><td colSpan={9} className="py-6 text-center text-muted-foreground">Nenhum negócio com esses filtros.</td></tr>}
            </tbody>
          </table>
        </div>
      </Bloco>

      {/* Canais de aquisição */}
      <div className="grid gap-4 lg:grid-cols-5">
        <Bloco titulo="Clientes fechados por canal" nota={`jan a ${NOME_MES[Number(data.filtros.mes.slice(5)) - 1]}/${data.filtros.mes.slice(0, 4)}`} className="lg:col-span-2">
          <BarrasHorizontais dados={data.canais.map((c) => ({ nome: c.canal, valor: c.clientes })).sort((a, b) => b.valor - a.valor)} formato={(v) => `${v} clientes`} rotulo={(v) => String(v)} />
        </Bloco>
        <Bloco titulo="Resumo por canal de aquisição" nota="ganhos do ano até o mês escolhido" className="lg:col-span-3">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs font-medium text-slate-500">
                  <th className="py-2 pr-3">Canal</th>
                  <th className="px-3 text-right">Clientes</th>
                  <th className="px-3 text-right">Receita</th>
                  <th className="px-3 text-right">Ticket médio</th>
                  <th className="pl-3 text-right" title="Ganhos ÷ (ganhos + perdidos) do canal no período">Conversão</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {data.canais.map((c) => (
                  <tr key={c.canal} className="border-b">
                    <td className="py-2 pr-3 text-slate-800">{c.canal}</td>
                    <td className="px-3 text-right">{c.clientes}</td>
                    <td className="px-3 text-right">{dinheiro(c.receita)}</td>
                    <td className="px-3 text-right">{dinheiro(c.ticket)}</td>
                    <td className="pl-3 text-right">{pct(c.conversao)}</td>
                  </tr>
                ))}
                <tr className="font-semibold text-slate-900">
                  <td className="py-2 pr-3">Total</td>
                  <td className="px-3 text-right">{data.canaisTotal.clientes}</td>
                  <td className="px-3 text-right">{dinheiro(data.canaisTotal.receita)}</td>
                  <td className="px-3 text-right">{dinheiro(data.canaisTotal.ticket)}</td>
                  <td className="pl-3 text-right">{pct(data.canaisTotal.conversao)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Bloco>
      </div>
    </div>
  )
}

function BarrasHorizontais({ dados, formato = compacto, rotulo = compacto }: {
  dados: { nome: string; valor: number }[]; formato?: (v: number) => string; rotulo?: (v: number) => string
}) {
  if (!dados.length) return <p className="py-8 text-center text-sm text-muted-foreground">Sem dados.</p>
  return (
    <div style={{ height: Math.max(dados.length * 30 + 10, 120) }}>
      <ResponsiveContainer>
        <BarChart data={dados} layout="vertical" margin={{ top: 0, right: 72, left: 0, bottom: 0 }} barCategoryGap={6}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="nome" tick={EIXO} axisLine={false} tickLine={false} width={150}
            tickFormatter={(v: string) => (v.length > 22 ? `${v.slice(0, 21)}…` : v)} />
          <Tooltip content={<DicaGrafico formato={formato} />} cursor={{ fill: '#f1f5f9' }} />
          <Bar dataKey="valor" fill={AZUL} radius={[0, 4, 4, 0]} maxBarSize={18}>
            <LabelList dataKey="valor" position="right" formatter={(v) => rotulo(Number(v))} style={{ fontSize: 11, fill: '#334155', whiteSpace: 'nowrap' }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
