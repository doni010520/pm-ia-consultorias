import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mocks devem ser declarados antes do import do modulo testado.
vi.mock('../services/database.js', () => ({
  query: vi.fn(),
  createTask: vi.fn(),
  getTasks: vi.fn(),
}))
vi.mock('../services/leadJourney.js', () => ({ recordEvent: vi.fn(() => Promise.resolve()) }))
vi.mock('../services/dealAudit.js', () => ({ record: vi.fn(() => Promise.resolve()) }))
vi.mock('../services/googleCalendar.js', () => ({}))

import router from './crm.js'
import { query } from '../services/database.js'

const ORG = 'org-aaa'
const REQ_USER = { id: 'user-111', organization_id: ORG, role: 'admin' }

/** Localiza o handler registrado no router para um path/metodo. */
function handlerFor(path, method = 'get') {
  const layer = router.stack.find(
    (l) => l.route && l.route.path === path && l.route.methods[method]
  )
  if (!layer) throw new Error(`rota nao encontrada: ${method.toUpperCase()} ${path}`)
  const stack = layer.route.stack
  return stack[stack.length - 1].handle
}

/** Invoca um handler express com req/res falsos e devolve o corpo da resposta. */
async function invoke(handler, req = {}) {
  let body
  const res = {
    statusCode: 200,
    json(payload) { body = payload; return res },
    status(code) { res.statusCode = code; return res },
  }
  const next = (err) => { if (err) throw err }
  await handler({ query: {}, params: {}, body: {}, user: REQ_USER, ...req }, res, next)
  return { body, statusCode: res.statusCode }
}

/** Ultimo SQL passado para query(), com espacos normalizados. */
function lastSql() {
  return query.mock.calls[query.mock.calls.length - 1][0].replace(/\s+/g, ' ')
}
function lastParams() {
  return query.mock.calls[query.mock.calls.length - 1][1]
}

// O banco devolve as MAIS RECENTES primeiro (ORDER BY occurred_at DESC).
const ROWS_DESC = [
  { id: 'm3', text: 'terceira', sent_at: '2026-08-26T12:00:02.000Z' },
  { id: 'm2', text: 'segunda', sent_at: '2026-08-26T12:00:01.000Z' },
  { id: 'm1', text: 'primeira', sent_at: '2026-08-26T12:00:00.000Z' },
]

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /contacts/by-phone/:phone/messages', () => {
  const handler = () => handlerFor('/contacts/by-phone/:phone/messages')

  it('consulta as mensagens mais RECENTES (DESC) e responde em ordem crescente', async () => {
    query.mockResolvedValueOnce({ rows: ROWS_DESC })
    const { body } = await invoke(handler(), { params: { phone: '5511987654321' } })

    // A consulta corta o lado ANTIGO da conversa...
    expect(lastSql()).toContain('ORDER BY dm.occurred_at DESC, dm.id DESC')
    // ...e a resposta chega ao cliente em ordem cronologica CRESCENTE.
    expect(body.messages.map((m) => m.id)).toEqual(['m1', 'm2', 'm3'])
    expect(body.total).toBe(3)
  })

  it('nao muta o array vindo do banco', async () => {
    const rows = [...ROWS_DESC]
    query.mockResolvedValueOnce({ rows })
    await invoke(handler(), { params: { phone: '5511987654321' } })
    expect(rows.map((m) => m.id)).toEqual(['m3', 'm2', 'm1'])
  })

  it('normaliza o telefone e aplica limit/offset', async () => {
    query.mockResolvedValueOnce({ rows: [] })
    await invoke(handler(), {
      params: { phone: '+55 (11) 98765-4321' },
      query: { limit: '50', offset: '10' },
    })
    expect(lastParams()).toEqual([ORG, '5511987654321', 50, 10])
    expect(lastSql()).toContain('LIMIT $3 OFFSET $4')
  })

  it('limit respeita o teto de 1000 e o piso de 1', async () => {
    query.mockResolvedValueOnce({ rows: [] })
    await invoke(handler(), { params: { phone: '11' }, query: { limit: '99999' } })
    expect(lastParams()[2]).toBe(1000)

    query.mockResolvedValueOnce({ rows: [] })
    await invoke(handler(), { params: { phone: '11' }, query: { limit: '-5' } })
    expect(lastParams()[2]).toBe(1)
  })

  it('cursor `before` pagina para tras (mensagens mais antigas)', async () => {
    query.mockResolvedValueOnce({ rows: ROWS_DESC })
    await invoke(handler(), {
      params: { phone: '11' },
      query: { before: '2026-08-26T12:00:03.000Z' },
    })
    expect(lastSql()).toContain('AND dm.occurred_at < $3::timestamptz')
    expect(lastSql()).toContain('ORDER BY dm.occurred_at DESC, dm.id DESC')
  })

  it('devolve direction/sender com fallback por role', async () => {
    query.mockResolvedValueOnce({ rows: [] })
    await invoke(handler(), { params: { phone: '11' } })
    const sql = lastSql()
    expect(sql).toContain("COALESCE( dm.metadata->>'direction'")
    expect(sql).toContain("WHEN dm.role IN ('client', 'lead', 'cliente') THEN 'in'")
    expect(sql).toContain("THEN 'out'")
    expect(sql).toContain("COALESCE(dm.metadata->>'sender', dm.role) as sender")
  })

  it('conversa vazia devolve lista vazia', async () => {
    query.mockResolvedValueOnce({ rows: [] })
    const { body } = await invoke(handler(), { params: { phone: '11' } })
    expect(body).toEqual({ messages: [], total: 0 })
  })
})

