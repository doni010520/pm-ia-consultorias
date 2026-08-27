import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import {
  ArrowLeft,
  Bot,
  ExternalLink,
  MessageSquare,
  Building2,
  Mail,
  MapPin,
  Phone,
  Search,
  Tag,
  User,
} from 'lucide-react'
import { PageContainer } from '@/components/layout/PageContainer'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { LoadingSpinner, EmptyState, ErrorState } from '@/components/shared/LoadingSpinner'
import { crmApi } from '@/services/api'
import { cn } from '@/lib/utils'
import type { Conversation, ConversationMessage, ConversationSender } from '@/types'

const LIST_REFETCH_MS = 10_000
const THREAD_REFETCH_MS = 8_000
const THREAD_LIMIT = 200
/** Teto aceito por `GET /api/crm/conversations`. Paginas maiores sao cortadas la. */
const LIST_PAGE_SIZE = 200

/** Pausa o polling enquanto a aba estiver oculta (protege o Disk IO do banco). */
function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() =>
    typeof document === 'undefined' ? true : document.visibilityState === 'visible'
  )
  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', onChange)
    return () => document.removeEventListener('visibilitychange', onChange)
  }, [])
  return visible
}

function useDebounced(value: string, delay = 300): string {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

function digitsOnly(phone: string | null | undefined): string {
  return (phone || '').replace(/\D/g, '')
}

function formatPhone(phone: string | null | undefined): string {
  const d = digitsOnly(phone)
  if (!d) return '-'
  const local = d.startsWith('55') ? d.slice(2) : d
  if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`
  if (local.length === 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`
  return `+${d}`
}

/**
 * `contacts.name` recebe a string literal "Sem nome" quando o CRM cria o contato
 * sem saber o nome (api/src/routes/crm.js). Isso NAO e um nome: se passasse
 * direto, a lista inteira viraria "Sem nome" e o telefone -- que identifica de
 * verdade -- ficaria escondido.
 */
const PLACEHOLDERS_DE_NOME = ['sem nome', 'sem nome ', 'desconhecido', 'null', 'undefined']

/**
 * Converte um valor da API em texto exibível, sem supor que ele é string.
 *
 * Colunas jsonb chegam como ARRAY ou objeto — `contacts.interesses` vem como `[]`
 * em todo contato. E `[] ?? ''` continua sendo o array, então `.trim()` nele
 * lança TypeError e derruba a tela inteira pelo ErrorBoundary. Era exatamente
 * este o crash em /crm/conversas.
 */
function textoDe(valor: unknown): string {
  if (valor === null || valor === undefined) return ''
  if (typeof valor === 'string') return valor.trim()
  if (typeof valor === 'number' || typeof valor === 'boolean') return String(valor)
  if (Array.isArray(valor)) return valor.map(textoDe).filter(Boolean).join(', ')
  return '' // objeto solto não tem forma útil de exibir aqui
}

function nomeUtil(nome: unknown): string {
  const n = textoDe(nome)
  if (!n || PLACEHOLDERS_DE_NOME.includes(n.toLowerCase())) return ''
  // so digitos/pontuacao de telefone tambem nao e nome
  if (/^[\d\s+().-]+$/.test(n)) return ''
  return n
}

function conversationLabel(c: Conversation): string {
  return nomeUtil(c.contact_name) || nomeUtil(c.deal_title) || formatPhone(c.phone)
}

/** Iniciais para o avatar. Cai para o fim do telefone quando nao ha nome. */
function iniciaisDe(c: Conversation): string {
  const nome = nomeUtil(c.contact_name) || nomeUtil(c.deal_title)
  if (nome) {
    const partes = nome.split(/\s+/).filter(Boolean)
    const a = partes[0]?.[0] ?? ''
    const b = partes.length > 1 ? (partes[partes.length - 1]?.[0] ?? '') : ''
    return (a + b).toUpperCase()
  }
  return (c.phone || '').replace(/\D/g, '').slice(-2) || '?'
}

/**
 * Cor estavel por telefone. Hash simples so para espalhar: a mesma conversa
 * precisa ter sempre a mesma cor, senao o avatar "pisca" de cor a cada refetch.
 */
const CORES_AVATAR = [
  'bg-indigo-100 text-indigo-700',
  'bg-emerald-100 text-emerald-700',
  'bg-amber-100 text-amber-700',
  'bg-rose-100 text-rose-700',
  'bg-sky-100 text-sky-700',
  'bg-violet-100 text-violet-700',
  'bg-teal-100 text-teal-700',
  'bg-orange-100 text-orange-700',
]

function corAvatar(chave: string): string {
  let h = 0
  for (let i = 0; i < chave.length; i++) h = (h * 31 + chave.charCodeAt(i)) >>> 0
  return CORES_AVATAR[h % CORES_AVATAR.length] as string
}

/**
 * Hora no formato do inbox: so o relogio quando e de hoje, dia/mes quando e
 * mais antigo. "ha 4 minutos" ocupa mais espaco e diz menos numa lista longa.
 */
function horaDaLista(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const hoje = new Date()
  const mesmoDia =
    d.getDate() === hoje.getDate() &&
    d.getMonth() === hoje.getMonth() &&
    d.getFullYear() === hoje.getFullYear()
  return mesmoDia
    ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

const IN_VALUES = ['in', 'inbound', 'incoming', 'received']
const OUT_VALUES = ['out', 'outbound', 'outgoing', 'sent']

/**
 * `direction` pode vir null (mensagens gravadas pelo caminho do n8n) ou com um
 * valor desconhecido. Nesses casos derivamos do `role`, que sempre existe.
 * Quando o dado estiver 100% confiavel no banco, basta simplificar aqui.
 */
function resolveDirection(msg: ConversationMessage): 'in' | 'out' {
  const raw = msg.direction?.trim().toLowerCase()
  if (raw && IN_VALUES.includes(raw)) return 'in'
  if (raw && OUT_VALUES.includes(raw)) return 'out'
  return msg.role === 'client' ? 'in' : 'out'
}

/** Mesma logica defensiva para `sender`, usado apenas para rotular a bolha. */
function resolveSender(msg: ConversationMessage): ConversationSender {
  const raw = msg.sender?.trim().toLowerCase()
  if (raw === 'cliente' || raw === 'rica_ai' || raw === 'system_followup') return raw
  if (msg.role === 'client') return 'cliente'
  if (msg.role === 'system') return 'system_followup'
  return 'rica_ai'
}

/** Direcao da previa da lista: sem `role` disponivel, null = indefinido. */
function resolveListDirection(direction: string | null): 'in' | 'out' | null {
  const raw = direction?.trim().toLowerCase()
  if (raw && IN_VALUES.includes(raw)) return 'in'
  if (raw && OUT_VALUES.includes(raw)) return 'out'
  return null
}

/** Mensagem do lead fica a esquerda; Rica (e follow-ups automaticos) a direita. */
function isFromLead(msg: ConversationMessage): boolean {
  return resolveDirection(msg) === 'in'
}

function senderLabel(msg: ConversationMessage, leadName: string): string {
  const sender = resolveSender(msg)
  if (sender === 'cliente') return leadName
  if (sender === 'system_followup') return 'Rica · follow-up automático'
  return 'Rica'
}

// So a hora: o dia passou a ser responsabilidade do separador de data, e
// repeti-lo em cada balao poluia a leitura.
function formatTime(date: string | null): string {
  if (!date) return ''
  const d = new Date(date)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

// O backfill do historico do n8n gravou horario ESTIMADO onde a origem nao
// tinha data nenhuma (2635 das 3628 mensagens). A ORDEM e confiavel; o relogio
// nao. Sem esta marca, alguem leria "o lead respondeu em 2 minutos" como fato.
function isApproximateTime(msg: ConversationMessage): boolean {
  const v = (msg.metadata as Record<string, unknown> | null)?.hora_aproximada
  return v === true || v === 'true'
}

function dayKey(date: string | null): string {
  if (!date) return ''
  const d = new Date(date)
  return Number.isNaN(d.getTime()) ? '' : d.toDateString()
}

function formatDayLabel(date: string | null): string {
  if (!date) return ''
  const d = new Date(date)
  if (Number.isNaN(d.getTime())) return ''
  const hoje = new Date()
  const inicio = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const dias = Math.round((inicio(hoje) - inicio(d)) / 86_400_000)
  if (dias === 0) return 'Hoje'
  if (dias === 1) return 'Ontem'
  if (dias > 1 && dias < 7) return d.toLocaleDateString('pt-BR', { weekday: 'long' })
  return d.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'long',
    ...(d.getFullYear() === hoje.getFullYear() ? {} : { year: 'numeric' }),
  })
}

function ConversationRow({ conversation, active, onSelect }: {
  conversation: Conversation
  active: boolean
  onSelect: () => void
}) {
  const preview = conversation.last_message_text?.trim() || 'Sem mensagens'
  const listDirection = resolveListDirection(conversation.last_message_direction)
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'w-full text-left px-3 py-2.5 border-b border-slate-100 transition-colors',
        active ? 'bg-indigo-50' : 'hover:bg-slate-50'
      )}
    >
      <div className="flex gap-2.5">
        <div
          className={cn(
            'h-9 w-9 shrink-0 rounded-full flex items-center justify-center text-xs font-semibold',
            corAvatar(conversation.phone)
          )}
          aria-hidden
        >
          {iniciaisDe(conversation)}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-sm font-medium text-slate-800 truncate">
              {conversationLabel(conversation)}
            </span>
            <span className="text-[10px] text-slate-400 shrink-0 tabular-nums">
              {horaDaLista(conversation.last_message_at)}
            </span>
          </div>
          <p className="text-xs text-slate-500 truncate mt-0.5">
            {listDirection === 'out' && <span className="text-slate-400">Rica: </span>}
            {preview}
          </p>
          <div className="flex items-center gap-2 mt-1">
            {conversation.owner_name && (
              <span className="text-[10px] text-slate-400 truncate flex items-center gap-1">
                <User className="h-3 w-3" />
                {conversation.owner_name}
              </span>
            )}
            {conversation.message_count > 0 && (
              // Total de mensagens da conversa -- NAO e "nao lidas". Ninguem
              // rastreia leitura por usuario aqui, entao nada de badge colorida:
              // pintar de verde faria a equipe ler como pendencia.
              <span
                className="text-[10px] text-slate-400 ml-auto shrink-0 tabular-nums"
                title={`${conversation.message_count} mensagens nesta conversa`}
              >
                {conversation.message_count}
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  )
}

