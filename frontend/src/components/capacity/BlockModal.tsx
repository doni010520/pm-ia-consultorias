import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { capacityApi, usersApi } from '@/services/api'
import type { ConsultantBlock } from '@/types'

interface BlockModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
  editBlock?: ConsultantBlock | null
  preselectedUserId?: string
}

const BLOCK_TYPES = [
  { value: 'vacation', label: 'Ferias' },
  { value: 'leave', label: 'Licenca' },
  { value: 'holiday', label: 'Feriado' },
  { value: 'training', label: 'Treinamento' },
  { value: 'other', label: 'Outro' },
]

export function BlockModal({ open, onOpenChange, onSuccess, editBlock, preselectedUserId }: BlockModalProps) {
  const [userId, setUserId] = useState(preselectedUserId || '')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [reason, setReason] = useState('')
  const [blockType, setBlockType] = useState('vacation')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [users, setUsers] = useState<{ id: string; name: string }[]>([])

  useEffect(() => {
    if (open) {
      usersApi.list().then((data) => setUsers(data.users)).catch(() => {})
      if (editBlock) {
        setUserId(editBlock.user_id)
        setStartDate(editBlock.start_date.substring(0, 10))
        setEndDate(editBlock.end_date.substring(0, 10))
        setReason(editBlock.reason || '')
        setBlockType(editBlock.block_type)
      } else {
        setUserId(preselectedUserId || '')
        setStartDate('')
        setEndDate('')
        setReason('')
        setBlockType('vacation')
      }
      setError('')
    }
  }, [open, editBlock, preselectedUserId])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      if (editBlock) {
        await capacityApi.blocks.update(editBlock.id, { start_date: startDate, end_date: endDate, reason, block_type: blockType })
      } else {
        await capacityApi.blocks.create({ user_id: userId, start_date: startDate, end_date: endDate, reason, block_type: blockType })
      }
      onSuccess()
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar bloqueio')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editBlock ? 'Editar Bloqueio' : 'Novo Bloqueio'}</DialogTitle>
          <DialogDescription>
            Marque periodos de indisponibilidade (ferias, licenca, etc.)
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {!editBlock && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Consultor</label>
              <select
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                required
              >
                <option value="">Selecione...</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </div>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium">Tipo</label>
            <select
              value={blockType}
              onChange={(e) => setBlockType(e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              {BLOCK_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Data inicio</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                required
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Data fim</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Motivo (opcional)</label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              placeholder="Ex: Ferias de julho"
            />
          </div>

          <Button type="submit" disabled={loading} className="w-full">
            {loading ? 'Salvando...' : editBlock ? 'Salvar' : 'Criar Bloqueio'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
