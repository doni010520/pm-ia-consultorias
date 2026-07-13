import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Props {
  children: ReactNode
  /** Rótulo opcional para identificar onde o erro ocorreu (ex: "CRM", "Chat Rica"). */
  label?: string
  /** Fallback customizado. Se ausente, usa o padrão. */
  fallback?: ReactNode
}

interface State {
  error: Error | null
}

/**
 * Captura erros de renderização em qualquer componente-filho e mostra um
 * fallback amigável em vez de deixar a tela em branco (React 19 desmonta a
 * árvore inteira quando um erro de render não é capturado).
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Log para o console — facilita debug em produção via DevTools.
    console.error(`[ErrorBoundary${this.props.label ? ` · ${this.props.label}` : ''}]`, error, info.componentStack)
  }

  handleReset = () => {
    this.setState({ error: null })
  }

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback

      return (
        <div className="flex flex-col items-center justify-center gap-4 p-8 min-h-[300px] text-center">
          <div className="h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center">
            <AlertTriangle className="h-6 w-6 text-destructive" />
          </div>
          <div className="space-y-1 max-w-md">
            <h2 className="text-lg font-semibold">Algo deu errado nesta tela</h2>
            <p className="text-sm text-muted-foreground">
              {this.props.label ? `Erro em: ${this.props.label}. ` : ''}
              Você pode tentar recarregar. Se persistir, avise o suporte.
            </p>
            {import.meta.env.DEV && (
              <pre className="mt-3 text-left text-xs text-muted-foreground bg-muted rounded p-2 overflow-auto max-h-40 whitespace-pre-wrap">
                {this.state.error.message}
              </pre>
            )}
          </div>
          <div className="flex gap-2">
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
