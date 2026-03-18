import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { invitesApi } from '@/services/api'

interface InviteModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

export function InviteModal({ open, onOpenChange, onSuccess }: InviteModalProps) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('member')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<{ invite_link: string; email_sent: boolean } | null>(null)

  function reset() {
    setName('')
    setEmail('')
    setRole('member')
    setError('')
    setResult(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const data = await invitesApi.create({ name, email, role })
      setResult({ invite_link: data.invite_link, email_sent: data.email_sent })
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao enviar convite')
    } finally {
      setLoading(false)
    }
  }

  function handleClose(open: boolean) {
    if (!open) reset()
    onOpenChange(open)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Convidar Membro</DialogTitle>
          <DialogDescription>
            O convidado receberá um email para criar sua senha e acessar o sistema.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-4">
            <div className="rounded-md bg-green-50 border border-green-200 p-4">
              <p className="text-green-800 font-medium">Convite enviado!</p>
              {!result.email_sent && (
                <p className="text-amber-600 text-sm mt-2">
                  ⚠️ Email não foi enviado (Resend não configurado). Copie o link abaixo e envie manualmente:
                </p>
              )}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Link do convite</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={result.invite_link}
                  readOnly
                  className="flex h-10 w-full rounded-md border border-input bg-muted px-3 py-2 text-xs"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => navigator.clipboard.writeText(result.invite_link)}
                >
                  Copiar
                </Button>
              </div>
            </div>
            <Button onClick={() => handleClose(false)} className="w-full">
              Fechar
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
                {error}
              </div>
            )}

            <div className="space-y-2">
              <label htmlFor="inv-name" className="text-sm font-medium">Nome completo</label>
              <input
                id="inv-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="Ex: Maria Silva"
                required
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="inv-email" className="text-sm font-medium">Email</label>
              <input
                id="inv-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="email@empresa.com"
                required
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="inv-role" className="text-sm font-medium">Cargo</label>
              <select
                id="inv-role"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="member">Membro</option>
                <option value="manager">Gerente</option>
                <option value="admin">Administrador</option>
              </select>
            </div>

            <Button type="submit" disabled={loading} className="w-full">
              {loading ? 'Enviando...' : 'Enviar Convite'}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
