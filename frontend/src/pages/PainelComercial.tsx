import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Bar, BarChart, CartesianGrid, Cell, LabelList, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import {
  Target, DollarSign, PieChart as IconePizza, TrendingUp, Filter, Users, LineChart, ShieldCheck, Shield,
  ArrowUp, ArrowDown, Calendar, User, Package, Globe, MapPin, GitBranch, Flag, Settings2, Info, ChevronDown,
  UserRound, Search, ClipboardList, FileText, Handshake, CircleCheck, Layers,
} from 'lucide-react'
import { PageContainer } from '@/components/layout/PageContainer'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'
import { Button } from '@/components/ui/button'
import { JanelaMetas, JanelaRd } from '@/components/comercial/JanelasPainel'
import { dinheiro, valorCard, curtoCard, mil, pct, vezes, ultimosMeses, haQuanto } from '@/components/comercial/formato'
import { useAuthStore } from '@/stores/authStore'
import { comercialApi, type FontePainel, type PainelComercialData, type PainelFiltros } from '@/services/api'
import { cn } from '@/lib/utils'

// ─── cores (iguais ao modelo aprovado pela Maria) ────────────────────────────

const C = {
  azul: '#1d4ed8',
  verde: '#16a34a',
  teal: '#0d9488',
  tealClaro: '#0e9aa7',
  laranja: '#f97316',
  roxo: '#7c3aed',
  marinho: '#1e3a8a',
  cinza: '#94a3b8',
  grade: '#e8edf3',
}
// Rosca de produtos: ordem validada (verificador de daltonismo da skill dataviz);
// "Outros" sempre em cinza.
const CORES_PRODUTO = ['#1d4ed8', '#0d9488', '#7c3aed', '#0ea5e9', '#d99a00']
// Funil: azul → verde, como no modelo.
const CORES_FUNIL = ['#1d4ed8', '#1f6fd6', '#1490c4', '#0f9fa8', '#12a383', '#16a34a']
const ICONES_FUNIL = [UserRound, Search, ClipboardList, FileText, Handshake, CircleCheck]
const EIXO = { fontSize: 11, fill: '#64748b' }

// ─── peças ───────────────────────────────────────────────────────────────────

function Caixa({ titulo, extra, children, className }: { titulo?: string; extra?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-xl border border-slate-200 bg-white p-4 shadow-sm', className)}>
      {titulo && (
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <h3 className="text-[15px] font-bold text-slate-900">{titulo}</h3>
          {extra && <span className="text-xs text-slate-500">{extra}</span>}
        </div>
      )}
      {children}
    </section>
  )
}

function Variacao({ atual, anterior, modo = 'pct', inverso = false }: { atual: number | null | undefined; anterior: number | null | undefined; modo?: 'pct' | 'pp' | 'x'; inverso?: boolean }) {
  const semBase = atual === null || atual === undefined || anterior === null || anterior === undefined || (modo === 'pct' && !anterior)
  if (semBase) return <span className="text-[10px] text-slate-400 2xl:text-[11px]">vs mês anterior —</span>
  const delta = modo === 'pct' ? (atual - anterior) / Math.abs(anterior) : modo === 'pp' ? (atual - anterior) * 100 : atual - anterior
  const sobe = delta >= 0
  const Seta = sobe ? ArrowUp : ArrowDown
  const texto = modo === 'pct'
    ? `${(Math.abs(delta) * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`
    : modo === 'pp' ? `${Math.abs(delta).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} p.p.` : `${Math.abs(delta).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}x`
  return (
    <span className="inline-flex flex-wrap items-center justify-center gap-x-1 text-[10px] text-slate-500 2xl:text-[11px]">
      vs mês anterior
      <span className={cn('inline-flex items-center font-semibold', sobe !== inverso ? 'text-green-700' : 'text-red-600')}>
        <Seta className="h-3 w-3" strokeWidth={3} />{texto}
      </span>
    </span>
  )
}