function MessageBubble({ message, leadName }: { message: ConversationMessage; leadName: string }) {
  const fromLead = isFromLead(message)
  const isFollowup = resolveSender(message) === 'system_followup'
  const aproximado = isApproximateTime(message)
  return (
    <div className={cn('flex', fromLead ? 'justify-start' : 'justify-end')}>
      <div
        className={cn(
          'max-w-[80%] rounded-2xl px-4 py-2.5 text-sm shadow-sm',
          fromLead
            ? 'bg-white border border-slate-200 text-slate-700 rounded-tl-sm'
            : isFollowup
            ? 'bg-violet-100 border border-violet-200 text-violet-900 rounded-tr-sm'
            : 'bg-indigo-600 text-white rounded-tr-sm'
        )}
      >
        <p className={cn('text-[10px] font-semibold mb-1', fromLead || isFollowup ? 'text-slate-400' : 'opacity-70')}>
          {senderLabel(message, leadName)}
        </p>
        {message.text && <p className="whitespace-pre-wrap break-words">{message.text}</p>}
        {message.media_url && (
          <a
            href={message.media_url}
            target="_blank"
            rel="noreferrer"
            className="text-xs underline break-all"
          >
            {message.media_type || 'anexo'}
          </a>
        )}
        <p
          className={cn('text-[10px] mt-1', fromLead || isFollowup ? 'text-slate-400' : 'opacity-60')}
          title={aproximado ? 'Horario estimado: a origem desta mensagem nao guardou data' : undefined}
        >
          {aproximado && '~'}
          {formatTime(message.sent_at || message.created_at)}
        </p>
      </div>
    </div>
  )
}

