const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

/** R$ 185.000 */
export const dinheiro = (v: number | null | undefined) => (v === null || v === undefined ? '—' : brl.format(v))

/** R$ 185.000 até 1 milhão; acima, R$ 1,98 mi (cabe no card). */
export function valorCard(v: number | null | undefined) {
  if (v === null || v === undefined) return '—'
  if (Math.abs(v) >= 1_000_000) return `R$ ${(v / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} mi`
  return brl.format(v)
}

/** Valor em milhares para eixos e rótulos de gráfico ("R$ mil"). */
export const mil = (v: number) => Math.round(v / 1000).toLocaleString('pt-BR')

export const pct = (v: number | null | undefined, casas = 1) =>
  v === null || v === undefined ? '—' : `${(v * 100).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`

export const vezes = (v: number | null | undefined) =>
  v === null || v === undefined ? '—' : `${v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}x`

export const NOME_MES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']

export function ultimosMeses(n: number) {
  const hoje = new Date()
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1)
    return {
      valor: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      rotulo: `${NOME_MES[d.getMonth()]}/${d.getFullYear()}`,
    }
  })
}

export function haQuanto(iso: string | null) {
  if (!iso) return 'nunca'
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min} min`
  const h = Math.round(min / 60)
  return h < 24 ? `há ${h} h` : `há ${Math.round(h / 24)} dias`
}