function Kpi({ icone: Icone, cor, titulo, valor, curto, rodape, dica }: {
  icone: typeof Target; cor: string; titulo: string; valor: string; curto?: string; rodape: React.ReactNode; dica?: string
}) {
  return (
    <div className="flex min-w-0 flex-col rounded-xl border border-slate-200 bg-white p-2.5 shadow-sm 2xl:p-3" title={dica}>
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white 2xl:h-8 2xl:w-8" style={{ background: cor }}>
          <Icone className="h-3.5 w-3.5 2xl:h-4 2xl:w-4" strokeWidth={2.5} />
        </span>
        <span className="text-[12px] font-semibold leading-tight text-slate-800 xl:text-[11px] min-[1440px]:text-[12px] 2xl:text-[13px]">{titulo}</span>
      </div>
      <div className="mt-2 truncate text-center text-[22px] font-bold tabular-nums xl:text-[15px] 2xl:text-[18px] min-[1800px]:text-[22px]" style={{ color: cor }} title={valor}>
        {/* 1280–1535px: 9 cards numa linha não comportam "R$ 251.538"; usa "R$ 251,5 mil". */}
        <span className="hidden xl:inline 2xl:hidden">{curto ?? valor}</span>
        <span className="xl:hidden 2xl:inline">{valor}</span>
      </div>
      <div className="mt-1 text-center">{rodape}</div>
    </div>
  )
}

