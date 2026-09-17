import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./database.js', () => ({ query: vi.fn() }))

import { query } from './database.js'
import {
  campanhaDaMensagem,
  resolverCampanha,
  resolverPeriodo,
  perguntaPendente,
  desfechoDoLead,
  ehPerguntaDeRelatorio,
  relatorioCampanhas,
} from './campanhas.js'

// ─── Reconhecimento da campanha ───────────────────────────────────────────────
// Textos EXATOS que chegaram no banco em ago-set/2026.

describe('campanhaDaMensagem', () => {
  it('reconhece a mensagem pronta de cada anúncio', () => {
    expect(campanhaDaMensagem('Oi, quero saber mais sobre a GPS Padaria')).toBe('gps')
    expect(campanhaDaMensagem('Olá! Queria mais informações sobre a JDL Online')).toBe('jornada')
    expect(campanhaDaMensagem('Olá, vim pelo site da JDL online 2026')).toBe('jornada')
    expect(campanhaDaMensagem('Oi, quero saber mais sobre a Mentoria Padaria Lucrativa')).toBe('mentoria')
  })

  it('reconhece com texto extra em volta (legenda de imagem, quebra de linha)', () => {
    expect(campanhaDaMensagem('[Imagem com legenda "Oi, quero saber mais sobre a Mentoria Padaria Lucrativa"]: A imagem mostra')).toBe('mentoria')
    expect(campanhaDaMensagem('Oi, quero saber mais sobre a Mentoria Padaria Lucrativa\nQual o valor?')).toBe('mentoria')
  })

  it('conversa comum NÃO vira campanha', () => {
    expect(campanhaDaMensagem('Olá')).toBeNull()
    expect(campanhaDaMensagem('Qual o valor do curso')).toBeNull()
    expect(campanhaDaMensagem('tenho uma padaria e quero saber do gps')).toBeNull()
  })
})

describe('resolverCampanha', () => {
  it('"Jornada", "JDL" e "Jornada da Lucratividade" são a mesma campanha', () => {
    // Este era o bug: a tool antiga buscava "jornada" e o anúncio diz "JDL" → 0.
    expect(resolverCampanha('Jornada')).toBe('jornada')
    expect(resolverCampanha('JDL')).toBe('jornada')
    expect(resolverCampanha('jornada da lucratividade online')).toBe('jornada')
  })

  it('mentoria coletiva não cai em GPS nem em outra', () => {
    expect(resolverCampanha('mentoria coletiva')).toBe('mentoria')
    expect(resolverCampanha('Mentoria Padaria Lucrativa')).toBe('mentoria')
  })

  it('GPS e desconhecida', () => {
    expect(resolverCampanha('gps')).toBe('gps')
    expect(resolverCampanha('eneagrama')).toBeNull()
  })
})

// ─── Período ──────────────────────────────────────────────────────────────────

describe('resolverPeriodo', () => {
  // 17/09/2026 10:00 em Brasília
  const agora = new Date('2026-09-17T13:00:00Z')

  it('mês passado = agosto inteiro no horário de Brasília', () => {
    const p = resolverPeriodo({ period: 'mes_passado' }, agora)
    expect(p.inicio).toBe('2026-08-01T03:00:00.000Z')
    expect(p.fim).toBe('2026-09-01T03:00:00.000Z')
    expect(p.rotulo).toBe('01/08/2026 a 31/08/2026')
  })

  it('datas explícitas são inclusivas', () => {
    const p = resolverPeriodo({ start_date: '2026-08-01', end_date: '2026-08-31' }, agora)
    expect(p.fim).toBe('2026-09-01T03:00:00.000Z')
    expect(p.rotulo).toBe('01/08/2026 a 31/08/2026')
  })

  it('23h de Brasília ainda é o mesmo dia (não vira o dia seguinte em UTC)', () => {
    const noite = new Date('2026-09-18T01:30:00Z') // 17/09 22:30 em Brasília
    expect(resolverPeriodo({ period: 'hoje' }, noite).rotulo).toBe('17/09/2026')
  })

  it('data mandada dentro de period (erro comum do modelo) vale como data inicial', () => {
    const p = resolverPeriodo({ period: '2026-08-01', end_date: '2026-08-31' }, agora)
    expect(p.rotulo).toBe('01/08/2026 a 31/08/2026')
  })

  it('semana começa na segunda', () => {
    expect(resolverPeriodo({ period: 'semana' }, agora).rotulo).toBe('14/09/2026 a 17/09/2026')
  })
})

