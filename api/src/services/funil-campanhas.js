/**
 * Relatório do FUNIL POR CAMPANHA da Rica (força-tarefa comercial, set/2026).
 *
 * Fonte: rica_lead_funil (1 linha por lead+campanha, gravada pelo rica-bot
 * durante a conversa) — ver database/migrations/021_funil_campanhas_rica.sql.
 *
 * Responde, pelo copiloto do WhatsApp (Jéssica, Isabell, Maria Helena):
 *   - quantos leads chegaram por campanha no período;
 *   - em que etapa cada um está (contagem por etapa + lista filtrável);
 *   - onde a Rica está parando (etapa em que os leads ficaram parados);
 *   - quantos foram aproveitados (qualificados, reuniões, transferidos, links, compras);
 *   - quantos foram para o André;
 *   - os indicadores do "Playbook do André" (taxa de resposta, diagnóstico,
 *     dor identificada, qualificação, aceite do handoff).
 *
 * Também traz a contagem de cards do CRM por etapa do pipeline, porque a
 * gestão acompanha o funil tanto pela Rica quanto pelo Kanban.
 */

import { query } from './database.js';
import { resolverPeriodo } from './campanhas.js';

export const CAMPANHAS_FUNIL = {
  mentoria: 'Mentoria Padaria Lucrativa',
  jdl: 'Jornada da Lucratividade Online',
  gps: 'GPS Padaria',
  outro: 'Outros',
};

export function resolverCampanhaFunil(texto) {
  const s = String(texto || '').toLowerCase();
  if (!s) return null;
  if (/mentor|coletiva|padaria lucrativa/.test(s)) return 'mentoria';
  if (/jorn|jdl|lucratividade/.test(s)) return 'jdl';
  if (/gps/.test(s)) return 'gps';
  return null;
}

function pct(a, b) {
  const n = Number(a) || 0;
  const d = Number(b) || 0;
  return d > 0 ? `${Math.round((n / d) * 100)}%` : '—';
}