function Filtro({ icone: Icone, rotulo, valor, onChange, opcoes, prefixo }: {
  icone: typeof Calendar; rotulo: string; valor: string; onChange: (v: string) => void
  opcoes: { valor: string; rotulo: string }[]; prefixo?: boolean
}) {
  return (
    <label className="relative flex h-10 min-w-0 items-center gap-2 rounded-xl border border-slate-200 bg-white pl-3 pr-8 shadow-sm focus-within:ring-2 focus-within:ring-blue-500 2xl:h-11">
      <Icone className="h-[18px] w-[18px] shrink-0 text-slate-600" />
      {prefixo && <span className="shrink-0 text-sm text-slate-700">{rotulo}:</span>}
      <select
        aria-label={rotulo}
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        className={cn('w-full min-w-0 cursor-pointer appearance-none truncate bg-transparent text-sm focus:outline-none',
          prefixo ? 'font-semibold text-blue-700' : valor ? 'font-semibold text-slate-900' : 'text-slate-700')}
      >
        {!prefixo && <option value="">{rotulo}</option>}
        {opcoes.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 h-4 w-4 text-slate-500" />
    </label>
  )
}

function Dica({ active, payload, label, fmt = dinheiro }: {
  active?: boolean; payload?: { value: number; payload: Record<string, unknown> }[]; label?: string; fmt?: (v: number) => string
}) {
  if (!active || !payload?.length) return null
  const p = payload[0]
  const extra = p.payload.extra as string | undefined
  return (
    <div className="rounded-md border bg-white px-3 py-2 text-xs shadow-md">
      <div className="font-semibold text-slate-800">{label ?? (p.payload.nome as string)}</div>
      <div className="text-slate-700">{fmt(p.value)}</div>
      {extra && <div className="text-slate-500">{extra}</div>}
    </div>
  )
}

const NIVEL = {
  verde: { cor: '#16a34a', rotulo: 'Verde' },
  amarelo: { cor: '#f59e0b', rotulo: 'Amarelo' },
  vermelho: { cor: '#dc2626', rotulo: 'Vermelho' },
  sem_dado: { cor: '#94a3b8', rotulo: 'Sem dado' },
} as const

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
  const op = (xs: string[] | undefined) => (xs ?? []).map((v) => ({ valor: v, rotulo: v }))

  return (
    <PageContainer>
      <div className="space-y-3">
        {/* Cabeçalho */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-[28px] font-bold leading-tight text-[#0f1f4b]">Dashboard Comercial | CRM de Consultoria</h1>
            <p className="text-[15px] text-slate-500">Visão executiva para Pipeline, Forecast, Performance e Canais de Aquisição</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 shadow-sm" role="tablist" aria-label="Fonte dos dados">
              {FONTES.map((f) => (
                <button
                  key={f.valor} role="tab" aria-selected={fonte === f.valor} onClick={() => setFonte(f.valor)}
                  className={cn('rounded-md px-3 py-1.5 text-sm font-semibold transition-colors',
                    fonte === f.valor ? 'bg-[#1d4ed8] text-white' : 'text-slate-600 hover:bg-slate-100')}
                >
                  {f.rotulo}
                </button>
              ))}
            </div>
            <Button variant="outline" size="sm" onClick={() => setJanela('metas')}><Flag className="mr-1 h-4 w-4" />Metas</Button>
            <Button variant="outline" size="sm" onClick={() => setJanela('rd')} aria-label="Conexão com o RD Station"><Settings2 className="h-4 w-4" /></Button>
          </div>
        </div>

        {/* Filtros */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-[1.45fr_1fr_1fr_1fr_1fr_1fr]">
          <Filtro icone={Calendar} rotulo="Período" prefixo valor={filtros.mes} onChange={setF('mes')} opcoes={meses} />
          <Filtro icone={User} rotulo="Executivo" valor={filtros.executivo ?? ''} onChange={setF('executivo')} opcoes={op(data?.opcoes.executivos)} />
          <Filtro icone={Package} rotulo="Produto" valor={filtros.produto ?? ''} onChange={setF('produto')} opcoes={op(data?.opcoes.produtos)} />
          <Filtro icone={GitBranch} rotulo="Funil" valor={filtros.funil ?? ''} onChange={setF('funil')} opcoes={op(data?.opcoes.funis)} />
          <Filtro icone={Globe} rotulo="Origem" valor={filtros.origem ?? ''} onChange={setF('origem')} opcoes={op(data?.opcoes.origens)} />
          <Filtro icone={MapPin} rotulo="Região" valor={filtros.regiao ?? ''} onChange={setF('regiao')} opcoes={op(data?.opcoes.regioes)} />
        </div>

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
  const foto = data.fotoAnterior

  if (data.fonte === 'rd' && !data.rd) {
    return (
      <Caixa>
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <Layers className="h-10 w-10 text-blue-700" />
          <p className="max-w-md text-sm text-slate-600">O RD Station ainda não está conectado. Cole o token da instância de um usuário admin do RD para trazer as negociações.</p>
          <Button onClick={abrirRd}>Conectar RD Station</Button>
        </div>
      </Caixa>
    )
  }

  const barrasMeta = [
    { nome: 'Meta', valor: data.metaRealizadoForecast.meta ?? 0, cor: C.azul },
    { nome: 'Vendido', valor: data.metaRealizadoForecast.vendido, cor: C.verde },
    { nome: 'Forecast', valor: data.metaRealizadoForecast.projecao, cor: C.teal, extra: 'vendido + commit (negociação e fechamento)' },
  ]
  const totalProduto = data.porProduto.reduce((t, p) => t + p.valor, 0)
  const produtos = data.porProduto.map((p, i) => ({
    ...p, cor: p.nome === 'Outros' ? C.cinza : CORES_PRODUTO[i % CORES_PRODUTO.length], parte: totalProduto ? p.valor / totalProduto : 0,
  }))
  const funilMax = Math.max(...data.funil.map((f) => f.valor), 1)

  return (
    <div className={cn('space-y-3 transition-opacity', atualizando && 'opacity-70')}>
      {/* Avisos discretos */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
        {data.fonte !== 'crm' && data.rd && (
          <span>RD Station sincronizado {haQuanto(data.rd.last_sync_at)}{data.rd.last_sync_status === 'erro' && <span className="text-red-700"> · última tentativa falhou</span>}</span>
        )}
        {k.meta === null && (
          <button onClick={abrirMetas} className="font-medium text-amber-700 hover:underline">Cadastrar meta do mês</button>
        )}
        {data.qualidade.abertosSemValor > 0 && (
          <span className="inline-flex items-center gap-1 text-amber-800" title="Negócio sem valor não entra no pipeline nem no forecast.">
            <Info className="h-3.5 w-3.5" />{data.qualidade.abertosSemValor} de {k.abertos} negócios abertos sem valor
          </span>
        )}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-9">
        <Kpi icone={Target} cor={C.azul} titulo="Meta do mês" valor={valorCard(k.meta)} curto={curtoCard(k.meta)} rodape={<Variacao atual={k.meta} anterior={k.metaAnt} />} />
        <Kpi icone={DollarSign} cor={C.verde} titulo="Vendido" valor={valorCard(k.vendido)} curto={curtoCard(k.vendido)} rodape={<Variacao atual={k.vendido} anterior={k.vendidoAnt} />} dica={`${k.ganhosMes} negócios ganhos no mês`} />
        <Kpi icone={IconePizza} cor={C.teal} titulo="% Atingimento" valor={pct(k.atingimento)} rodape={<Variacao atual={k.atingimento} anterior={k.atingimentoAnt} modo="pp" />} />
        <Kpi icone={TrendingUp} cor={C.laranja} titulo="Gap da meta" valor={valorCard(k.gap)} curto={curtoCard(k.gap)} rodape={<Variacao atual={k.gap} anterior={k.gapAnt} inverso />} />
        <Kpi icone={Filter} cor={C.roxo} titulo="Pipeline aberto" valor={valorCard(k.pipeline)} curto={curtoCard(k.pipeline)} rodape={<Variacao atual={k.pipeline} anterior={foto?.pipeline} />} dica={`${k.abertos} negócios abertos`} />
        <Kpi icone={Users} cor={C.azul} titulo="Pipeline qualificado" valor={valorCard(k.qualificado)} curto={curtoCard(k.qualificado)} rodape={<Variacao atual={k.qualificado} anterior={foto?.qualificado} />} dica="Da apresentação em diante" />
        <Kpi icone={LineChart} cor={C.teal} titulo="Forecast ponderado" valor={valorCard(k.ponderado)} curto={curtoCard(k.ponderado)} rodape={<Variacao atual={k.ponderado} anterior={foto?.ponderado} />} dica="Valor × chance da etapa" />
        <Kpi icone={ShieldCheck} cor={C.verde} titulo="Commit" valor={valorCard(k.commit)} curto={curtoCard(k.commit)} rodape={<Variacao atual={k.commit} anterior={foto?.commit} />} dica="Negócios em negociação e fechamento" />
        <Kpi icone={Shield} cor={C.marinho} titulo="Cobertura de pipeline" valor={vezes(k.cobertura)} rodape={<Variacao atual={k.cobertura} anterior={foto?.cobertura} modo="x" />} dica="Pipeline aberto ÷ gap da meta" />
      </div>

      {/* Funil, meta x realizado x forecast, forecast 30/60/90 */}
      <div className="grid gap-3 xl:grid-cols-[1.3fr_1fr_1fr]">
        <Caixa titulo="Funil Financeiro">
          <div className="flex items-center gap-3">
            <div className="flex w-[32%] shrink-0 flex-col items-center gap-[3px] 2xl:w-[40%]">
              {data.funil.map((f, i) => {
                const Icone = ICONES_FUNIL[i]
                const topo = 100 - i * 13
                const base = 100 - (i + 1) * 13
                return (
                  <div
                    key={f.etapa}
                    className="flex h-[30px] w-full items-center justify-center"
                    style={{ background: CORES_FUNIL[i], clipPath: `polygon(${(100 - topo) / 2}% 0, ${100 - (100 - topo) / 2}% 0, ${100 - (100 - base) / 2}% 100%, ${(100 - base) / 2}% 100%)` }}
                    title={`${f.etapa}: ${f.negocios} negócios · ${dinheiro(f.valor)}`}
                  >
                    <Icone className="h-4 w-4 text-white" strokeWidth={2.5} />
                  </div>
                )
              })}
            </div>
            <ul className="min-w-0 flex-1 space-y-[9px] text-[12px] 2xl:text-[13px]">
              {data.funil.map((f, i) => (
                <li key={f.etapa} className="flex items-center gap-1.5" title={`${f.etapa}: ${pct(f.valor / funilMax, 0)} da maior etapa`}>
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: CORES_FUNIL[i] }} />
                  <span className="min-w-0 flex-1 truncate text-slate-700">{f.etapa}</span>
                  <span className="w-8 text-right tabular-nums text-slate-800">{f.negocios}</span>
                  <span className="text-slate-300">|</span>
                  <span className="w-[78px] text-right tabular-nums text-slate-800">R$ {mil(f.valor)} mil</span>
                </li>
              ))}
            </ul>
          </div>
        </Caixa>

        <Caixa titulo="Meta x Realizado x Forecast">
          <div className="text-[11px] text-slate-500">R$ mil</div>
          <div className="h-[170px]">
            <ResponsiveContainer>
              <BarChart data={barrasMeta} margin={{ top: 22, right: 8, left: -8, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={C.grade} />
                <XAxis dataKey="nome" tick={EIXO} axisLine={false} tickLine={false} />
                <YAxis tick={EIXO} axisLine={false} tickLine={false} tickFormatter={(v) => mil(Number(v))} width={48} />
                <Tooltip content={<Dica />} cursor={{ fill: '#f1f5f9' }} />
                <Bar dataKey="valor" radius={[3, 3, 0, 0]} maxBarSize={64}>
                  {barrasMeta.map((b) => <Cell key={b.nome} fill={b.cor} />)}
                  <LabelList dataKey="valor" position="top" formatter={(v) => dinheiro(Number(v))} style={{ fontSize: 11, fontWeight: 600, fill: '#1e293b', whiteSpace: 'nowrap' }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Caixa>

        <Caixa titulo="Forecast 30 / 60 / 90 dias">
          <div className="text-[11px] text-slate-500">R$ mil</div>
          <div className="h-[170px]">
            <ResponsiveContainer>
              <BarChart data={data.forecast.map((f) => ({ nome: `${f.dias} dias`, valor: f.valor, extra: 'ponderado, acumulado' }))} margin={{ top: 22, right: 8, left: -8, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={C.grade} />
                <XAxis dataKey="nome" tick={EIXO} axisLine={false} tickLine={false} />
                <YAxis tick={EIXO} axisLine={false} tickLine={false} tickFormatter={(v) => mil(Number(v))} width={48} />
                <Tooltip content={<Dica />} cursor={{ fill: '#f1f5f9' }} />
                <Bar dataKey="valor" fill={C.tealClaro} radius={[3, 3, 0, 0]} maxBarSize={64}>
                  <LabelList dataKey="valor" position="top" formatter={(v) => dinheiro(Number(v))} style={{ fontSize: 11, fontWeight: 600, fill: '#1e293b', whiteSpace: 'nowrap' }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Caixa>
      </div>

      {/* Pipeline por etapa, produto, executivo e saúde */}
      <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-[1fr_1.2fr_1fr_0.85fr]">
        <Caixa titulo="Pipeline por Etapa" extra="R$ mil">
          <div className="h-[160px]">
            <ResponsiveContainer>
              <BarChart data={data.funil.map((f) => ({ nome: f.etapa, valor: f.valor, extra: `${f.negocios} negócios` }))} layout="vertical" margin={{ top: 0, right: 44, left: 0, bottom: 0 }} barCategoryGap={5}>
                <CartesianGrid horizontal={false} stroke={C.grade} />
                <XAxis type="number" tick={EIXO} axisLine={false} tickLine={false} tickFormatter={(v) => mil(Number(v))} />
                <YAxis type="category" dataKey="nome" tick={EIXO} axisLine={false} tickLine={false} width={82} />
                <Tooltip content={<Dica />} cursor={{ fill: '#f1f5f9' }} />
                <Bar dataKey="valor" fill={C.azul} maxBarSize={14} radius={[0, 2, 2, 0]}>
                  <LabelList dataKey="valor" position="right" formatter={(v) => mil(Number(v))} style={{ fontSize: 11, fontWeight: 600, fill: '#1e293b' }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Caixa>

        <Caixa titulo="Pipeline por Produto">
          <div className="flex items-center gap-3">
            <div className="relative h-[130px] w-[130px] shrink-0 2xl:h-[150px] 2xl:w-[150px]">
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={produtos} dataKey="valor" nameKey="nome" innerRadius="62%" outerRadius="98%" paddingAngle={1} stroke="#fff" strokeWidth={2} startAngle={90} endAngle={-270}>
                    {produtos.map((p) => <Cell key={p.nome} fill={p.cor} />)}
                  </Pie>
                  <Tooltip content={<Dica />} />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-[12px] font-bold text-slate-900 2xl:text-[13px]">R$ {mil(totalProduto)} mil</span>
                <span className="text-[11px] font-semibold text-slate-600">100%</span>
              </div>
            </div>
            <ul className="min-w-0 flex-1 space-y-1.5 text-[11px] 2xl:text-[12px]">
              {produtos.map((p) => (
                <li key={p.nome} className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: p.cor }} />
                  <span className="min-w-0 flex-1 truncate text-slate-700" title={p.nome}>{p.nome}</span>
                  <span className="shrink-0 tabular-nums text-slate-800" title={pct(p.parte)}>R$ {mil(p.valor)} mil<span className="hidden 2xl:inline"> ({pct(p.parte)})</span></span>
                </li>
              ))}
            </ul>
          </div>
        </Caixa>

        <Caixa titulo="Pipeline por Executivo" extra="R$ mil">
          <div className="h-[160px]">
            <ResponsiveContainer>
              <BarChart data={data.porExecutivo.slice(0, 5).map((e) => ({ ...e, curto: e.nome.split(' ')[0] }))} margin={{ top: 18, right: 4, left: -14, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={C.grade} />
                <XAxis dataKey="curto" tick={{ ...EIXO, fontSize: 10 }} axisLine={false} tickLine={false} interval={0}
                  tickFormatter={(v: string) => (v.length > 8 ? `${v.slice(0, 7)}.` : v)} />
                <YAxis tick={EIXO} axisLine={false} tickLine={false} tickFormatter={(v) => mil(Number(v))} width={44} />
                <Tooltip content={<Dica />} cursor={{ fill: '#f1f5f9' }} />
                <Bar dataKey="valor" fill={C.azul} radius={[2, 2, 0, 0]} maxBarSize={30}>
                  <LabelList dataKey="valor" position="top" formatter={(v) => mil(Number(v))} style={{ fontSize: 11, fontWeight: 600, fill: '#1e293b' }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Caixa>

        <Caixa titulo="Saúde Comercial">
          <ul className="divide-y divide-slate-100">
            {data.saude.map((s) => {
              const n = NIVEL[s.nivel]
              const valor = s.formato === 'x' ? vezes(s.valor) : pct(s.valor, 0)
              return (
                <li key={s.chave} className="flex items-center justify-between gap-2 py-[7px] text-[12px] 2xl:text-[13px]" title={`${valor} · ${s.regra}`}>
                  <span className="min-w-0 truncate text-slate-700">{s.nome}</span>
                  <span className="flex w-[78px] shrink-0 items-center gap-1.5">
                    <span className="h-3 w-3 rounded-full" style={{ background: n.cor }} />
                    <span className="font-medium" style={{ color: n.cor === '#f59e0b' ? '#b45309' : n.cor }}>{n.rotulo}</span>
                  </span>
                </li>
              )
            })}
          </ul>
        </Caixa>
      </div>

      {/* Gestão do pipeline + canais */}
      <div className="grid gap-3 2xl:grid-cols-[1.12fr_1fr]">
        <div className="space-y-3">
          <Caixa titulo="Gestão do Pipeline">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-[13px]">
                <thead>
                  <tr className="bg-slate-50 text-left text-xs font-bold text-slate-800">
                    <th className="py-2 pl-2 pr-3">Executivo</th>
                    <th className="px-3 text-center">Meta</th>
                    <th className="px-3 text-center">Vendido</th>
                    <th className="px-3 text-center">Gap</th>
                    <th className="px-3 text-center">Pipeline</th>
                    <th className="px-3 text-center">Forecast</th>
                    <th className="px-3 text-center">Cobertura</th>
                    <th className="px-3 text-center" title="Abertos sem atualização há mais de 30 dias">Negócios parados</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {data.executivos.map((e) => (
                    <tr key={e.nome} className="border-b border-slate-100 last:border-0">
                      <td className="py-1.5 pl-2 pr-3 text-slate-800">{e.nome}</td>
                      <td className="px-3 text-center">{dinheiro(e.meta)}</td>
                      <td className="px-3 text-center">{dinheiro(e.vendido)}</td>
                      <td className={cn('px-3 text-center', e.gap ? 'text-red-600' : '')}>{dinheiro(e.gap)}</td>
                      <td className="px-3 text-center">{dinheiro(e.pipeline)}</td>
                      <td className="px-3 text-center">{dinheiro(e.forecast)}</td>
                      <td className="px-3 text-center">{vezes(e.cobertura)}</td>
                      <td className={cn('px-3 text-center', e.parados > 0 && 'text-red-600')}>{e.parados}</td>
                    </tr>
                  ))}
                  {!data.executivos.length && <tr><td colSpan={8} className="py-6 text-center text-slate-500">Nenhum negócio com esses filtros.</td></tr>}
                </tbody>
              </table>
            </div>
          </Caixa>

          <Caixa>
            <span className="mb-3 inline-block rounded-full bg-[#1d4ed8] px-4 py-1 text-[13px] font-bold text-white">
              Origem dos clientes fechados (Canais de Aquisição)
            </span>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <h4 className="text-[13px] font-bold text-slate-900">Clientes fechados por canal</h4>
                <p className="text-[11px] text-slate-500">Quantidade de clientes</p>
                <BarrasCanal dados={[...data.canais].sort((a, b) => b.clientes - a.clientes).map((c) => ({ nome: c.canal, valor: c.clientes }))} rotulo={(v) => String(v)} fmt={(v) => `${v} clientes`} />
              </div>
              <div>
                <h4 className="text-[13px] font-bold text-slate-900">Receita por canal de aquisição</h4>
                <p className="text-[11px] text-slate-500">R$ mil</p>
                <BarrasCanal dados={data.canais.map((c) => ({ nome: c.canal, valor: c.receita }))} rotulo={(v) => dinheiro(v)} fmt={dinheiro} eixoMil />
              </div>
            </div>
          </Caixa>
        </div>

        <Caixa titulo="Resumo por canal de aquisição" extra={`ganhos de jan até o mês escolhido`}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-[13px]">
              <thead>
                <tr className="bg-slate-50 text-left text-xs font-bold text-slate-800">
                  <th className="py-2 pl-2 pr-3">Canal</th>
                  <th className="px-3 text-center">Clientes fechados</th>
                  <th className="px-3 text-center">Receita (R$)</th>
                  <th className="px-3 text-center">Ticket médio (R$)</th>
                  <th className="px-3 text-center" title="Ganhos ÷ (ganhos + perdidos) do canal no período">Conversão (%)</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {data.canais.map((c) => (
                  <tr key={c.canal} className="border-b border-slate-100">
                    <td className="py-2 pl-2 pr-3 text-slate-800">{c.canal}</td>
                    <td className="px-3 text-center">{c.clientes}</td>
                    <td className="px-3 text-center">{dinheiro(c.receita)}</td>
                    <td className="px-3 text-center">{dinheiro(c.ticket)}</td>
                    <td className="px-3 text-center">{pct(c.conversao)}</td>
                  </tr>
                ))}
                <tr className="bg-slate-50 text-[15px] font-bold text-[#0f1f4b]">
                  <td className="py-3 pl-2 pr-3">Total</td>
                  <td className="px-3 text-center">{data.canaisTotal.clientes}</td>
                  <td className="px-3 text-center">{dinheiro(data.canaisTotal.receita)}</td>
                  <td className="px-3 text-center">{dinheiro(data.canaisTotal.ticket)}</td>
                  <td className="px-3 text-center">{pct(data.canaisTotal.conversao)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Caixa>
      </div>
    </div>
  )
}

function BarrasCanal({ dados, rotulo, fmt, eixoMil }: {
  dados: { nome: string; valor: number }[]; rotulo: (v: number) => string; fmt: (v: number) => string; eixoMil?: boolean
}) {
  if (!dados.length) return <p className="py-8 text-center text-sm text-slate-500">Sem dados.</p>
  return (
    <div style={{ height: Math.max(dados.length * 19 + 28, 120) }}>
      <ResponsiveContainer>
        <BarChart data={dados} layout="vertical" margin={{ top: 4, right: eixoMil ? 78 : 28, left: 0, bottom: 0 }} barCategoryGap={3}>
          <CartesianGrid horizontal={false} stroke={C.grade} />
          <XAxis type="number" tick={EIXO} axisLine={false} tickLine={false} tickFormatter={(v) => (eixoMil ? mil(Number(v)) : String(v))} />
          <YAxis type="category" dataKey="nome" tick={{ ...EIXO, fontSize: 10 }} axisLine={false} tickLine={false} width={112}
            tickFormatter={(v: string) => (v.length > 20 ? `${v.slice(0, 19)}…` : v)} />
          <Tooltip content={<Dica fmt={fmt} />} cursor={{ fill: '#f1f5f9' }} />
          <Bar dataKey="valor" fill={C.azul} maxBarSize={10} radius={[0, 2, 2, 0]}>
            <LabelList dataKey="valor" position="right" formatter={(v) => rotulo(Number(v))} style={{ fontSize: 10, fill: '#1e293b', whiteSpace: 'nowrap' }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