// ─── Onde parou ───────────────────────────────────────────────────────────────

describe('perguntaPendente', () => {
  it('classifica as perguntas reais da Rica', () => {
    expect(perguntaPendente('Pra te passar os detalhes, posso começar te perguntando: qual seu nome?')).toBe('nome')
    expect(perguntaPendente('Oi, Regina! Conseguiu pensar no nome da sua padaria? Quero muito conhecer!')).toBe('nome_da_padaria')
    expect(perguntaPendente('Me conta, qual o maior desafio da sua padaria hoje?')).toBe('maior_desafio')
    expect(perguntaPendente('Quer que eu te mande o link para garantir sua vaga?')).toBe('oferta_do_link')
    expect(perguntaPendente('')).toBe('nenhuma')
  })
})

describe('desfechoDoLead', () => {
  const anuncioEm = '2026-09-10T12:00:00Z'
  const agora = new Date('2026-09-17T12:00:00Z')
  const m = (role, content, min) => ({ role, content, occurred_at: new Date(Date.parse(anuncioEm) + min * 60000).toISOString() })

  it('sem nenhuma mensagem da Rica depois do anúncio = sem resposta (falha)', () => {
    const d = desfechoDoLead({ anuncioEm, msgs: [m('cliente', 'Oi, quero saber mais sobre a GPS Padaria', 0)], agora })
    expect(d.etapa).toBe('sem_resposta_da_rica')
    expect(d.rica_respondeu).toBe(false)
  })

  it('só mandou o anúncio e sumiu — parou na pergunta do nome', () => {
    const d = desfechoDoLead({
      anuncioEm, agora,
      msgs: [m('cliente', 'anuncio', 0), m('rica_ai', 'Qual seu nome?', 1), m('system_followup', 'Ficou alguma dúvida?', 120)],
    })
    expect(d.etapa).toBe('so_mensagem_do_anuncio')
    expect(d.pergunta_pendente).toBe('nome')
  })

  it('follow-up não conta como "pergunta pendente" — vale a última fala da Rica', () => {
    const d = desfechoDoLead({
      anuncioEm, agora,
      msgs: [m('cliente', 'anuncio', 0), m('rica_ai', 'Qual o nome da sua padaria?', 1), m('system_followup', 'Oi! Conseguiu pensar no seu nome?', 200)],
    })
    expect(d.pergunta_pendente).toBe('nome_da_padaria')
  })

  it('transferência vence as demais etapas', () => {
    const d = desfechoDoLead({
      anuncioEm, agora,
      msgs: [m('cliente', 'anuncio', 0), m('rica_ai', 'Qual seu nome?', 1), m('cliente', 'Ana', 3), m('rica_ai', 'Passei pro André', 4)],
      transferencia: { executivo: 'André Augusto' },
    })
    expect(d.etapa).toBe('transferido')
    expect(d.executivo).toBe('André Augusto')
  })

  it('link de compra enviado', () => {
    const d = desfechoDoLead({
      anuncioEm, agora,
      msgs: [m('cliente', 'anuncio', 0), m('rica_ai', 'Aqui está: https://curso.sucessonoresultado.com.br', 1)],
    })
    expect(d.etapa).toBe('recebeu_link')
  })

  it('conversa das últimas 24h ainda está em andamento, não parada', () => {
    const d = desfechoDoLead({
      anuncioEm, agora: new Date(Date.parse(anuncioEm) + 3 * 3600000),
      msgs: [m('cliente', 'anuncio', 0), m('rica_ai', 'Qual seu nome?', 1)],
    })
    expect(d.etapa).toBe('em_andamento')
  })
})

