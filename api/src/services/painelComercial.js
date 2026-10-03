/**
 * Painel Comercial — números da visão executiva (meta, vendido, pipeline,
 * forecast, executivos, canais), para três fontes:
 *   rd          → cópia do RD Station (tabela rd_deals, ver rdStation.js)
 *   crm         → nosso CRM (tabela deals)
 *   consolidado → as duas; negócio presente nos dois lados (mesmo telefone ou
 *                 e-mail) conta uma vez, pela versão atualizada por último.
 *
 * Decisões (out/2026, dados reais do RD da Sucesso no Resultado):
 *  - Só 7 de 974 negócios abertos têm previsão de fechamento, então o forecast
 *    é pela ETAPA (valor × chance da etapa); a previsão vale quando existe.
 *  - Só ~11% dos abertos têm valor. Pipeline e forecast usam só o valor
 *    informado; negócio sem valor aparece contado à parte (qualidade). Estimar
 *    pelo ticket médio levava o pipeline do RD de R$ 2 mi a R$ 22 mi, porque a
 *    maioria dos abertos ainda é lead em "Sem contato"/"Contato feito".
 *  - Meta não existe na API do RD: vem de metas_comerciais (cadastrada no painel).
 */

import { query } from './database.js';
import { ufDoTelefone, regiaoDaUf } from './regiao.js';

const DIA = 86_400_000;
const PARADO_DIAS = 30;

// ─── etapas ──────────────────────────────────────────────────────────────────

export const GRUPOS = ['Sem contato', 'Qualificação', 'Apresentação', 'Proposta', 'Negociação', 'Fechamento'];
const CHANCE = { 'Sem contato': 0.05, 'Qualificação': 0.1, 'Apresentação': 0.25, 'Proposta': 0.5, 'Negociação': 0.7, 'Fechamento': 0.9 };

const sem = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/**
 * Nome da etapa (de qualquer funil, RD ou CRM) → grupo do funil comercial.
 * 'cliente' = etapa de pós-venda (já é cliente); 'fora' = perdido/descartado.
 */
export function grupoDaEtapa(nome) {
  const n = sem(nome);
  if (!n) return 'Sem contato';
  if (/perdid|sem resposta|reclassific/.test(n)) return 'fora';
  if (/pos.?venda|implanta|fideliza|treinamento da equipe|^ganho$|^fechado$/.test(n)) return 'cliente';
  if (/fechament|fechada/.test(n)) return 'Fechamento';
  if (/negocia|inscri/.test(n)) return 'Negociação';
  if (/proposta/.test(n)) return 'Proposta';
  if (/apresenta|demo|diagnost|degusta/.test(n)) return 'Apresentação';
  if (/contato feito|contato realizado|em conversa|qualifica|identifica/.test(n)) return 'Qualificação';
  return 'Sem contato';
}

// ─── carga das fontes ────────────────────────────────────────────────────────

const limparNome = (s) => (s ? String(s).replace(/\s+/g, ' ').trim() : null);
const titulo = (s) => s && s.toLowerCase().replace(/(^|\s)(\p{L})/gu, (m) => m.toUpperCase());
const chaveTel = (t) => { const d = String(t || '').replace(/\D/g, ''); return d.length >= 8 ? `t${d.slice(-8)}` : null; };
const chaveEmail = (e) => (e && String(e).includes('@') ? `e${String(e).trim().toLowerCase()}` : null);

function linha(base) {
  const grupo = base.status === 'aberto' ? grupoDaEtapa(base.etapa) : base.status;
  return { ...base, grupo, regiao: regiaoDaUf(base.uf) };
}

async function carregarRd(orgId, nomePorEmail) {
  const { rows } = await query('SELECT * FROM rd_deals WHERE organization_id = $1', [orgId]);
  return rows.map((r) => linha({
    fonte: 'rd',
    id: r.rd_id,
    nome: r.nome,
    funil: r.funil,
    etapa: r.etapa,
    status: r.status,
    valor: Number(r.valor) || 0,
    executivo: nomePorEmail.get(String(r.executivo_email || '').toLowerCase()) || titulo(limparNome(r.executivo)),
    origem: r.origem,
    produto: r.produtos?.[0] || null,
    uf: r.uf,
    pausado: r.pausado,
    temProxima: r.tem_proxima_tarefa,
    criado: r.criado_em,
    fechado: r.fechado_em,
    previsao: r.previsao_fechamento,
    atualizado: r.ultima_atividade_em && r.ultima_atividade_em > r.atualizado_em ? r.ultima_atividade_em : r.atualizado_em,
    chaves: [...(r.telefones || []).map(chaveTel), ...(r.emails || []).map(chaveEmail)].filter(Boolean),
  }));
}

