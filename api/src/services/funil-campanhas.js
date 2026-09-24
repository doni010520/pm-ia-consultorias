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
            count(*) FILTER (WHERE f.nao_contatar)::int AS pediram_para_parar
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
      conversao_total: pct(r.compras, r.leads),
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
      'Metas iniciais do playbook: resposta ≥55%, diagnóstico ≥70%, dor identificada ≥80%, aceite do handoff ≥75%.',
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
