import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { invitesApi } from '@/services/api'

const roleLabels: Record<string, string> = {
  admin: 'Administrador',
  manager: 'Gerente',
  member: 'Membro',
}

export default function InviteAccept() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()

  const [invite, setInvite] = useState<{ name: string; email: string; role: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    if (!token) return
    invitesApi.verify(token)
      .then((data) => {
        if (data.valid && data.invite) {
          setInvite(data.invite)
        } else {
          setError(data.reason || 'Convite inválido')
        }
      })
      .catch(() => setError('Erro ao verificar convite'))
      .finally(() => setLoading(false))
  }, [token])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (password.length < 6) {
      setError('A senha deve ter pelo menos 6 caracteres')
      return
    }

    if (password !== confirmPassword) {
      setError('As senhas não coincidem')
      return
    }

    setSubmitting(true)
    try {
      await invitesApi.accept(token!, password)
      setSuccess(true)
      setTimeout(() => navigate('/login'), 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao criar conta')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: 'linear-gradient(135deg, #1e3a5f 0%, #0f1f33 100%)' }}>
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <img src="/logo.png" alt="PM-IA" className="h-20 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-white">PM-IA</h1>
          <p className="text-sm text-blue-200 mt-1">Gestão de Projetos com IA</p>
        </div>

        <div className="rounded-lg border bg-card p-6 shadow-sm">
          {loading && (
            <p className="text-center text-muted-foreground">Verificando convite...</p>
          )}

          {!loading && error && !invite && (
            <div className="text-center space-y-4">
              <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
                {error}
              </div>
              <a href="/login" className="text-sm text-primary hover:underline">
                Ir para o login
              </a>
            </div>
          )}

          {success && (
            <div className="text-center space-y-4">
              <div className="rounded-md bg-green-50 border border-green-200 p-4">
                <p className="text-green-800 font-medium">Conta criada com sucesso!</p>
                <p className="text-green-600 text-sm mt-1">Redirecionando para o login...</p>
              </div>
            </div>
          )}

          {!loading && invite && !success && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="text-center pb-2">
                <h2 className="text-lg font-semibold">Bem-vindo(a), {invite.name}!</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Cargo: <span className="font-medium">{roleLabels[invite.role] || invite.role}</span>
                </p>
              </div>

              {error && (
                <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
                  {error}
                </div>
              )}

              <div className="space-y-2">
                <label className="text-sm font-medium">Email</label>
                <input
                  type="email"
                  value={invite.email}
                  disabled
                  className="flex h-10 w-full rounded-md border border-input bg-muted px-3 py-2 text-sm opacity-70"
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="password" className="text-sm font-medium">Senha</label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  placeholder="Mínimo 6 caracteres"
                  required
                  autoFocus
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="confirm" className="text-sm font-medium">Confirmar senha</label>
                <input
                  id="confirm"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  placeholder="Repita a senha"
                  required
                />
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="inline-flex items-center justify-center w-full h-10 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
              >
                {submitting ? 'Criando conta...' : 'Criar conta e entrar'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