async function carregarCrm(orgId) {
  const { rows } = await query(
    `SELECT d.id, d.title, p.name AS funil, s.name AS etapa, d.status, d.value, u.name AS executivo,
            COALESCE(NULLIF(d.source, ''), d.first_channel) AS origem,
            (SELECT dp.description FROM deal_products dp WHERE dp.deal_id = d.id ORDER BY dp.created_at LIMIT 1) AS produto,
            d.contact_phone, d.contact_email, d.created_at,
            COALESCE(d.closed_at, d.won_date, d.lost_date) AS fechado,
            d.expected_close_date, d.updated_at, d.last_activity_at, d.next_follow_up
       FROM deals d
       LEFT JOIN pipeline_stages s ON s.id = d.pipeline_stage_id
       LEFT JOIN pipelines p ON p.id = d.pipeline_id
       LEFT JOIN users u ON u.id = d.owner_id
      WHERE d.organization_id = $1`,
    [orgId],
  );
  return rows.map((r) => linha({
    fonte: 'crm',
    id: r.id,
    nome: r.title,
    funil: r.funil,
    etapa: r.etapa,
    status: r.status === 'won' ? 'ganho' : r.status === 'lost' ? 'perdido' : 'aberto',
    valor: Number(r.value) || 0,
    executivo: limparNome(r.executivo),
    origem: r.origem,
    produto: r.produto,
    uf: ufDoTelefone(r.contact_phone),
    pausado: false,
    temProxima: Boolean(r.next_follow_up),
    criado: r.created_at,
    fechado: r.fechado,
    previsao: r.expected_close_date,
    atualizado: r.last_activity_at && r.last_activity_at > r.updated_at ? r.last_activity_at : r.updated_at,
    chaves: [chaveTel(r.contact_phone), chaveEmail(r.contact_email)].filter(Boolean),
  }));
}

/** Negócio nos dois lados conta uma vez: fica a versão atualizada por último. */
export function consolidar(rd, crm) {
  const rdPorChave = new Map();
  rd.forEach((r, i) => r.chaves.forEach((k) => rdPorChave.set(k, i)));
  const rdDescartado = new Set();
  const crmFica = [];
  for (const c of crm) {
    const i = c.chaves.map((k) => rdPorChave.get(k)).find((x) => x !== undefined);
    if (i === undefined) { crmFica.push(c); continue; }
    if (new Date(c.atualizado || 0) > new Date(rd[i].atualizado || 0)) { rdDescartado.add(i); crmFica.push(c); }
  }
  return [...rd.filter((_, i) => !rdDescartado.has(i)), ...crmFica];
}

export async function carregarFonte(orgId, fonte) {
  const users = (await query('SELECT name, email FROM users WHERE organization_id = $1', [orgId])).rows;
  const nomePorEmail = new Map(users.filter((u) => u.email).map((u) => [u.email.toLowerCase(), limparNome(u.name)]));
  if (fonte === 'rd') return carregarRd(orgId, nomePorEmail);
  if (fonte === 'crm') return carregarCrm(orgId);
  const [rd, crm] = await Promise.all([carregarRd(orgId, nomePorEmail), carregarCrm(orgId)]);
  return consolidar(rd, crm);
}

export async function carregarMetas(orgId, meses) {
  const { rows } = await query(
    `SELECT to_char(mes, 'YYYY-MM') AS mes, executivo, valor FROM metas_comerciais
      WHERE organization_id = $1 AND to_char(mes, 'YYYY-MM') = ANY($2)`,
    [orgId, meses],
  );
  return rows.map((r) => ({ mes: r.mes, executivo: r.executivo, valor: Number(r.valor) || 0 }));
}

// ─── foto diária (comparação "vs mês anterior" de pipeline, forecast, commit) ─

const CAMPOS_FOTO = ['pipeline', 'qualificado', 'ponderado', 'commit', 'cobertura', 'abertos'];
const hojeIso = () => new Date().toISOString().slice(0, 10);