function Thread({ conversation, onBack }: { conversation: Conversation; onBack: () => void }) {
  const visible = usePageVisible()
  const scrollRef = useRef<HTMLDivElement>(null)

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['crm-conversation-messages', conversation.phone],
    queryFn: () => crmApi.conversations.messages(conversation.phone, { limit: THREAD_LIMIT }),
    refetchInterval: visible ? THREAD_REFETCH_MS : false,
    refetchIntervalInBackground: false,
  })

  const messages = useMemo(() => data?.messages ?? [], [data])
  const temAproximado = useMemo(() => messages.some(isApproximateTime), [messages])
  const leadName = conversation.contact_name?.trim() || 'Lead'
  const waPhone = digitsOnly(conversation.phone)

  // Rolagem comeca (e permanece) na mensagem mais recente
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, conversation.phone])

  return (
    <div className="flex flex-col h-full min-h-0 w-full">
      <div className="flex items-start gap-3 border-b px-4 py-3 bg-white">
        <Button variant="ghost" size="icon" className="md:hidden shrink-0" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-800 truncate">{conversationLabel(conversation)}</p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-0.5">
            {waPhone ? (
              <a
                href={`https://wa.me/${waPhone}`}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-emerald-600 hover:underline inline-flex items-center gap-1"
              >
                <Phone className="h-3 w-3" />
                {formatPhone(conversation.phone)}
              </a>
            ) : (
              <span className="text-xs text-slate-400">Sem telefone</span>
            )}
            {conversation.deal_id && (
              <Link
                to={`/crm?deal=${conversation.deal_id}`}
                className="text-xs text-indigo-600 hover:underline inline-flex items-center gap-1"
              >
                <ExternalLink className="h-3 w-3" />
                {conversation.deal_title?.trim() || 'Ver card do deal'}
              </Link>
            )}
            {conversation.owner_name && (
              <span className="text-xs text-slate-400 inline-flex items-center gap-1">
                <User className="h-3 w-3" />
                {conversation.owner_name}
              </span>
            )}
          </div>
        </div>
      </div>

      {temAproximado && (
        <p className="border-b bg-amber-50 px-4 py-1.5 text-[11px] text-amber-800">
          Conversa importada do histórico: os horários com <span className="font-semibold">~</span> são
          estimados. A ordem das mensagens está correta.
        </p>
      )}

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-3 bg-slate-50">
        {isLoading ? (
          <LoadingSpinner />
        ) : isError ? (
          <ErrorState message={error instanceof Error ? error.message : 'Não foi possível carregar a conversa'} />
        ) : messages.length === 0 ? (
          <EmptyState message="Nenhuma mensagem nesta conversa" />
        ) : (
          messages.map((msg, i) => {
            const anterior = i > 0 ? messages[i - 1] : null
            const chave = dayKey(msg.sent_at || msg.created_at)
            const virouDia =
              chave !== '' && chave !== dayKey(anterior ? anterior.sent_at || anterior.created_at : null)
            return (
              <Fragment key={msg.id}>
                {virouDia && (
                  <div className="flex justify-center pt-1">
                    <span className="rounded-full bg-slate-200/80 px-3 py-0.5 text-[10px] font-medium capitalize text-slate-500">
                      {formatDayLabel(msg.sent_at || msg.created_at)}
                    </span>
                  </div>
                )}
                <MessageBubble message={msg} leadName={leadName} />
              </Fragment>
            )
          })
        )}
      </div>
    </div>
  )
}

