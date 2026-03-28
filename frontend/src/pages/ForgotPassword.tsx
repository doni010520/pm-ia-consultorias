import { useState } from 'react'
import { Link } from 'react-router-dom'

const API_URL = import.meta.env.VITE_API_URL || ''

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await fetch(`${API_URL}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error?.message || 'Erro ao enviar email')
      }

      setSent(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao enviar email')
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
          <p className="text-sm text-blue-200 mt-1">Redefinir senha</p>
        </div>

        <div className="rounded-lg border bg-card p-6 shadow-sm space-y-4">
          {sent ? (
            <div className="text-center space-y-3">
              <div className="text-4xl">📧</div>
              <h2 className="text-lg font-semibold">Email enviado!</h2>
              <p className="text-sm text-muted-foreground">
                Se existe uma conta com o email <strong>{email}</strong>, voce recebera um link para redefinir sua senha.
              </p>
              <Link
                to="/login"
                className="inline-flex items-center justify-center w-full h-10 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90"
              >
                Voltar para login
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
                  {error}
                </div>
              )}

              <p className="text-sm text-muted-foreground">
                Digite seu email e enviaremos um link para redefinir sua senha.
              </p>

              <div className="space-y-2">
                <label htmlFor="email" className="text-sm font-medium">Email</label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  placeholder="seu@email.com"
                  required
                  autoFocus
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="inline-flex items-center justify-center w-full h-10 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
              >
                {loading ? 'Enviando...' : 'Enviar link de redefinicao'}
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
