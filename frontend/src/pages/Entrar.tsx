import { useEffect } from 'react'

/**
 * Link de acesso direto: /entrar#t=<jwt>&para=/comercial
 * O token vai no fragmento (#), que o navegador não envia ao servidor, e sai da
 * barra de endereço antes do redirecionamento. Recarrega a página para o
 * authStore validar o token em /api/auth/me como num login normal.
 */
export default function Entrar() {
  useEffect(() => {
    const p = new URLSearchParams(window.location.hash.slice(1))
    const token = p.get('t')
    const para = p.get('para') || '/'
    window.history.replaceState(null, '', '/entrar')
    if (token) localStorage.setItem('pm-ia-token', token)
    window.location.replace(para.startsWith('/') && !para.startsWith('//') ? para : '/')
  }, [])
  return null
}
