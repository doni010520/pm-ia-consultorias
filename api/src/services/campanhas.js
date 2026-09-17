/**
 * Campanhas de tráfego da Rica — contagem que bate com o painel de anúncios.
 *
 * POR QUE ISTO EXISTE: o Marketing comparava "conversas iniciadas" do tráfego com
 * o que a Rica dizia pelo copiloto e os números nunca batiam (164 x 21 em agosto).
 * Não era perda de lead: era a contagem. As tools antigas identificavam o assunto
 * por palavra solta na PRIMEIRA mensagem de CONTATOS NOVOS — então "Jornada" dava
 * 0 (o anúncio diz "JDL Online") e quem já era contato e voltou pelo anúncio sumia.
 *
 * Aqui a campanha é reconhecida pela MENSAGEM PRONTA do anúncio, em qualquer
 * momento do período, conte a pessoa como nova ou não. Conferido contra o banco
 * em 17/09/2026: GPS ago = 153, GPS set = 67, Jornada set = 29, Mentoria set = 49.
 *
 * Campanha nova com outra mensagem pronta PRECISA entrar em CAMPANHAS — senão
 * os leads dela aparecem em "sem campanha" (aparecem, não somem).
 */

import { query } from './database.js';

// ─── Configuração ────────────────────────────────────────────────────────────

// Padrões SEM acento: o texto do anúncio tem "informações" e o ILIKE não ignora
// acento. Tudo que é trecho distintivo o bastante para não pegar conversa comum.
export const CAMPANHAS = [
  {
    id: 'gps',
    nome: 'GPS Padaria',
    padroes: ['%quero saber mais sobre a gps padaria%'],
    apelidos: ['gps padaria', 'gps'],
  },
  {
    id: 'jornada',
    nome: 'Jornada da Lucratividade Online (JDL)',
    padroes: ['%informa%sobre a jdl online%', '%vim pelo site da jdl%'],
    apelidos: ['jornada', 'jdl', 'lucratividade'],
  },
  {
    id: 'mentoria',
    nome: 'Mentoria Padaria Lucrativa (mentoria coletiva)',
    padroes: ['%quero saber mais sobre a mentoria padaria lucrativa%'],
    apelidos: ['mentoria', 'coletiva', 'padaria lucrativa'],
  },
];

// Transferência de verdade = roteamento automático OU designação manual.
// "Encaminhamos um lead pra você" é a COBRANÇA de 24h e inflava a contagem.
const PADROES_AVISO = ['%NOVO LEAD QUENTINHO%', '%LEAD DESIGNADO%'];

const FUSO = '-03:00'; // Brasil sem horário de verão desde 2019
const EM_ANDAMENTO_HORAS = 24;

// ─── Funções puras (testáveis sem banco) ─────────────────────────────────────