/** Uma linha do painel lateral. Some sozinha quando nao ha valor. */
function DadoDoContato({ icone: Icone, rotulo, valor }: {
  icone: typeof User
  rotulo: string
  /** unknown de propósito: a API manda jsonb (array), number e null por aqui. */
  valor: unknown
}) {
  const v = textoDe(valor)
  if (!v) return null
  return (
    <div className="flex gap-2 py-1.5">
      <Icone className="h-3.5 w-3.5 text-slate-400 shrink-0 mt-0.5" />
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-wide text-slate-400">{rotulo}</p>
        <p className="text-xs text-slate-700 break-words">{v}</p>
      </div>
    </div>
  )
}

/**
 * Painel lateral com o cadastro do contato, no espirito do inbox do MVF.
 *
 * Busca sob demanda (so quando ha conversa aberta) e SEM polling: cadastro nao
 * muda a cada segundo, e a lista + thread ja batem no banco a cada 8-10s.
 */
function ContactPanel({ conversation }: { conversation: Conversation }) {
  const { data, isLoading } = useQuery({
    queryKey: ['crm-contact-by-phone', conversation.phone],
    queryFn: () => crmApi.contacts.byPhone(conversation.phone),
    staleTime: 60_000,
  })

  const contato = data?.contact ?? null
  const nome = nomeUtil(contato?.name) || nomeUtil(conversation.contact_name) || formatPhone(conversation.phone)

  return (
    <div className="hidden lg:flex lg:w-72 lg:shrink-0 border-l flex-col min-h-0 bg-slate-50">
      <div className="p-4 border-b bg-white">
        <div className="flex flex-col items-center text-center gap-2">
          <div
            className={cn(
              'h-14 w-14 rounded-full flex items-center justify-center text-lg font-semibold',
              corAvatar(conversation.phone)
            )}
            aria-hidden
          >
            {iniciaisDe(conversation)}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-800 truncate">{nome}</p>
            <p className="text-xs text-slate-500">{formatPhone(conversation.phone)}</p>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        <p className="text-[10px] uppercase tracking-wide text-slate-400 mb-1">Dados do contato</p>

        {isLoading ? (
          <p className="text-xs text-slate-400 py-2">Carregando…</p>
        ) : (
          <>
            <DadoDoContato icone={Mail} rotulo="E-mail" valor={contato?.email} />
            <DadoDoContato icone={Building2} rotulo="Empresa" valor={contato?.company_name} />
            <DadoDoContato icone={MapPin} rotulo="Cidade" valor={contato?.city} />
            <DadoDoContato icone={MapPin} rotulo="Endereço" valor={contato?.address} />
            <DadoDoContato icone={Tag} rotulo="Origem do lead" valor={contato?.origem_lead} />
            <DadoDoContato icone={Tag} rotulo="Interesses" valor={contato?.interesses} />

            {/* Sem cadastro nenhum: melhor dizer isso do que mostrar um painel vazio */}
            {!contato && (
              <p className="text-xs text-slate-400 py-2">
                Ainda não há cadastro para este telefone.
              </p>
            )}
          </>
        )}

        <div className="mt-4 pt-3 border-t">
          <p className="text-[10px] uppercase tracking-wide text-slate-400 mb-1">Atendimento</p>
          <DadoDoContato icone={User} rotulo="Executivo" valor={conversation.owner_name} />
          <DadoDoContato icone={Tag} rotulo="Funil" valor={conversation.pipeline_name} />
          <DadoDoContato icone={Tag} rotulo="Negócio" valor={conversation.deal_title} />
          <DadoDoContato
            icone={Tag}
            rotulo="Situação"
            valor={conversation.deal_status === 'open' ? 'Em aberto'
              : conversation.deal_status === 'won' ? 'Ganho'
              : conversation.deal_status === 'lost' ? 'Perdido'
              : conversation.deal_status}
          />
          <DadoDoContato
            icone={MessageSquare}
            rotulo="Mensagens"
            valor={conversation.message_count || null}
          />
        </div>

        {conversation.deal_id && (
          <Link
            to={`/crm?deal=${conversation.deal_id}`}
            className="mt-4 inline-flex items-center gap-1 text-xs text-indigo-600 hover:underline"
          >
            <ExternalLink className="h-3 w-3" />
            Abrir no CRM
          </Link>
        )}
      </div>
    </div>
  )
}