export async function relatorioFunil({ orgId, period, start_date, end_date, campanha, etapa, limit = 30 }) {
  const periodo = resolverPeriodo({ period, start_date, end_date });
  const params = [orgId, periodo.inicio, periodo.fim];
  let filtro = '';
  if (campanha) { params.push(campanha); filtro += ` AND f.campanha = $${params.length}`; }

  const base = `FROM rica_lead_funil f WHERE f.organization_id = $1 AND f.created_at >= $2 AND f.created_at < $3${filtro}`;

  const agg = await query(
    `SELECT f.campanha,
            count(*)::int AS leads,
            count(*) FILTER (WHERE f.first_rica_message_at IS NOT NULL)::int AS rica_contatou,
            count(*) FILTER (WHERE f.first_lead_reply_at IS NOT NULL)::int AS responderam,
            count(*) FILTER (WHERE f.etapa NOT IN ('novo','rica_iniciou','engajou','nutricao','nao_contatar','perdido')
                               OR f.dor_principal IS NOT NULL)::int AS diagnostico_iniciado,
            count(*) FILTER (WHERE f.dor_principal IS NOT NULL)::int AS dor_identificada,
            count(*) FILTER (WHERE f.qualified_at IS NOT NULL)::int AS qualificados,
            count(*) FILTER (WHERE f.scheduling_options_shown_at IS NOT NULL)::int AS agendamento_oferecido,
            count(*) FILTER (WHERE f.meeting_booked_at IS NOT NULL)::int AS reunioes_agendadas,
            count(*) FILTER (WHERE f.handoff_at IS NOT NULL)::int AS transferidos_andre,
            count(*) FILTER (WHERE f.link_enviado_at IS NOT NULL)::int AS links_enviados,
            count(*) FILTER (WHERE f.compra_confirmada_at IS NOT NULL)::int AS compras,
            count(*) FILTER (WHERE f.etapa = 'nutricao')::int AS nutricao_sem_resposta,
            count(*) FILTER (WHERE f.nao_contatar)::int AS pediram_para_parar,
            count(*) FILTER (WHERE f.link_agenda_enviado_at IS NOT NULL)::int AS links_agenda_enviados,
            count(*) FILTER (WHERE f.confirmado_andre_at IS NOT NULL)::int AS confirmadas_andre,
            count(*) FILTER (WHERE f.reuniao_realizada_at IS NOT NULL)::int AS reunioes_realizadas,
            count(*) FILTER (WHERE f.no_show_at IS NOT NULL)::int AS no_shows,
            count(*) FILTER (WHERE f.remarcado_at IS NOT NULL)::int AS remarcadas,
            count(*) FILTER (WHERE f.resultado = 'vendido')::int AS vendas_andre,
            count(*) FILTER (WHERE f.resultado = 'nao_vendido')::int AS nao_vendidos,
            round(avg(EXTRACT(EPOCH FROM (f.meeting_booked_at - f.created_at)) / 3600)
              FILTER (WHERE f.meeting_booked_at IS NOT NULL)::numeric, 1) AS horas_ate_agendamento
     ${base}
     GROUP BY f.campanha ORDER BY leads DESC`,
    params
  );

  const porEtapa = await query(
    `SELECT f.campanha, f.etapa, count(*)::int AS qtd ${base} GROUP BY f.campanha, f.etapa ORDER BY f.campanha, qtd DESC`,
    params
  );

  const listaParams = [...params];
  let listaFiltro = '';
  if (etapa) { listaParams.push(etapa); listaFiltro = ` AND f.etapa = $${listaParams.length}`; }
  listaParams.push(Math.min(Math.max(Number(limit) || 30, 1), 100));
  const lista = await query(
    `SELECT f.campanha, f.etapa, COALESCE(f.nome, d.contact_name) AS nome, f.phone AS telefone, f.padaria,
            f.dor_principal, f.objetivo_declarado, f.temperatura, f.meeting_status,
            f.categoria_dor, f.papel, f.classe, f.resultado, f.motivo_perda,
            to_char(f.meeting_start_at AT TIME ZONE 'America/Recife', 'DD/MM HH24:MI') AS reuniao,
            to_char(f.last_interaction_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM HH24:MI') AS ultima_interacao
     FROM rica_lead_funil f LEFT JOIN deals d ON d.id = f.deal_id
     WHERE f.organization_id = $1 AND f.created_at >= $2 AND f.created_at < $3${filtro}${listaFiltro}
     ORDER BY f.last_interaction_at DESC NULLS LAST
     LIMIT $${listaParams.length}`,
    listaParams
  );

  const campanhas = agg.rows.map((r) => ({
    campanha: CAMPANHAS_FUNIL[r.campanha] || r.campanha,
    ...r,
    indicadores: {
      taxa_resposta: pct(r.responderam, r.rica_contatou || r.leads),
      taxa_diagnostico: pct(r.diagnostico_iniciado, r.responderam),
      taxa_dor_identificada: pct(r.dor_identificada, r.diagnostico_iniciado),
      taxa_qualificacao: pct(r.qualificados, r.responderam),
      aceite_handoff: pct(r.transferidos_andre, r.qualificados),
      reunioes_por_qualificado: pct(r.reunioes_agendadas, r.qualificados),
      conversao_total: pct(r.compras + r.vendas_andre, r.leads),
      // Seção 19 do manual GPS (funil com agenda do André)
      taxa_interacao: pct(r.responderam, r.leads),
      taxa_envio_agenda: pct(r.links_agenda_enviados, r.qualificados),
      taxa_agendamento: pct(r.reunioes_agendadas, r.links_agenda_enviados),
      taxa_confirmacao: pct(r.confirmadas_andre, r.reunioes_agendadas),
      show_rate: pct(r.reunioes_realizadas, r.reunioes_agendadas),
      conversao_andre: pct(r.vendas_andre, r.reunioes_realizadas),
      tempo_medio_ate_agendamento_horas: r.horas_ate_agendamento === null ? '—' : Number(r.horas_ate_agendamento),
    },
    parados_por_etapa: porEtapa.rows
      .filter((e) => e.campanha === r.campanha)
      .map((e) => ({ etapa: e.etapa, qtd: e.qtd })),
  }));

  return {
    periodo: periodo.rotulo,
    criterio:
      'Leads que a Rica registrou no funil da campanha no período (entram pela mensagem do anúncio ou quando a Rica identifica a campanha). ' +
      '"parados_por_etapa" é ONDE cada lead está agora — use para dizer onde a Rica está parando. ' +
      'Metas iniciais do playbook: resposta ≥55%, diagnóstico ≥70%, dor identificada ≥80%, aceite do handoff ≥75%. ' +
      'No GPS, confirmação/realizada/no-show/venda só contam o que o André informou à Rica pelo WhatsApp.',
    campanhas,
    leads: lista.rows,
    observacao: campanhas.length === 0
      ? 'Nenhum lead registrado no funil de campanhas neste período (o registro começou em 23/09/2026). Para períodos anteriores use relatorio_campanhas.'
      : undefined,
  };
}