function semAcento(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function likeParaRegex(padrao) {
  const corpo = padrao
    .split('%')
    .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${corpo}$`, 'is');
}

/** Campanha de uma mensagem do cliente, pela mensagem pronta do anúncio. */
export function campanhaDaMensagem(texto) {
  const t = semAcento(texto);
  for (const c of CAMPANHAS) {
    if (c.padroes.some((p) => likeParaRegex(semAcento(p)).test(t))) return c.id;
  }
  return null;
}

/** Nome livre ("jornada", "mentoria coletiva", "GPS") → id da campanha. */
export function resolverCampanha(nome) {
  const t = semAcento(nome).trim();
  if (!t) return null;
  // Mentoria antes de GPS: "mentoria padaria lucrativa" não pode cair em outra.
  const ordem = ['mentoria', 'jornada', 'gps'];
  for (const id of ordem) {
    const c = CAMPANHAS.find((x) => x.id === id);
    if (c.id === t || c.apelidos.some((a) => t.includes(a))) return c.id;
  }
  return null;
}

function dataBR(d) {
  const [y, m, dia] = d.split('-');
  return `${dia}/${m}/${y}`;
}

function isoDia(date) {
  // data no fuso de Brasília
  const local = new Date(date.getTime() - 3 * 3600 * 1000);
  return local.toISOString().slice(0, 10);
}

function somaDias(dia, n) {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Período no fuso de Brasília. Devolve limites em ISO (fim EXCLUSIVO) e o rótulo
 * com as datas reais — a resposta precisa sempre dizer o que foi contado.
 */
export function resolverPeriodo({ period, start_date, end_date } = {}, agora = new Date()) {
  const hoje = isoDia(agora);
  let ini;
  let fimInclusivo;

  if (start_date || end_date) {
    ini = (start_date || end_date).slice(0, 10);
    fimInclusivo = (end_date || hoje).slice(0, 10);
  } else {
    switch (period) {
      case 'hoje': ini = hoje; fimInclusivo = hoje; break;
      case 'ontem': ini = somaDias(hoje, -1); fimInclusivo = ini; break;
      case 'semana': {
        const dow = new Date(`${hoje}T12:00:00Z`).getUTCDay(); // 0=dom
        ini = somaDias(hoje, -((dow + 6) % 7));
        fimInclusivo = hoje;
        break;
      }
      case 'ultimos_7_dias': ini = somaDias(hoje, -6); fimInclusivo = hoje; break;
      case 'ultimos_30_dias': ini = somaDias(hoje, -29); fimInclusivo = hoje; break;
      case 'mes_passado': {
        const primeiroDesteMes = `${hoje.slice(0, 7)}-01`;
        fimInclusivo = somaDias(primeiroDesteMes, -1);
        ini = `${fimInclusivo.slice(0, 7)}-01`;
        break;
      }
      case 'tudo': ini = '2020-01-01'; fimInclusivo = hoje; break;
      case 'mes':
      default: ini = `${hoje.slice(0, 7)}-01`; fimInclusivo = hoje; break;
    }
  }
  if (fimInclusivo < ini) [ini, fimInclusivo] = [fimInclusivo, ini];

  const fimExclusivo = somaDias(fimInclusivo, 1);
  return {
    inicio: new Date(`${ini}T00:00:00${FUSO}`).toISOString(),
    fim: new Date(`${fimExclusivo}T00:00:00${FUSO}`).toISOString(),
    rotulo: ini === fimInclusivo ? dataBR(ini) : `${dataBR(ini)} a ${dataBR(fimInclusivo)}`,
  };
}

/** Pergunta que a Rica deixou pendente na última mensagem dela. */
export function perguntaPendente(texto) {
  const s = semAcento(texto);
  if (!s) return 'nenhuma';
  if (/nome da (sua )?padaria|nome do (seu )?(negocio|estabelecimento|empresa)/.test(s)) return 'nome_da_padaria';
  if (/desafio|dificuldade|o que (voce )?(gostaria|quer) (de )?melhorar/.test(s)) return 'maior_desafio';
  if (/qual (e )?(o )?seu nome|como posso te chamar|seu nome\b|pensar no (seu )?nome|um nome/.test(s)) return 'nome';
  if (/cidade|estado|de onde (voce )?(e|fala)|regiao/.test(s)) return 'cidade';
  if (/link|garantir sua vaga/.test(s)) return 'oferta_do_link';
  return 'outra';
}

const ROTULO_PARADA = {
  nome: 'pararam quando a Rica pediu o NOME',
  nome_da_padaria: 'pararam quando a Rica pediu o NOME DA PADARIA',
  maior_desafio: 'pararam quando a Rica perguntou o MAIOR DESAFIO',
  cidade: 'pararam quando a Rica perguntou CIDADE/ESTADO',
  oferta_do_link: 'pararam quando a Rica ofereceu o LINK de compra',
  outra: 'pararam depois de outra mensagem da Rica',
  nenhuma: 'a Rica não chegou a perguntar nada',
};

const CLIENTE = 'cliente';

/**
 * Desfecho de UMA pessoa a partir da mensagem do anúncio.
 * `msgs` = mensagens dela a partir do anúncio (inclusive), em ordem.
 */
export function desfechoDoLead({ anuncioEm, msgs, transferencia, agora = new Date() }) {
  const depois = msgs.filter((m) => new Date(m.occurred_at) > new Date(anuncioEm));
  const daRica = depois.filter((m) => m.role !== CLIENTE);
  const respostasDoCliente = depois.filter((m) => m.role === CLIENTE).length;
  const falasDaRica = daRica.filter((m) => m.role === 'rica_ai');
  const recebeuLink = falasDaRica.some((m) => /https?:\/\//i.test(m.content || ''));
  const ultima = msgs.length ? new Date(msgs[msgs.length - 1].occurred_at) : new Date(anuncioEm);
  const emAndamento = agora - ultima < EM_ANDAMENTO_HORAS * 3600 * 1000;

  let etapa;
  if (!daRica.length) etapa = 'sem_resposta_da_rica';
  else if (transferencia) etapa = 'transferido';
  else if (recebeuLink) etapa = 'recebeu_link';
  else if (emAndamento) etapa = 'em_andamento';
  else if (!respostasDoCliente) etapa = 'so_mensagem_do_anuncio';
  else etapa = 'conversou_e_parou';

  const ultimaDaRica = falasDaRica.length ? falasDaRica[falasDaRica.length - 1].content : '';
  return {
    etapa,
    rica_respondeu: daRica.length > 0,
    respondeu_a_rica: respostasDoCliente > 0,
    recebeu_link: recebeuLink,
    pergunta_pendente: perguntaPendente(ultimaDaRica),
    executivo: transferencia?.executivo || null,
  };
}

/** Agrega os desfechos de uma campanha no formato que o modelo vai relatar. */
export function resumirCampanha(nome, leads) {
  const conta = (f) => leads.filter(f).length;
  const porExecutivo = {};
  for (const l of leads.filter((x) => x.etapa === 'transferido')) {
    const k = l.executivo || 'não identificado';
    porExecutivo[k] = (porExecutivo[k] || 0) + 1;
  }
  const pararam = {};
  for (const etapa of ['so_mensagem_do_anuncio', 'conversou_e_parou']) {
    const grupo = leads.filter((l) => l.etapa === etapa);
    const motivo = {};
    for (const l of grupo) {
      const r = ROTULO_PARADA[l.pergunta_pendente];
      motivo[r] = (motivo[r] || 0) + 1;
    }
    pararam[etapa] = { total: grupo.length, onde: motivo };
  }
  return {
    campanha: nome,
    chegaram: leads.length,
    rica_respondeu: conta((l) => l.rica_respondeu),
    rica_nao_respondeu: conta((l) => !l.rica_respondeu),
    responderam_a_rica: conta((l) => l.respondeu_a_rica),
    transferidos_para_executivo: conta((l) => l.etapa === 'transferido'),
    transferidos_por_executivo: porExecutivo,
    receberam_link_de_compra: conta((l) => l.recebeu_link),
    em_andamento_ultimas_24h: conta((l) => l.etapa === 'em_andamento'),
    pararam_sem_responder_a_rica: pararam.so_mensagem_do_anuncio,
    conversaram_e_pararam: pararam.conversou_e_parou,
  };
}

/**
 * Pergunta de NÚMERO/RELATÓRIO. Serve para o copiloto não injetar a ficha do
 * produto quando alguém pergunta "quantos leads da Jornada chegaram" — com a
 * ficha forçada no prompt, o modelo descrevia o curso em vez de contar.
 */
export function ehPerguntaDeRelatorio(texto) {
  const s = semAcento(texto);
  // Sem 'quantos' sozinho: 'quantas horas de conteúdo tem a jornada?' é pergunta de produto.
  return /\b(relatorio|metricas?|campanhas?|trafego|anuncios?|leads?|atendimentos?|contatos|conversas|chegaram|chegou|param|pararam|parou|transferid\w*|encaminhad\w*|conversao|funil)\b/.test(s);
}

// ─── Consulta ────────────────────────────────────────────────────────────────

const ETAPAS_LISTAVEIS = ['sem_resposta_da_rica', 'transferido', 'recebeu_link', 'em_andamento', 'so_mensagem_do_anuncio', 'conversou_e_parou'];

export async function relatorioCampanhas({ orgId, campanha, periodo, listar = 'nenhum', limite = 50, agora = new Date() }) {
  const alvo = campanha ? resolverCampanha(campanha) : null;
  if (campanha && !alvo) {
    return {
      erro: `Não conheço a campanha "${campanha}".`,
      campanhas_conhecidas: CAMPANHAS.map((c) => c.nome),
      orientacao: 'Se for uma campanha nova, o texto da mensagem pronta do anúncio precisa ser cadastrado pelo desenvolvedor.',
    };
  }
  const campanhas = alvo ? CAMPANHAS.filter((c) => c.id === alvo) : CAMPANHAS;
  const padroes = campanhas.flatMap((c) => c.padroes);

  const time = await query(
    `SELECT right(regexp_replace(whatsapp,'[^0-9]','','g'),8) AS k FROM users
     WHERE organization_id = $1 AND whatsapp IS NOT NULL`,
    [orgId]
  );
  const doTime = new Set(time.rows.map((r) => r.k));
  for (const f of String(process.env.TEAM_PHONES || '').split(',')) {
    const d = f.replace(/\D/g, '');
    if (d.length >= 8) doTime.add(d.slice(-8));
  }

  const anuncios = await query(
    `SELECT right(rica_session_id,8) AS k, content, occurred_at
     FROM deal_messages
     WHERE organization_id = $1 AND role = 'cliente'
       AND occurred_at >= $2 AND occurred_at < $3
       AND rica_session_id ~ '^[0-9]{10,13}$'
       AND content ILIKE ANY($4)
     ORDER BY occurred_at, id`,
    [orgId, periodo.inicio, periodo.fim, padroes]
  );

  // Primeiro anúncio de cada pessoa, por campanha.
  const primeiro = new Map(); // `${camp}|${k}` → occurred_at
  for (const r of anuncios.rows) {
    if (doTime.has(r.k)) continue;
    const camp = campanhaDaMensagem(r.content);
    if (!camp || (alvo && camp !== alvo)) continue;
    const chave = `${camp}|${r.k}`;
    if (!primeiro.has(chave)) primeiro.set(chave, r.occurred_at);
  }
  const chaves = [...new Set([...primeiro.keys()].map((c) => c.split('|')[1]))];

  const resultado = {
    periodo: periodo.rotulo,
    criterio:
      'Conta PESSOAS que mandaram a mensagem pronta do anúncio no período (horário de Brasília), ' +
      'inclusive quem já era contato e voltou. O desfecho considera a conversa até agora.',
    campanhas: [],
  };

  let msgsPorPessoa = new Map();
  let transfPorPessoa = new Map();
  let nomePorPessoa = new Map();
  const fonePorPessoa = new Map();

  if (chaves.length) {
    const desde = anuncios.rows.length ? anuncios.rows[0].occurred_at : periodo.inicio;
    const msgs = await query(
      `SELECT right(rica_session_id,8) AS k, rica_session_id AS fone, role, content, occurred_at
       FROM deal_messages
       WHERE organization_id = $1 AND right(rica_session_id,8) = ANY($2) AND occurred_at >= $3
       ORDER BY occurred_at, id`,
      [orgId, chaves, desde]
    );
    for (const m of msgs.rows) {
      fonePorPessoa.set(m.k, m.fone);
      if (!msgsPorPessoa.has(m.k)) msgsPorPessoa.set(m.k, []);
      msgsPorPessoa.get(m.k).push(m);
    }

    const avisos = await query(
      `SELECT right(substring(conteudo from 'wa[.]me/([0-9]+)'),8) AS k, to_name, created_at
       FROM rica_mensagens_enviadas
       WHERE categoria = 'equipe' AND created_at >= $1
         AND conteudo ILIKE ANY($2)
         AND right(substring(conteudo from 'wa[.]me/([0-9]+)'),8) = ANY($3)
       ORDER BY created_at`,
      [desde, PADROES_AVISO, chaves]
    );
    for (const a of avisos.rows) {
      if (!transfPorPessoa.has(a.k)) transfPorPessoa.set(a.k, []);
      transfPorPessoa.get(a.k).push({ em: a.created_at, executivo: a.to_name });
    }

    // Designação feita pela Rica nem sempre gera aviso com wa.me: o dono do deal cobre.
    // Só vale com assigned_via (notificar_equipe/designar_lead) — troca manual de dono
    // em massa, como a saída da Patrícia, não é transferência feita pela Rica.
    const donos = await query(
      `SELECT DISTINCT ON (k) k, dono, assigned_at, nome FROM (
         SELECT right(regexp_replace(coalesce(d.contact_phone, d.rica_session_id, ''),'[^0-9]','','g'),8) AS k,
                u.name AS dono, CASE WHEN d.assigned_via IS NOT NULL THEN d.assigned_at END AS assigned_at, NULLIF(btrim(d.contact_name),'') AS nome, d.created_at
         FROM deals d LEFT JOIN users u ON u.id = d.owner_id
         WHERE d.organization_id = $1
       ) x WHERE k = ANY($2)
       ORDER BY k, created_at DESC`,
      [orgId, chaves]
    );
    for (const d of donos.rows) {
      if (d.nome && d.nome !== 'Sem nome' && d.nome !== 'Lead WhatsApp') nomePorPessoa.set(d.k, d.nome);
      if (d.dono && d.assigned_at) {
        if (!transfPorPessoa.has(d.k)) transfPorPessoa.set(d.k, []);
        transfPorPessoa.get(d.k).push({ em: d.assigned_at, executivo: d.dono, viaCrm: true });
      }
    }
  }

  const listas = {};
  for (const c of campanhas) {
    const leads = [];
    for (const [chave, anuncioEm] of primeiro) {
      const [camp, k] = chave.split('|');
      if (camp !== c.id) continue;
      const todas = msgsPorPessoa.get(k) || [];
      const msgs = todas.filter((m) => new Date(m.occurred_at) >= new Date(anuncioEm));
      // Transferência que aconteceu DEPOIS do anúncio (1 min de folga de relógio).
      const t = (transfPorPessoa.get(k) || [])
        .filter((x) => new Date(x.em) >= new Date(new Date(anuncioEm).getTime() - 60000))
        .sort((a, b) => (a.viaCrm === b.viaCrm ? new Date(a.em) - new Date(b.em) : a.viaCrm ? 1 : -1))[0];
      const d = desfechoDoLead({ anuncioEm, msgs, transferencia: t, agora });
      leads.push({ ...d, k, anuncioEm });
    }
    const resumo = resumirCampanha(c.nome, leads);
    if (listar !== 'nenhum') {
      const filtro = listar === 'todos' ? () => true
        : listar === 'pararam' ? (l) => l.etapa === 'so_mensagem_do_anuncio' || l.etapa === 'conversou_e_parou'
        : (l) => l.etapa === listar;
      resumo.lista = leads
        .filter(filtro)
        .slice(0, limite)
        .map((l) => ({
          nome: nomePorPessoa.get(l.k) || '(sem nome)',
          telefone: fonePorPessoa.get(l.k) || l.k,
          chegou_em: new Date(l.anuncioEm).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
          etapa: l.etapa,
          onde_parou: ['so_mensagem_do_anuncio', 'conversou_e_parou'].includes(l.etapa) ? ROTULO_PARADA[l.pergunta_pendente] : undefined,
          executivo: l.executivo || undefined,
        }));
    }
    listas[c.id] = leads;
    resultado.campanhas.push(resumo);
  }

  if (!alvo) {
    // Quem chegou no período SEM a mensagem do anúncio (apagou o texto pronto,
    // escreveu "Olá"...). É onde costuma estar a diferença para o painel de tráfego.
    const semCamp = await query(
      `WITH primeira AS (
         SELECT DISTINCT ON (right(rica_session_id,8)) right(rica_session_id,8) AS k, content, occurred_at
         FROM deal_messages
         WHERE organization_id = $1 AND role = 'cliente' AND rica_session_id ~ '^[0-9]{10,13}$'
         ORDER BY right(rica_session_id,8), occurred_at, id
       )
       SELECT k, left(content, 80) AS primeira_mensagem FROM primeira
       WHERE occurred_at >= $2 AND occurred_at < $3
       ORDER BY occurred_at`,
      [orgId, periodo.inicio, periodo.fim]
    );
    const comCampanha = new Set(chaves);
    const rows = semCamp.rows.filter((r) => !doTime.has(r.k) && !comCampanha.has(r.k) && !campanhaDaMensagem(r.primeira_mensagem));
    resultado.sem_campanha = {
      total: rows.length,
      explicacao: 'Contatos NOVOS no período cuja primeira mensagem não é a de nenhum anúncio (ex.: apagaram o texto pronto e escreveram "Olá"). Parte da diferença para o painel de tráfego costuma estar aqui.',
      exemplos: rows.slice(0, 8).map((r) => r.primeira_mensagem),
    };
  }

  resultado.como_ler =
    'rica_nao_respondeu deve ser 0; se não for, é falha a investigar. ' +
    'em_andamento_ultimas_24h ainda pode avançar e NÃO conta como parado. ' +
    'Diferença pequena para o painel de anúncios é esperada: a Meta atribui pela data do clique.';
  return resultado;
}

export const ETAPAS_DA_LISTA = ETAPAS_LISTAVEIS;