export default function Conversas() {
  const visible = usePageVisible()
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounced(search, 300)
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null)

  const {
    data,
    isLoading,
    isError,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['crm-conversations', debouncedSearch],
    queryFn: ({ pageParam }) =>
      crmApi.conversations.list({
        search: debouncedSearch || undefined,
        limit: LIST_PAGE_SIZE,
        offset: pageParam,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const carregadas = allPages.reduce((n, p) => n + p.conversations.length, 0)
      return carregadas < lastPage.total ? carregadas : undefined
    },
    // O polling so roda enquanto houver UMA pagina. Depois de expandir a lista,
    // cada refetch refaria TODAS as paginas carregadas -- e o CTE de conversas e
    // caro. Reordenar a lista debaixo de quem esta rolando tambem seria ruim de
    // usar. Quem expandiu esta olhando historico, nao esperando mensagem nova.
    refetchInterval: query => {
      if (!visible) return false
      return (query.state.data?.pages.length ?? 1) === 1 ? LIST_REFETCH_MS : false
    },
    refetchIntervalInBackground: false,
  })

  const total = data?.pages[0]?.total ?? 0

  // Paginacao por offset numa lista viva: se uma conversa recebe mensagem entre
  // duas paginas, ela sobe no ORDER BY e pode reaparecer. Sem o dedupe isso vira
  // key repetida no React.
  const conversations = useMemo(() => {
    const vistos = new Set<string>()
    const lista: Conversation[] = []
    for (const page of data?.pages ?? []) {
      for (const c of page.conversations) {
        if (vistos.has(c.phone)) continue
        vistos.add(c.phone)
        lista.push(c)
      }
    }
    return lista
  }, [data?.pages])

  const selected = conversations.find(c => c.phone === selectedPhone) ?? null

  return (
    <PageContainer>
      <div className="flex items-center gap-2">
        <MessageSquare className="h-5 w-5 text-indigo-500" />
        <h1 className="text-2xl font-bold">Conversas</h1>
        {data && (
          <span className="text-sm text-muted-foreground">
            {conversations.length < total
              ? `${conversations.length} de ${total} conversa(s)`
              : `${total} conversa(s)`}
          </span>
        )}
      </div>

      <Card className="overflow-hidden h-[calc(100vh-13rem)] min-h-[420px]">
        <div className="flex h-full min-h-0">
          {/* Lista */}
          <div
            className={cn(
              'w-full md:w-80 md:shrink-0 border-r flex-col min-h-0 bg-white',
              selected ? 'hidden md:flex' : 'flex'
            )}
          >
            <div className="p-3 border-b">
              <div className="relative">
                <Search className="h-4 w-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <Input
                  placeholder="Buscar por nome ou telefone..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="pl-8"
                />
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto">
              {isLoading ? (
                <LoadingSpinner />
              ) : isError ? (
                <ErrorState message={error instanceof Error ? error.message : 'Não foi possível carregar as conversas'} />
              ) : conversations.length === 0 ? (
                <EmptyState message={debouncedSearch ? 'Nenhuma conversa encontrada' : 'Nenhuma conversa ainda'} />
              ) : (
                <>
                  {conversations.map(c => (
                    <ConversationRow
                      key={c.phone}
                      conversation={c}
                      active={c.phone === selectedPhone}
                      onSelect={() => setSelectedPhone(c.phone)}
                    />
                  ))}
                  {hasNextPage && (
                    <div className="p-3">
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full"
                        onClick={() => fetchNextPage()}
                        disabled={isFetchingNextPage}
                      >
                        {isFetchingNextPage
                          ? 'Carregando...'
                          : `Carregar mais (${total - conversations.length} restantes)`}
                      </Button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Thread */}
          <div className={cn('flex-1 min-w-0 min-h-0', selected ? 'flex' : 'hidden md:flex')}>
            {selected ? (
              <Thread
                key={selected.phone}
                conversation={selected}
                onBack={() => setSelectedPhone(null)}
              />
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center gap-2 text-slate-400 bg-slate-50">
                <Bot className="h-8 w-8" />
                <p className="text-sm">Selecione uma conversa para ver as mensagens</p>
              </div>
            )}
          </div>

          {/* Dados do contato — só em telas grandes, para não espremer o thread */}
          {selected && <ContactPanel key={selected.phone} conversation={selected} />}
        </div>
      </Card>
    </PageContainer>
  )
}
