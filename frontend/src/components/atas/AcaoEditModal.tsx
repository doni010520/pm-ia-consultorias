import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { atasApi, usersApi } from '@/services/api'
import type { AtaAcao } from '@/types'

interface AcaoEditModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
  ataId: string
  acao: AtaAcao | null
}

export function AcaoEditModal({ open, onOpenChange, onSuccess, ataId, acao }: AcaoEditModalProps) {
  const [descricao, setDescricao] = useState('')
  const [responsavelNome, setResponsavelNome] = useState('')
  const [responsavelId, setResponsavelId] = useState('')
  const [prazo, setPrazo] = useState('')
  const [tipo, setTipo] = useState('')
  const [evidenciaMinima, setEvidenciaMinima] = useState('')
  const [status, setStatus] = useState('pendente')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [users, setUsers] = useState<{ id: string; name: string }[]>([])

  useEffect(() => {
    if (open) {
      usersApi.list().then((data) => setUsers(data.users)).catch(() => {})
      if (acao) {
        setDescricao(acao.descricao || '')
        setResponsavelNome(acao.responsavel_nome || '')
        setResponsavelId(acao.responsavel_id || '')
        setPrazo(acao.prazo ? acao.prazo.substring(0, 10) : '')
        setTipo(acao.tipo || '')
        setEvidenciaMinima(acao.evidencia_minima || '')
        setStatus(acao.status || 'pendente')
      }
      setError('')
    }
  }, [open, acao])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!acao) return
    setError('')
    setLoading(true)

    try {
      const selectedUser = users.find((u) => u.id === responsavelId)
      await atasApi.updateAcao(ataId, acao.id, {
        descricao,
        responsavel_nome: selectedUser?.name || responsavelNome,
        responsavel_id: responsavelId || null,
        prazo: prazo || null,
        tipo,
        evidencia_minima: evidenciaMinima || null,
        status,
      })
      onSuccess()
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Editar Acao</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">{error}</div>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium">Descricao</label>
            <textarea
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[80px]"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Responsavel</label>
              <select
                value={responsavelId}
                onChange={(e) => setResponsavelId(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">Sem responsavel</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Prazo</label>
              <input
                type="date"
                value={prazo}
                onChange={(e) => setPrazo(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Tipo</label>
              <input
                type="text"
                value={tipo}
                onChange={(e) => setTipo(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="pendente">Pendente</option>
                <option value="em_andamento">Em andamento</option>
                <option value="concluida">Concluida</option>
                <option value="cancelada">Cancelada</option>
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Evidencia minima</label>
            <input
              type="text"
              value={evidenciaMinima}
              onChange={(e) => setEvidenciaMinima(e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>

          <Button type="submit" disabled={loading} className="w-full">
            {loading ? 'Salvando...' : 'Salvar'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