/** Cards do CRM por etapa do pipeline (Kanban) — quantos leads em cada etapa. */
export async function cardsPorEtapa({ orgId, pipeline_name, apenas_abertos = true }) {
  const params = [orgId];
  let filtro = '';
  if (pipeline_name) { params.push(`%${pipeline_name}%`); filtro += ` AND p.name ILIKE $${params.length}`; }
  if (apenas_abertos) filtro += ` AND d.status = 'open'`;
  const r = await query(
    `SELECT COALESCE(p.name, '(sem funil)') AS funil, COALESCE(ps.name, '(sem etapa)') AS etapa,
            count(*)::int AS qtd, count(*) FILTER (WHERE d.owner_id IS NULL)::int AS sem_responsavel
     FROM deals d
     LEFT JOIN pipelines p ON p.id = d.pipeline_id
     LEFT JOIN pipeline_stages ps ON ps.id = d.pipeline_stage_id
     WHERE d.organization_id = $1${filtro}
     GROUP BY p.name, ps.name, ps.position
     ORDER BY p.name, ps.position NULLS LAST`,
    params
  );
  return { criterio: apenas_abertos ? 'Cards ABERTOS agora, por funil e etapa do Kanban.' : 'Todos os cards, por funil e etapa.', etapas: r.rows };
}

// ─── Pós-agendamento: o André informa o andamento (manual GPS, seções 11 a 13) ──

/**
 * Acha o lead do funil pelo telefone (tolerante ao 9º dígito) ou pelo nome,
 * entre os que já foram entregues ao André. Mais de um → devolve a lista.
 */
export async function acharLeadDoFunil({ orgId, telefone, nome }) {
  const dig = String(telefone || '').replace(/\D/g, '');
  if (dig.length >= 8) {
    const ddd = dig.length >= 10 ? (dig.startsWith('55') && dig.length >= 12 ? dig.slice(2, 4) : dig.slice(0, 2)) : null;
    const r = await query(
      `SELECT f.*, COALESCE(f.nome, d.contact_name) AS nome_lead FROM rica_lead_funil f LEFT JOIN deals d ON d.id = f.deal_id
       WHERE f.organization_id = $1 AND right(f.phone, 8) = right($2, 8)
         AND ($3::text IS NULL OR substring(f.phone from 3 for 2) = $3)
       ORDER BY (f.handoff_at IS NOT NULL) DESC, f.last_interaction_at DESC NULLS LAST LIMIT 1`,
      [orgId, dig, ddd]
    );
    return r.rows.length ? { lead: r.rows[0] } : { erro: 'Não achei esse telefone no funil da Rica.' };
  }
  const n = String(nome || '').trim();
  if (!n) return { erro: 'Informe o telefone ou o nome do lead.' };
  const r = await query(
    `SELECT f.*, COALESCE(f.nome, d.contact_name) AS nome_lead FROM rica_lead_funil f LEFT JOIN deals d ON d.id = f.deal_id
     WHERE f.organization_id = $1 AND f.handoff_at > NOW() - INTERVAL '60 days'
       AND (f.nome ILIKE $2 OR d.contact_name ILIKE $2 OR f.padaria ILIKE $2)
     ORDER BY f.handoff_at DESC LIMIT 5`,
    [orgId, `%${n}%`]
  );
  if (r.rows.length === 1) return { lead: r.rows[0] };
  if (r.rows.length === 0) return { erro: `Não achei lead entregue ao André com o nome "${n}" nos últimos 60 dias. Mande o telefone.` };
  return {
    erro: 'Achei mais de um lead com esse nome. Qual deles?',
    opcoes: r.rows.map((l) => ({ nome: l.nome_lead, telefone: l.phone, padaria: l.padaria, campanha: l.campanha })),
  };
}