describe('GET /deals/:id/messages', () => {
  const handler = () => handlerFor('/deals/:id/messages')

  it('consulta DESC e responde em ordem crescente (aba "Conversa Rica")', async () => {
    query.mockResolvedValueOnce({ rows: ROWS_DESC })
    const { body } = await invoke(handler(), { params: { id: 'deal-1' } })
    expect(lastSql()).toContain('ORDER BY dm.occurred_at DESC, dm.id DESC')
    expect(body.messages.map((m) => m.id)).toEqual(['m1', 'm2', 'm3'])
    expect(body.total).toBe(3)
  })

  it('aplica o fallback de direction/sender', async () => {
    query.mockResolvedValueOnce({ rows: [] })
    await invoke(handler(), { params: { id: 'deal-1' } })
    expect(lastSql()).toContain("COALESCE(dm.metadata->>'sender', dm.role) as sender")
    expect(lastSql()).toContain("WHEN dm.role IN ('client', 'lead', 'cliente') THEN 'in'")
  })
})

describe('GET /conversations', () => {
  const handler = () => handlerFor('/conversations')

  it('ignora mensagens sem rica_session_id (grupo fantasma com phone null)', async () => {
    query.mockResolvedValueOnce({ rows: [] })
    await invoke(handler())
    const sql = lastSql()
    expect(sql).toContain('AND dm.rica_session_id IS NOT NULL')
    expect(sql).toContain("AND dm.rica_session_id <> ''")
  })

  it('agrupa por telefone e aplica o teto de 200 no limit', async () => {
    query.mockResolvedValueOnce({ rows: [] })
    await invoke(handler(), { query: { limit: '5000' } })
    expect(lastSql()).toContain('GROUP BY dm.rica_session_id')
    expect(lastParams()).toEqual([ORG, 200, 0])
  })

  it('deal_messages vazia devolve conversations vazio e total 0', async () => {
    query.mockResolvedValueOnce({ rows: [] })
    const { body } = await invoke(handler())
    expect(body).toEqual({ conversations: [], total: 0 })
  })

  it('remove total_count das linhas e usa como total', async () => {
    query.mockResolvedValueOnce({
      rows: [{ phone: '5511987654321', contact_name: 'Maria', message_count: 34, total_count: 187 }],
    })
    const { body } = await invoke(handler())
    expect(body.total).toBe(187)
    expect(body.conversations[0]).not.toHaveProperty('total_count')
    expect(body.conversations[0].phone).toBe('5511987654321')
  })

  it('member so ve conversas do proprio deal; conversa sem deal fica visivel', async () => {
    query.mockResolvedValueOnce({ rows: [] })
    await invoke(handler(), { user: { ...REQ_USER, role: 'member' } })
    expect(lastSql()).toContain('AND (r.deal_id IS NULL OR r.owner_id = $2)')
    expect(lastParams()[1]).toBe(REQ_USER.id)
  })

  it('admin nao recebe filtro por dono', async () => {
    query.mockResolvedValueOnce({ rows: [] })
    await invoke(handler())
    expect(lastSql()).not.toContain('r.owner_id =')
  })

  it('busca por telefone compara apenas os digitos', async () => {
    query.mockResolvedValueOnce({ rows: [] })
    await invoke(handler(), { query: { search: '(11) 98765' } })
    expect(lastParams()).toEqual([ORG, '%(11) 98765%', '%1198765%', 100, 0])
  })
})