/** Grava (ou sobrescreve) a foto de hoje das três fontes, sem filtros. */
export async function gravarSnapshots(orgId) {
  const mes = hojeIso().slice(0, 7);
  const metas = await carregarMetas(orgId, [mes, mesAnterior(mes)]);
  for (const fonte of ['rd', 'crm', 'consolidado']) {
    const { kpis } = calcularPainel(await carregarFonte(orgId, fonte), metas, { mes });
    const foto = Object.fromEntries(CAMPOS_FOTO.map((c) => [c, kpis[c]]));
    await query(
      `INSERT INTO painel_snapshots (organization_id, fonte, dia, kpis) VALUES ($1, $2, $3, $4)
       ON CONFLICT (organization_id, fonte, dia) DO UPDATE SET kpis = EXCLUDED.kpis, created_at = NOW()`,
      [orgId, fonte, hojeIso(), JSON.stringify(foto)],
    );
  }
}

/** Foto de ~1 mês atrás (a mais recente até 30 dias antes, aceitando até 40). */
export async function fotoDoMesAnterior(orgId, fonte) {
  const { rows } = await query(
    `SELECT kpis FROM painel_snapshots
      WHERE organization_id = $1 AND fonte = $2
        AND dia <= CURRENT_DATE - 30 AND dia >= CURRENT_DATE - 40
      ORDER BY dia DESC LIMIT 1`,
    [orgId, fonte],
  );
  return rows[0]?.kpis || null;
}

// ─── cálculo ─────────────────────────────────────────────────────────────────