const STATUS_REUNIAO = {
  confirmado: { etapa: 'confirmado_andre', col: 'confirmado_andre_at', meeting: 'confirmada', texto: 'Reunião confirmada pelo André' },
  realizada: { etapa: 'reuniao_realizada', col: 'reuniao_realizada_at', meeting: 'realizada', texto: 'Reunião realizada' },
  no_show: { etapa: 'no_show', col: 'no_show_at', meeting: 'no_show', texto: 'Cliente não compareceu (no-show)' },
  vendido: { etapa: 'vendido', col: 'resultado_at', meeting: 'realizada', resultado: 'vendido', texto: 'Venda fechada' },
  nao_vendido: { etapa: 'perdido', col: 'resultado_at', meeting: 'realizada', resultado: 'nao_vendido', texto: 'Não vendido' },
};

export async function atualizarReuniao({ orgId, telefone, nome, status, motivo, autor }) {
  const cfg = STATUS_REUNIAO[status];
  if (!cfg) return { ok: false, erro: 'Status inválido.' };
  const achado = await acharLeadDoFunil({ orgId, telefone, nome });
  if (!achado.lead) return { ok: false, ...achado };
  const l = achado.lead;

  const sets = ['etapa = $4', `${cfg.col} = NOW()`, 'updated_at = NOW()'];
  const vals = [orgId, l.phone, l.campanha, cfg.etapa];
  vals.push(cfg.meeting); sets.push(`meeting_status = $${vals.length}`);
  if (cfg.resultado) { vals.push(cfg.resultado); sets.push(`resultado = $${vals.length}`); }
  if (status === 'realizada' || cfg.resultado) sets.push('reuniao_realizada_at = COALESCE(reuniao_realizada_at, NOW())');
  if (status === 'nao_vendido' && motivo) { vals.push(String(motivo).slice(0, 1000)); sets.push(`motivo_perda = $${vals.length}`); }
  await query(
    `UPDATE rica_lead_funil SET ${sets.join(', ')} WHERE organization_id = $1 AND phone = $2 AND campanha = $3`,
    vals
  );
  await query(
    `INSERT INTO rica_funil_eventos (organization_id, phone, campanha, evento, dados) VALUES ($1, $2, $3, $4, $5)`,
    [orgId, l.phone, l.campanha, `andre:${status}`, JSON.stringify({ motivo: motivo || undefined, autor })]
  ).catch(() => {});
  if (l.deal_id) {
    await query(
      `INSERT INTO deal_activities (deal_id, type, description, organization_id) VALUES ($1, 'note', $2, $3)`,
      [l.deal_id, `${cfg.texto}${motivo ? `: ${motivo}` : ''} (informado por ${autor || 'André'} à Rica)`.slice(0, 2000), orgId]
    ).catch((e) => console.warn('[funil] atividade no deal falhou:', e.message));
  }
  return { ok: true, lead: l.nome_lead || l.phone, telefone: l.phone, registrado: cfg.texto };
}
