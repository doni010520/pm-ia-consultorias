import { useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'

const API_URL = import.meta.env.VITE_API_URL || ''

export default function ResetPassword() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (password.length < 6) {
      setError('A senha deve ter pelo menos 6 caracteres')
      return
    }

    if (password !== confirmPassword) {
      setError('As senhas nao coincidem')
      return
    }

    setLoading(true)

    try {
      const res = await fetch(`${API_URL}/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error?.message || 'Erro ao redefinir senha')
      }

      setSuccess(true)
      setTimeout(() => navigate('/login'), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao redefinir senha')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: 'linear-gradient(135deg, #1e3a5f 0%, #0f1f33 100%)' }}>
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <img src="/logo.png" alt="PM-IA" className="h-20 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-white">PM-IA</h1>
          <p className="text-sm text-blue-200 mt-1">Nova senha</p>
        </div>

        <div className="rounded-lg border bg-card p-6 shadow-sm space-y-4">
          {success ? (
            <div className="text-center space-y-3">
              <div className="text-4xl">✅</div>
              <h2 className="text-lg font-semibold">Senha redefinida!</h2>
              <p className="text-sm text-muted-foreground">
                Sua senha foi alterada com sucesso. Redirecionando para o login...
              </p>
              <Link
                to="/login"
                className="inline-flex items-center justify-center w-full h-10 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90"
              >
                Ir para login
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
                  {error}
                </div>
              )}

              <div className="space-y-2">
                <label htmlFor="password" className="text-sm font-medium">Nova senha</label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  placeholder="Minimo 6 caracteres"
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
                disabled={loading}
                className="inline-flex items-center justify-center w-full h-10 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
              >
                {loading ? 'Redefinindo...' : 'Redefinir senha'}
              </button>

              <div className="text-center">
                <Link to="/login" className="text-sm text-primary hover:underline">
                  Voltar para login
                </Link>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
