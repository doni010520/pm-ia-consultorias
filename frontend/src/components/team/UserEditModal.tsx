import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { usersApi } from '@/services/api'

interface UserData {
  id: string
  name: string
  email: string
  role: string
  whatsapp?: string | null
  hourly_rate?: number | null
}

interface UserEditModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
  user: UserData | null
}

export function UserEditModal({ open, onOpenChange, onSuccess, user }: UserEditModalProps) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [whatsapp, setWhatsapp] = useState('')
  const [hourlyRate, setHourlyRate] = useState('')
  const [role, setRole] = useState('member')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (open && user) {
      setName(user.name || '')
      setEmail(user.email || '')
      setWhatsapp(user.whatsapp || '')
      setHourlyRate(user.hourly_rate?.toString() || '')
      setRole(user.role || 'member')
      setError('')
    }
  }, [open, user])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!user) return
    setError('')
    setLoading(true)

    try {
      await usersApi.update(user.id, {
        name,
        email,
        whatsapp: whatsapp || null,
        hourly_rate: hourlyRate ? parseFloat(hourlyRate) : null,
        role,
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar Membro</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">{error}</div>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium">Nome</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              required
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              required
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">WhatsApp</label>
            <input
              type="tel"
              value={whatsapp}
              onChange={(e) => setWhatsapp(e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              placeholder="5511999999999"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Cargo</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="member">Membro</option>
                <option value="manager">Gerente</option>
                <option value="admin">Administrador</option>
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Valor/hora (R$)</label>
              <input
                type="number"
                value={hourlyRate}
                onChange={(e) => setHourlyRate(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                step="0.01"
                placeholder="0.00"
              />
            </div>
          </div>

          <Button type="submit" disabled={loading} className="w-full">
            {loading ? 'Salvando...' : 'Salvar'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
