import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RotateCw, Copy, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'

const API_URL = import.meta.env.VITE_API_URL || ''

interface Props {
  children: ReactNode
  /** Rótulo opcional para identificar onde o erro ocorreu (ex: "CRM", "Chat Rica"). */
  label?: string
  /** Fallback customizado. Se ausente, usa o padrão. */
  fallback?: ReactNode
}

interface State {
  error: Error | null
  componentStack: string
  copied: boolean
}

/**
 * Captura erros de renderização em qualquer componente-filho e mostra um
 * fallback amigável em vez de deixar a tela em branco (React 19 desmonta a
 * árvore inteira quando um erro de render não é capturado).
 *
 * Além do fallback, reporta o erro ao backend (/api/client-error) para ficar
 * registrado no log de produção — assim erros intermitentes são diagnosticáveis
 * sem depender do usuário copiar nada.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, componentStack: '', copied: false }

  static getDerivedStateFromError(error: Error): State {
    return { error, componentStack: '', copied: false }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const componentStack = info.componentStack || ''
    this.setState({ componentStack })
    console.error(`[ErrorBoundary${this.props.label ? ` · ${this.props.label}` : ''}]`, error, componentStack)

    // Reporta ao backend (fire-and-forget; nunca quebra se falhar).
    try {
      fetch(`${API_URL}/api/client-error`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: this.props.label || null,
          message: error.message,
          stack: (error.stack || '').slice(0, 2000),
          componentStack: componentStack.slice(0, 2000),
          url: window.location.href,
          userAgent: navigator.userAgent,
          userEmail: (() => { try { const u = JSON.parse(localStorage.getItem('pm-ia-user') || 'null'); return u?.email || null } catch { return null } })(),
          time: new Date().toISOString(),
        }),
        keepalive: true,
      }).catch(() => {})
    } catch { /* ignore */ }
  }

  handleReset = () => {
    this.setState({ error: null, componentStack: '', copied: false })
  }

  handleCopy = () => {
    const { error, componentStack } = this.state
    const details = [
      `Tela: ${this.props.label || '-'}`,
      `URL: ${window.location.href}`,
      `Erro: ${error?.message || '-'}`,
      `Stack: ${error?.stack || '-'}`,
      `Componente: ${componentStack}`,
      `Quando: ${new Date().toISOString()}`,
    ].join('\n')
    navigator.clipboard?.writeText(details).then(
      () => { this.setState({ copied: true }); setTimeout(() => this.setState({ copied: false }), 2500) },
      () => {},
    )
  }

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback

      return (
        <div className="flex flex-col items-center justify-center gap-4 p-8 min-h-[300px] text-center">
          <div className="h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center">
            <AlertTriangle className="h-6 w-6 text-destructive" />
          </div>
          <div className="space-y-1 max-w-lg">
            <h2 className="text-lg font-semibold">Algo deu errado nesta tela</h2>
            <p className="text-sm text-muted-foreground">
              {this.props.label ? `Erro em: ${this.props.label}. ` : ''}
              Você pode tentar recarregar. Se persistir, clique em “Copiar detalhes” e envie ao suporte.
            </p>
            <details className="mt-3 text-left">
              <summary className="text-xs text-muted-foreground cursor-pointer select-none">Detalhes técnicos</summary>
              <pre className="mt-2 text-left text-xs text-muted-foreground bg-muted rounded p-2 overflow-auto max-h-40 whitespace-pre-wrap">
                {this.state.error.message}
                {this.state.componentStack ? `\n${this.state.componentStack.split('\n').slice(0, 6).join('\n')}` : ''}
              </pre>
            </details>
          </div>
          <div className="flex gap-2 flex-wrap justify-center">
            <Button variant="outline" size="sm" onClick={this.handleCopy}>
              {this.state.copied ? <><Check className="h-3.5 w-3.5 mr-1.5" /> Copiado!</> : <><Copy className="h-3.5 w-3.5 mr-1.5" /> Copiar detalhes</>}
            </Button>
            <Button variant="outline" size="sm" onClick={this.handleReset}>
              <RotateCw className="h-3.5 w-3.5 mr-1.5" /> Tentar novamente
            </Button>
            <Button size="sm" onClick={() => window.location.reload()}>
              Recarregar página
            </Button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