const mesDe = (d) => (d ? new Date(d).toISOString().slice(0, 7) : null);
export function mesAnterior(mes) {
  const [a, m] = mes.split('-').map(Number);
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, '0')}`;
}
const soma = (xs, f) => xs.reduce((t, x) => t + f(x), 0);
const razao = (a, b) => (b > 0 ? a / b : null);

function agrupar(xs, chave, valor) {
  const m = new Map();
  for (const x of xs) { const k = chave(x); m.set(k, (m.get(k) || 0) + valor(x)); }
  return [...m.entries()].map(([nome, v]) => ({ nome, valor: v })).sort((a, b) => b.valor - a.valor);
}

function topComOutros(lista, n) {
  if (lista.length <= n) return lista;
  return [...lista.slice(0, n), { nome: 'Outros', valor: soma(lista.slice(n), (x) => x.valor) }];
}

function bater(r, f) {
  if (f.executivo && r.executivo !== f.executivo) return false;
  if (f.produto && r.produto !== f.produto) return false;
  if (f.funil && r.funil !== f.funil) return false;
  if (f.origem && r.origem !== f.origem) return false;
  if (f.regiao && r.regiao !== f.regiao && r.uf !== f.regiao) return false;
  return true;
}

function metaDo(metas, mes, executivo) {
  const doMes = metas.filter((m) => m.mes === mes);
  if (executivo) return doMes.find((m) => m.executivo === executivo)?.valor ?? null;
  const total = doMes.find((m) => !m.executivo);
  if (total) return total.valor;
  const porExec = doMes.filter((m) => m.executivo);
  return porExec.length ? soma(porExec, (m) => m.valor) : null;
}

function bucketForecast(r, hoje) {
  if (r.previsao) {
    const dias = (new Date(r.previsao) - hoje) / DIA;
    if (dias <= 30) return 30;
    if (dias <= 60) return 60;
    if (dias <= 90) return 90;
    return null;
  }
  if (r.grupo === 'Fechamento' || r.grupo === 'Negociação') return 30;
  if (r.grupo === 'Proposta') return 60;
  if (r.grupo === 'Apresentação') return 90;
  return null;
}

function nivel(valor, verde, amarelo, maiorMelhor = true) {
  if (valor === null || valor === undefined) return 'sem_dado';
  if (maiorMelhor) return valor >= verde ? 'verde' : valor >= amarelo ? 'amarelo' : 'vermelho';
  return valor <= verde ? 'verde' : valor <= amarelo ? 'amarelo' : 'vermelho';
}

/**
 * @param linhas  negócios normalizados da fonte (carregarFonte)
 * @param metas   metas do mês e do anterior (carregarMetas)
 * @param filtros { mes: 'YYYY-MM', executivo?, produto?, funil?, origem?, regiao? }
 */
export function calcularPainel(linhas, metas, filtros, agora = Date.now()) {
  const hoje = agora;
  const mes = filtros.mes;
  const ant = mesAnterior(mes);
  const xs = linhas.filter((r) => bater(r, filtros));

  const valorDe = (r) => (r.valor > 0 ? r.valor : 0);
  const abertos = xs.filter((r) => r.status === 'aberto' && GRUPOS.includes(r.grupo) && !r.pausado);
  const ganhosNo = (m) => xs.filter((r) => r.status === 'ganho' && mesDe(r.fechado) === m);
  const parado = (r) => hoje - new Date(r.atualizado || r.criado || 0) > PARADO_DIAS * DIA;

  const vendido = soma(ganhosNo(mes), (r) => r.valor);
  const vendidoAnt = soma(ganhosNo(ant), (r) => r.valor);
  const meta = metaDo(metas, mes, filtros.executivo);
  const metaAnt = metaDo(metas, ant, filtros.executivo);
  const atingimento = razao(vendido, meta);
  const atingimentoAnt = razao(vendidoAnt, metaAnt);
  const gap = meta === null ? null : Math.max(meta - vendido, 0);
  const gapAnt = metaAnt === null ? null : Math.max(metaAnt - vendidoAnt, 0);
  const pipeline = soma(abertos, valorDe);
  const qualificado = soma(abertos.filter((r) => GRUPOS.indexOf(r.grupo) >= 2), valorDe);
  const ponderado = soma(abertos, (r) => valorDe(r) * CHANCE[r.grupo]);
  const commit = soma(abertos.filter((r) => CHANCE[r.grupo] >= 0.7), valorDe);

  const funil = GRUPOS.map((g) => {
    const ds = abertos.filter((r) => r.grupo === g);
    return { etapa: g, negocios: ds.length, valor: soma(ds, valorDe), chance: CHANCE[g] };
  });

  const forecast = [30, 60, 90].map((dias) => ({
    dias,
    valor: soma(abertos.filter((r) => { const b = bucketForecast(r, hoje); return b !== null && b <= dias; }), (r) => valorDe(r) * CHANCE[r.grupo]),
  }));

  // Executivos: quem tem meta no mês, negócio aberto ou venda no mês.
  const nomesExec = new Set([
    ...metas.filter((m) => m.mes === mes && m.executivo).map((m) => m.executivo),
    ...abertos.map((r) => r.executivo),
    ...ganhosNo(mes).map((r) => r.executivo),
  ].filter(Boolean));
  const executivos = [...nomesExec].map((nome) => {
    const ab = abertos.filter((r) => r.executivo === nome);
    const vend = soma(ganhosNo(mes).filter((r) => r.executivo === nome), (r) => r.valor);
    const metaE = metas.find((m) => m.mes === mes && m.executivo === nome)?.valor ?? null;
    const gapE = metaE === null ? null : Math.max(metaE - vend, 0);
    const pip = soma(ab, valorDe);
    return {
      nome,
      meta: metaE,
      vendido: vend,
      gap: gapE,
      pipeline: pip,
      forecast: soma(ab, (r) => valorDe(r) * CHANCE[r.grupo]),
      cobertura: gapE ? pip / gapE : null,
      abertos: ab.length,
      parados: ab.filter(parado).length,
    };
  }).sort((a, b) => b.pipeline - a.pipeline);

  // Canais: do começo do ano até o fim do mês escolhido.
  const ano = mes.slice(0, 4);
  const naJanela = (r) => { const m = mesDe(r.fechado); return m && m.slice(0, 4) === ano && m <= mes; };
  const fechadosAno = xs.filter((r) => (r.status === 'ganho' || r.status === 'perdido') && naJanela(r));
  const origens = new Set(fechadosAno.map((r) => r.origem || 'Sem origem'));
  const canais = [...origens].map((o) => {
    const doCanal = fechadosAno.filter((r) => (r.origem || 'Sem origem') === o);
    const g = doCanal.filter((r) => r.status === 'ganho');
    const receita = soma(g, (r) => r.valor);
    return { canal: o, clientes: g.length, receita, ticket: razao(receita, g.length), conversao: razao(g.length, doCanal.length) };
  }).filter((c) => c.clientes > 0).sort((a, b) => b.receita - a.receita);
  const ganhosAno = fechadosAno.filter((r) => r.status === 'ganho');
  const receitaAno = soma(ganhosAno, (r) => r.valor);

  // Conversão proposta → fechamento: ganhos ÷ (ganhos + perdidos) dos últimos 90 dias.
  const fechados90 = xs.filter((r) => (r.status === 'ganho' || r.status === 'perdido') && hoje - new Date(r.fechado || 0) <= 90 * DIA);
  const conversao90 = razao(fechados90.filter((r) => r.status === 'ganho').length, fechados90.length);
  const pctParados = razao(abertos.filter(parado).length, abertos.length);
  const pctProxima = razao(abertos.filter((r) => r.temProxima).length, abertos.length);
  const pctComValor = razao(abertos.filter((r) => r.valor > 0).length, abertos.length);
  const cobertura = gap ? pipeline / gap : null;
  const projecao = vendido + commit;

  return {
    filtros,
    kpis: {
      meta, metaAnt, vendido, vendidoAnt, atingimento, atingimentoAnt, gap, gapAnt,
      pipeline, qualificado, ponderado, commit, cobertura,
      abertos: abertos.length,
      ganhosMes: ganhosNo(mes).length,
    },
    metaRealizadoForecast: { meta, vendido, projecao },
    funil,
    forecast,
    porProduto: topComOutros(agrupar(abertos, (r) => r.produto || 'Sem produto', valorDe), 6),
    porExecutivo: agrupar(abertos, (r) => r.executivo || 'Sem responsável', valorDe),
    executivos,
    canais,
    canaisTotal: { clientes: ganhosAno.length, receita: receitaAno, ticket: razao(receitaAno, ganhosAno.length), conversao: razao(ganhosAno.length, fechadosAno.length) },
    saude: [
      { chave: 'cobertura', nome: 'Cobertura do pipeline', valor: cobertura, formato: 'x', nivel: nivel(cobertura, 3, 2), regra: 'Pipeline aberto ÷ gap da meta. Verde ≥ 3x, amarelo ≥ 2x.' },
      { chave: 'forecast_meta', nome: 'Projeção x meta', valor: razao(projecao, meta), formato: '%', nivel: nivel(razao(projecao, meta), 1, 0.8), regra: '(Vendido + negócios em negociação/fechamento) ÷ meta. Verde ≥ 100%, amarelo ≥ 80%.' },
      { chave: 'conversao', nome: 'Conversão (90 dias)', valor: conversao90, formato: '%', nivel: nivel(conversao90, 0.3, 0.15), regra: 'Ganhos ÷ (ganhos + perdidos) fechados nos últimos 90 dias. Verde ≥ 30%, amarelo ≥ 15%.' },
      { chave: 'parados', nome: `Negócios parados (+${PARADO_DIAS} dias)`, valor: pctParados, formato: '%', nivel: nivel(pctParados, 0.2, 0.4, false), regra: `Abertos sem atualização há mais de ${PARADO_DIAS} dias. Verde ≤ 20%, amarelo ≤ 40%.` },
      { chave: 'proxima', nome: 'Próxima atividade preenchida', valor: pctProxima, formato: '%', nivel: nivel(pctProxima, 0.7, 0.4), regra: 'Abertos com próxima tarefa agendada. Verde ≥ 70%, amarelo ≥ 40%.' },
      { chave: 'valor', nome: 'Negócios com valor', valor: pctComValor, formato: '%', nivel: nivel(pctComValor, 0.8, 0.5), regra: 'Abertos com valor preenchido; sem valor, o negócio não entra no pipeline nem no forecast. Verde ≥ 80%, amarelo ≥ 50%.' },
    ],
    qualidade: {
      abertosSemValor: abertos.filter((r) => !(r.valor > 0)).length,
      abertosSemProduto: abertos.filter((r) => !r.produto).length,
    },
    opcoes: {
      executivos: [...new Set(linhas.map((r) => r.executivo).filter(Boolean))].sort(),
      produtos: [...new Set(linhas.map((r) => r.produto).filter(Boolean))].sort(),
      funis: [...new Set(linhas.map((r) => r.funil).filter(Boolean))].sort(),
      origens: [...new Set(linhas.map((r) => r.origem).filter(Boolean))].sort(),
      regioes: ['Norte', 'Nordeste', 'Centro-Oeste', 'Sudeste', 'Sul'],
    },
  };
}
