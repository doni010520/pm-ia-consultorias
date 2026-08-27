/**
 * Simulador de conversa com a Rica.
 *
 * A equipe não consegue se testar como cliente pelo WhatsApp: quem está na lista
 * de proteção do time cai no copiloto, e testar de um número de fora cria lead
 * de verdade no funil. Aqui a conversa roda com o MESMO prompt e o MESMO modelo
 * de produção, mas nada é enviado e nada é gravado.
 */
import { useEffect, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Bot, RotateCcw, Send, ShieldCheck, User, Wrench } from 'lucide-react'
import { PageContainer } from '@/components/layout/PageContainer'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { crmApi } from '@/services/api'
import { cn } from '@/lib/utils'

type Mensagem = { papel: 'lead' | 'rica'; texto: string }
type Chamada = { tool: string; argumentos: unknown; executada: boolean }

const SUGESTOES = [
  'Oi, queria saber sobre a Jornada da Lucratividade',
  'Quanto custa a Jornada Online?',
  'Tenho uma padaria pequena, vale a pena?',
  'Qual o CMV ideal de uma padaria?',
  'Como a reforma tributária afeta a padaria?',
]

export default function SimuladorRica() {
  const [mensagens, setMensagens] = useState<Mensagem[]>([])
  const [rascunho, setRascunho] = useState('')
  const [chamadas, setChamadas] = useState<Chamada[]>([])
  const [erro, setErro] = useState<string | null>(null)
  const fimRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fimRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [mensagens, erro])

  const enviar = useMutation({
    mutationFn: (historico: Mensagem[]) => crmApi.rica.simular({ mensagens: historico }),
    onSuccess: (data) => {
      setMensagens(m => [...m, { papel: 'rica', texto: data.resposta || '(a Rica não respondeu nada)' }])
      // As chamadas são acumuladas: interessa ver tudo que ela fez na conversa.
      setChamadas(c => [...c, ...(data.chamadas ?? [])])
    },
    onError: (e: unknown) => setErro(e instanceof Error ? e.message : 'Falha ao falar com a Rica'),
  })

  function submeter(texto: string) {
    const t = texto.trim()
    if (!t || enviar.isPending) return
    setErro(null)
    const historico: Mensagem[] = [...mensagens, { papel: 'lead', texto: t }]
    setMensagens(historico)
    setRascunho('')
    enviar.mutate(historico)
  }

  function recomecar() {
    setMensagens([])
    setChamadas([])
    setErro(null)
    setRascunho('')
  }

  return (
    <PageContainer>
      <div className="flex items-center gap-2">
        <Bot className="h-5 w-5 text-indigo-500" />
        <h1 className="text-2xl font-bold">Simulador da Rica</h1>
        {mensagens.length > 0 && (
          <Button variant="outline" size="sm" className="ml-auto" onClick={recomecar}>
            <RotateCcw className="h-3.5 w-3.5 mr-1" />
            Recomeçar
          </Button>
        )}
      </div>

      <div className="flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2">
        <ShieldCheck className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
        <p className="text-xs text-emerald-800">
          Converse como se fosse um cliente. É o <strong>mesmo prompt e o mesmo modelo</strong> que
          atendem no WhatsApp — mas nada é enviado, ninguém vira lead e nada aparece em Conversas.
          Se a Rica decidir avisar um executivo, você vê a intenção aqui ao lado sem que a mensagem saia.
        </p>
      </div>

      <div className="flex gap-4 h-[calc(100vh-16rem)] min-h-[420px]">
        <Card className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3 bg-slate-50">
            {mensagens.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center gap-3 text-slate-400">
                <Bot className="h-8 w-8" />
                <p className="text-sm">Comece a conversa como um cliente faria</p>
                <div className="flex flex-wrap justify-center gap-2 max-w-lg">
                  {SUGESTOES.map(s => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => submeter(s)}
                      className="text-xs px-2.5 py-1.5 rounded-full border border-slate-200 bg-white text-slate-600 hover:border-indigo-300 hover:text-indigo-600 transition-colors"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {mensagens.map((m, i) => (
              <div key={i} className={cn('flex', m.papel === 'lead' ? 'justify-end' : 'justify-start')}>
                <div
                  className={cn(
                    'max-w-[75%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap break-words',
                    m.papel === 'lead'
                      ? 'bg-indigo-600 text-white'
                      : 'bg-white border border-slate-200 text-slate-800'
                  )}
                >
                  <div className="flex items-center gap-1 mb-0.5 opacity-70 text-[10px]">
                    {m.papel === 'lead' ? <User className="h-3 w-3" /> : <Bot className="h-3 w-3" />}
                    {m.papel === 'lead' ? 'Você (cliente)' : 'Rica'}
                  </div>
                  {m.texto}
                </div>
              </div>
            ))}

            {enviar.isPending && (
              <div className="flex justify-start">
                <div className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-400">
                  Rica está digitando…
                </div>
              </div>
            )}

            {erro && (
              <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                {erro}
              </div>
            )}

            <div ref={fimRef} />
          </div>

          <form
            className="border-t p-3 flex gap-2 bg-white"
            onSubmit={e => { e.preventDefault(); submeter(rascunho) }}
          >
            <Input
              placeholder="Escreva como um cliente escreveria…"
              value={rascunho}
              onChange={e => setRascunho(e.target.value)}
              disabled={enviar.isPending}
            />
            <Button type="submit" disabled={enviar.isPending || !rascunho.trim()}>
              <Send className="h-4 w-4" />
            </Button>
          </form>
        </Card>

        <Card className="hidden lg:flex lg:w-80 lg:shrink-0 flex-col overflow-hidden">
          <div className="px-4 py-3 border-b">
            <p className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
              <Wrench className="h-4 w-4 text-slate-400" />
              O que a Rica faria
            </p>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Ações que ela tomaria de verdade no WhatsApp
            </p>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
            {chamadas.length === 0 ? (
              <p className="text-xs text-slate-400">
                Nenhuma ação até agora. Se ela decidir encaminhar o lead a um executivo,
                aparece aqui.
              </p>
            ) : (
              chamadas.map((c, i) => (
                <div key={i} className="rounded-md border border-slate-200 p-2.5">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium text-slate-800">{c.tool}</span>
                    <span
                      className={cn(
                        'text-[10px] px-1.5 py-0.5 rounded-full',
                        c.executada
                          ? 'bg-sky-100 text-sky-700'
                          : 'bg-amber-100 text-amber-700'
                      )}
                    >
                      {c.executada ? 'consultou' : 'não executada'}
                    </span>
                  </div>
                  <pre className="mt-1.5 text-[10px] text-slate-600 whitespace-pre-wrap break-words">
                    {JSON.stringify(c.argumentos, null, 2)}
                  </pre>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>
    </PageContainer>
  )
}
