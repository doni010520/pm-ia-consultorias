import { useEffect, useRef, useState } from 'react'
import { useChat } from 'ai/react'
import {
  Sparkles, X, Send, Trash2, Bot, User,
  CheckCircle2, AlertCircle, Loader2, ChevronRight,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { useRicaChatStore } from '@/stores/ricaChatStore'
import { useAuthStore } from '@/stores/authStore'
import { useQueryClient } from '@tanstack/react-query'

const API_URL = import.meta.env.VITE_API_URL || ''

// ─── Tool call chip ──────────────────────────────────────────────────────────

interface ToolInvocation {
  toolCallId: string
  toolName: string
  args: Record<string, unknown>
  state: 'partial-call' | 'call' | 'result'
  result?: {
    status?: string
    description?: string
    message?: string
    error?: string
    [key: string]: unknown
  }
}

function ToolChip({
  invocation,
  onConfirm,
}: {
  invocation: ToolInvocation
  onConfirm: (approved: boolean) => void
}) {
  const { toolName, state, result, args } = invocation

  const label = toolName.replace(/_/g, ' ')

  // Still calling / partial
  if (state !== 'result') {
    return (
      <div className="flex items-center gap-2 text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2 my-1">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-400" />
        <span>Executando: {label}…</span>
      </div>
    )
  }

  // Result: needs_confirmation / preview
  if (result?.status === 'preview') {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 my-2 text-sm">
        <p className="font-medium text-amber-800 mb-2 flex items-center gap-1.5">
          <AlertCircle className="h-4 w-4" />
          Confirmar ação
        </p>
        <p className="text-amber-700 mb-3">{result.description as string}</p>
        <div className="flex gap-2">
          <button
            onClick={() => onConfirm(true)}
            className="flex-1 bg-amber-500 hover:bg-amber-600 text-white rounded-lg py-1.5 text-xs font-semibold transition-colors"
          >
            Sim, pode fazer
          </button>
          <button
            onClick={() => onConfirm(false)}
            className="flex-1 bg-white hover:bg-amber-100 border border-amber-200 text-amber-700 rounded-lg py-1.5 text-xs font-semibold transition-colors"
          >
            Não, cancela
          </button>
        </div>
      </div>
    )
  }

  // Result: done / success
  if (result?.status === 'done') {
    return (
      <div className="flex items-center gap-2 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 my-1">
        <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" />
        <span>{result.message as string || 'Feito!'}</span>
      </div>
    )
  }

  // Result: error
  if (result?.error) {
    return (
      <div className="flex items-center gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 my-1">
        <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
        <span>{result.error as string}</span>
      </div>
    )
  }

  // Result: data (read tool)
  return (
    <div className="flex items-center gap-2 text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2 my-1">
      <ChevronRight className="h-3.5 w-3.5 text-indigo-400" />
      <span className="capitalize">{label} — dados carregados</span>
    </div>
  )
}

// ─── Message bubble ──────────────────────────────────────────────────────────

function MessageBubble({
  message,
  onConfirm,
}: {
  message: ReturnType<typeof useChat>['messages'][0]
  onConfirm: (toolCallId: string, approved: boolean) => void
}) {
  const isUser = message.role === 'user'

  return (
    <div className={`flex gap-2 mb-3 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && (
        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center flex-shrink-0 mt-0.5">
          <Bot className="h-4 w-4 text-white" />
        </div>
      )}

      <div className={`max-w-[85%] ${isUser ? 'items-end' : 'items-start'} flex flex-col`}>
        {/* Tool call chips */}
        {message.toolInvocations?.map((inv) => (
          <ToolChip
            key={inv.toolCallId}
            invocation={inv as ToolInvocation}
            onConfirm={(approved) => onConfirm(inv.toolCallId, approved)}
          />
        ))}

        {/* Text content */}
        {message.content && (
          <div
            className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
              isUser
                ? 'bg-indigo-600 text-white rounded-tr-sm'
                : 'bg-white border border-slate-200 text-slate-800 rounded-tl-sm shadow-sm'
            }`}
          >
            {isUser ? (
              <p>{message.content}</p>
            ) : (
              <ReactMarkdown
                components={{
                  p: ({ children }) => <p className="mb-1 last:mb-0">{children}</p>,
                  ul: ({ children }) => <ul className="list-disc ml-4 mb-1">{children}</ul>,
                  ol: ({ children }) => <ol className="list-decimal ml-4 mb-1">{children}</ol>,
                  li: ({ children }) => <li className="mb-0.5">{children}</li>,
                  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                  code: ({ children }) => (
                    <code className="bg-slate-100 rounded px-1 text-xs font-mono">{children}</code>
                  ),
                }}
              >
                {message.content}
              </ReactMarkdown>
            )}
          </div>
        )}
      </div>

      {isUser && (
        <div className="w-7 h-7 rounded-full bg-slate-200 flex items-center justify-center flex-shrink-0 mt-0.5">
          <User className="h-4 w-4 text-slate-500" />
        </div>
      )}
    </div>
  )
}

// ─── Main widget ─────────────────────────────────────────────────────────────

