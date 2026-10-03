import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'
import { comercialApi } from '@/services/api'
import { cn } from '@/lib/utils'
import { dinheiro, haQuanto, ultimosMeses } from './formato'

// ─── janelas: metas e RD ─────────────────────────────────────────────────────

type MetaSalva = { executivo: string | null; valor: number }

export function JanelaMetas({ aberta, onClose, mes, executivos }: { aberta: boolean; onClose: () => void; mes: string; executivos: string[] }) {
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

export function JanelaRd({ aberta, onClose, admin }: { aberta: boolean; onClose: () => void; admin: boolean }) {
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