describe('ehPerguntaDeRelatorio', () => {
  it('pergunta de número não recebe a ficha de produto forçada', () => {
    expect(ehPerguntaDeRelatorio('quantos leads da jornada chegaram em agosto?')).toBe(true)
    expect(ehPerguntaDeRelatorio('onde os leads do GPS param?')).toBe(true)
    expect(ehPerguntaDeRelatorio('quantas pessoas vieram do anúncio da mentoria')).toBe(true)
  })

  it('pergunta de produto continua recebendo a ficha', () => {
    expect(ehPerguntaDeRelatorio('quanto custa a jornada online?')).toBe(false)
    expect(ehPerguntaDeRelatorio('quantas horas de conteúdo tem a jornada?')).toBe(false)
    expect(ehPerguntaDeRelatorio('me fala do GPS')).toBe(false)
  })
})

// ─── Relatório completo (banco mockado) ───────────────────────────────────────

describe('relatorioCampanhas', () => {
  const ORG = 'org-aaa'
  const periodo = { inicio: '2026-08-01T03:00:00.000Z', fim: '2026-09-01T03:00:00.000Z', rotulo: '01/08/2026 a 31/08/2026' }
  const agora = new Date('2026-09-17T12:00:00Z')
  const t = (dia, h = 12, min = 0) => `2026-08-${String(dia).padStart(2, '0')}T${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:00.000Z`

  beforeEach(() => vi.clearAllMocks())

  function mockBanco({ time = [], anuncios = [], msgs = [], avisos = [], donos = [], primeiras = [] }) {
    query.mockImplementation(async (sql) => {
      if (sql.includes('FROM users')) return { rows: time }
      if (sql.includes('ILIKE ANY($4)')) return { rows: anuncios }
      if (sql.includes('FROM rica_mensagens_enviadas')) return { rows: avisos }
      if (sql.includes('FROM deals d')) return { rows: donos }
      if (sql.includes('WITH primeira')) return { rows: primeiras }
      if (sql.includes('FROM deal_messages')) return { rows: msgs }
      throw new Error('consulta inesperada: ' + sql.slice(0, 80))
    })
  }

  it('conta quem VOLTOU pelo anúncio e separa as etapas', async () => {
    const GPS = 'Oi, quero saber mais sobre a GPS Padaria'
    mockBanco({
      time: [{ k: '99536910' }],
      anuncios: [
        { k: '11111111', content: GPS, occurred_at: t(5) },
        { k: '11111111', content: GPS, occurred_at: t(6) }, // mesma pessoa de novo: conta 1
        { k: '22222222', content: GPS, occurred_at: t(7) }, // contato antigo que voltou
        { k: '33333333', content: GPS, occurred_at: t(8) },
        { k: '99536910', content: GPS, occurred_at: t(9) }, // Malu testando: fora
        { k: '44444444', content: 'Olá! Queria mais informações sobre a JDL Online', occurred_at: t(10) },
      ],
      msgs: [
        { k: '11111111', role: 'cliente', content: GPS, occurred_at: t(5) },
        { k: '11111111', role: 'rica_ai', content: 'Qual seu nome?', occurred_at: t(5, 12, 1) },
        { k: '11111111', role: 'cliente', content: 'Ana', occurred_at: t(5, 12, 3) },
        { k: '11111111', role: 'rica_ai', content: 'Passei pro André', occurred_at: t(5, 12, 4) },
        { k: '22222222', role: 'cliente', content: GPS, occurred_at: t(7) },
        { k: '22222222', role: 'rica_ai', content: 'Qual o nome da sua padaria?', occurred_at: t(7, 12, 1) },
        { k: '33333333', role: 'cliente', content: GPS, occurred_at: t(8) },
        { k: '44444444', role: 'cliente', content: 'x', occurred_at: t(10) },
        { k: '44444444', role: 'rica_ai', content: 'https://curso.sucessonoresultado.com.br', occurred_at: t(10, 12, 1) },
      ],
      avisos: [{ k: '11111111', to_name: 'André Augusto', created_at: t(5, 12, 4) }],
      primeiras: [
        { k: '55555555', primeira_mensagem: 'Olá' },
        { k: '11111111', primeira_mensagem: GPS },
      ],
    })

    const r = await relatorioCampanhas({ orgId: ORG, periodo, agora })

    expect(r.periodo).toBe('01/08/2026 a 31/08/2026')
    const gps = r.campanhas.find((c) => c.campanha === 'GPS Padaria')
    expect(gps.chegaram).toBe(3)
    expect(gps.rica_respondeu).toBe(2)
    expect(gps.rica_nao_respondeu).toBe(1)
    expect(gps.transferidos_para_executivo).toBe(1)
    expect(gps.transferidos_por_executivo).toEqual({ 'André Augusto': 1 })
    expect(gps.pararam_sem_responder_a_rica.total).toBe(1)
    expect(gps.pararam_sem_responder_a_rica.onde).toEqual({ 'pararam quando a Rica pediu o NOME DA PADARIA': 1 })

    const jdl = r.campanhas.find((c) => c.campanha.startsWith('Jornada'))
    expect(jdl.chegaram).toBe(1)
    expect(jdl.receberam_link_de_compra).toBe(1)

    expect(r.sem_campanha.total).toBe(1)
    expect(r.sem_campanha.exemplos).toEqual(['Olá'])
  })

  it('transferência ANTERIOR ao anúncio não conta', async () => {
    const GPS = 'Oi, quero saber mais sobre a GPS Padaria'
    mockBanco({
      anuncios: [{ k: '11111111', content: GPS, occurred_at: t(20) }],
      msgs: [
        { k: '11111111', role: 'cliente', content: GPS, occurred_at: t(20) },
        { k: '11111111', role: 'rica_ai', content: 'Qual seu nome?', occurred_at: t(20, 12, 1) },
      ],
      avisos: [{ k: '11111111', to_name: 'Patrícia Alves', created_at: t(2) }],
    })
    const r = await relatorioCampanhas({ orgId: ORG, campanha: 'gps', periodo, agora })
    expect(r.campanhas).toHaveLength(1)
    expect(r.campanhas[0].transferidos_para_executivo).toBe(0)
    expect(r.sem_campanha).toBeUndefined()
  })

  it('campanha desconhecida devolve orientação em vez de zero', async () => {
    mockBanco({})
    const r = await relatorioCampanhas({ orgId: ORG, campanha: 'eneagrama', periodo, agora })
    expect(r.erro).toMatch(/Não conheço/)
    expect(query).not.toHaveBeenCalled()
  })

  it('lista nominal de quem parou', async () => {
    const MENT = 'Oi, quero saber mais sobre a Mentoria Padaria Lucrativa'
    mockBanco({
      anuncios: [{ k: '11111111', content: MENT, occurred_at: t(20) }],
      msgs: [
        { k: '11111111', role: 'cliente', content: MENT, occurred_at: t(20) },
        { k: '11111111', role: 'rica_ai', content: 'Qual o maior desafio da sua padaria?', occurred_at: t(20, 12, 1) },
      ],
      donos: [{ k: '11111111', nome: 'Pedro', dono: null, assigned_at: null }],
    })
    const r = await relatorioCampanhas({ orgId: ORG, campanha: 'mentoria coletiva', periodo, agora, listar: 'pararam' })
    expect(r.campanhas[0].lista).toEqual([
      expect.objectContaining({ nome: 'Pedro', etapa: 'so_mensagem_do_anuncio', onde_parou: 'pararam quando a Rica perguntou o MAIOR DESAFIO' }),
    ])
  })
})