export function RicaChat() {
  const { isOpen, sessionId, initialMessage, open, close, setSessionId, clearInitialMessage } =
    useRicaChatStore()
  const { token } = useAuthStore()
  const queryClient = useQueryClient()
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [hasNewMessage, setHasNewMessage] = useState(false)

  const {
    messages,
    input,
    setInput,
    handleSubmit,
    isLoading,
    append,
    setMessages,
  } = useChat({
    api: `${API_URL}/api/rica/chat`,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: { session_id: sessionId },
    onResponse: (response) => {
      // Capture session ID from response header
      const newSessionId = response.headers.get('X-Rica-Session-Id')
      if (newSessionId && newSessionId !== sessionId) {
        setSessionId(newSessionId)
      }
    },
    onFinish: () => {
      // Invalidate queries that Rica might have changed
      queryClient.invalidateQueries({ queryKey: ['deals'] })
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
    },
  })

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isLoading])

  // Focus input on open
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 150)
    }
  }, [isOpen])

  // Handle initial message (when opened from elsewhere in the app)
  useEffect(() => {
    if (isOpen && initialMessage) {
      append({ role: 'user', content: initialMessage })
      clearInitialMessage()
    }
  }, [isOpen, initialMessage])

  // Badge animation — show when closed and there are messages
  useEffect(() => {
    if (!isOpen && messages.length > 0) setHasNewMessage(true)
  }, [messages.length, isOpen])

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (input.trim()) handleSubmit(e as unknown as React.FormEvent)
    }
  }

  async function handleConfirm(toolCallId: string, approved: boolean) {
    const confirmText = approved
      ? `Sim, pode executar. (confirmar ação ${toolCallId})`
      : `Não, cancela a ação. (cancelar ${toolCallId})`
    await append({ role: 'user', content: confirmText })
  }

  async function clearHistory() {
    if (!sessionId) return
    try {
      await fetch(`${API_URL}/api/rica/chat/session/${sessionId}`, {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
    } catch { /* ignore */ }
    setMessages([])
  }

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => (isOpen ? close() : open())}
        className={`fixed bottom-5 right-5 z-50 w-14 h-14 rounded-full shadow-lg flex items-center justify-center transition-all duration-300 ${
          isOpen
            ? 'bg-slate-700 hover:bg-slate-800 scale-95'
            : 'bg-gradient-to-br from-indigo-500 to-purple-600 hover:scale-110'
        }`}
        title={isOpen ? 'Fechar Rica' : 'Falar com a Rica'}
      >
        {isOpen ? (
          <X className="h-6 w-6 text-white" />
        ) : (
          <>
            <Sparkles className="h-6 w-6 text-white" />
            {hasNewMessage && (
              <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-amber-400 rounded-full animate-pulse" />
            )}
          </>
        )}
      </button>

      {/* Chat panel */}
      <div
        className={`fixed z-50 flex flex-col transition-all duration-300 shadow-2xl
          ${isOpen ? 'opacity-100 translate-y-0 pointer-events-auto' : 'opacity-0 translate-y-4 pointer-events-none'}
          bottom-24 right-5
          w-[400px] max-w-[calc(100vw-2.5rem)]
          h-[600px] max-h-[calc(100vh-7rem)]
          rounded-2xl overflow-hidden border border-slate-200 bg-white
        `}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 bg-gradient-to-r from-indigo-600 to-purple-600 flex-shrink-0">
          <div className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center">
            <Sparkles className="h-5 w-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white font-semibold text-sm leading-tight">Rica</p>
            <p className="text-indigo-200 text-[10px]">Assistente de IA · CRM & Projetos</p>
          </div>
          <button
            onClick={clearHistory}
            className="text-indigo-200 hover:text-white transition-colors"
            title="Limpar conversa"
          >
            <Trash2 className="h-4 w-4" />
          </button>
          <button
            onClick={close}
            className="text-indigo-200 hover:text-white transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4 bg-slate-50 min-h-0">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center gap-3 pb-8">
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-indigo-100 to-purple-100 flex items-center justify-center">
                <Sparkles className="h-8 w-8 text-indigo-400" />
              </div>
              <div>
                <p className="font-semibold text-slate-700 text-sm">Olá! Sou a Rica.</p>
                <p className="text-slate-500 text-xs mt-1 leading-relaxed max-w-[260px]">
                  Posso buscar leads, mover cards, criar tarefas, consultar atas e muito mais.
                  Como posso ajudar?
                </p>
              </div>
              <div className="flex flex-col gap-2 mt-2 w-full max-w-[280px]">
                {[
                  'Quais leads estão sem responsável?',
                  'Me mostra as tarefas atrasadas',
                  'Busca o lead da empresa X',
                ].map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => {
                      setInput(suggestion)
                      inputRef.current?.focus()
                    }}
                    className="text-left text-xs text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg px-3 py-2 transition-colors border border-indigo-100"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} onConfirm={handleConfirm} />
          ))}

          {isLoading && (
            <div className="flex gap-2 items-center mb-3">
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center flex-shrink-0">
                <Bot className="h-4 w-4 text-white" />
              </div>
              <div className="bg-white border border-slate-200 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm">
                <div className="flex gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-indigo-300 animate-bounce [animation-delay:0ms]" />
                  <span className="w-2 h-2 rounded-full bg-indigo-300 animate-bounce [animation-delay:150ms]" />
                  <span className="w-2 h-2 rounded-full bg-indigo-300 animate-bounce [animation-delay:300ms]" />
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="px-3 py-3 border-t border-slate-200 bg-white flex-shrink-0">
          <form onSubmit={handleSubmit} className="flex gap-2 items-end">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Pergunte ou peça algo à Rica…"
              rows={1}
              className="flex-1 resize-none rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-300 max-h-32 bg-slate-50 placeholder:text-slate-400 transition-all"
              style={{ overflowY: 'auto' }}
              onInput={(e) => {
                const el = e.currentTarget
                el.style.height = 'auto'
                el.style.height = Math.min(el.scrollHeight, 128) + 'px'
              }}
              disabled={isLoading}
            />
            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              className="w-10 h-10 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 text-white flex items-center justify-center transition-colors flex-shrink-0"
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </button>
          </form>
          <p className="text-[10px] text-slate-400 text-center mt-1.5">
            Enter envia · Shift+Enter quebra linha
          </p>
        </div>
      </div>
    </>
  )
}
