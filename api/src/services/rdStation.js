/**
 * Sincronização com o RD Station CRM (API v1).
 *
 * Token da instância de um usuário do RD: o token só enxerga o que esse usuário
 * enxerga, então precisa ser de alguém com visibilidade Geral em Negociações.
 * Limite da API: 120 req/min — uma sync completa (~1.600 negócios) usa ~10.
 *
 * A cada sync a tabela rd_deals da organização é substituída inteira.
 */

import { query, getClient } from './database.js';
import { ufDoEndereco, ufDoTelefone } from './regiao.js';

const BASE = 'https://crm.rdstation.com/api/v1';
const SYNC_INTERVAL_MS = 30 * 60 * 1000;

async function rdGet(path, token, params = {}) {
  const qs = new URLSearchParams({ token, ...params });
  const res = await fetch(`${BASE}${path}?${qs}`, { signal: AbortSignal.timeout(60_000) });
  if (res.status === 401) throw new Error('Token do RD Station inválido ou revogado');
  if (!res.ok) throw new Error(`RD Station respondeu ${res.status} em ${path}`);
  return res.json();
}

/** Confere o token e devolve o dono (nome, e-mail, papel). */
export async function verificarToken(token) {
  const me = await rdGet('/users/me', token);
  return { nome: me.name, email: me.email, admin: me.role === 'admin' };
}

function statusDo(deal) {
  if (deal.win === true) return 'ganho';
  if (deal.win === false) return 'perdido';
  return 'aberto';
}

/** Negociação do RD → linha de rd_deals. */
export function normalizarDeal(deal, funilDaEtapa) {
  const contatos = deal.contacts || [];
  const telefones = contatos.flatMap((c) => (c.phones || []).map((p) => p.phone)).filter(Boolean);
  const emails = contatos.flatMap((c) => (c.emails || []).map((e) => e.email)).filter(Boolean);
  const uf = ufDoEndereco(deal.organization?.address) || telefones.map(ufDoTelefone).find(Boolean) || null;
  return {
    rd_id: deal.id || deal._id,
    nome: deal.name,
    funil: funilDaEtapa.get(deal.deal_stage?.id) || null,
    etapa: deal.deal_stage?.name || null,
    status: statusDo(deal),
    valor: Number(deal.amount_total) || 0,
    executivo: deal.user?.name?.trim() || null,
    executivo_email: deal.user?.email || null,
    origem: deal.deal_source?.name || null,
    produtos: (deal.deal_products || []).map((p) => p.name).filter(Boolean),
    uf,
    telefones,
    emails,
    pausado: Boolean(deal.hold),
    tem_proxima_tarefa: Boolean(deal.next_task),
    criado_em: deal.created_at || null,
    fechado_em: deal.closed_at || null,
    previsao_fechamento: deal.prediction_date ? String(deal.prediction_date).slice(0, 10) : null,
    atualizado_em: deal.updated_at || null,
    ultima_atividade_em: deal.last_activity_at || null,
  };
}

async function baixarTudo(token) {
  const funis = await rdGet('/deal_pipelines', token);
  const funilDaEtapa = new Map();
  for (const f of funis) for (const s of f.deal_stages || []) funilDaEtapa.set(s.id, f.name);

  const deals = [];
  for (let page = 1; page <= 60; page++) {
    const r = await rdGet('/deals', token, { limit: '200', page: String(page), order: 'created_at', direction: 'asc' });
    deals.push(...(r.deals || []));
    if (!r.has_more || !(r.deals || []).length) break;
    await new Promise((ok) => setTimeout(ok, 600));
  }
  return deals.map((d) => normalizarDeal(d, funilDaEtapa));
}

const COLUNAS = [
  'rd_id', 'nome', 'funil', 'etapa', 'status', 'valor', 'executivo', 'executivo_email', 'origem',
  'produtos', 'uf', 'telefones', 'emails', 'pausado', 'tem_proxima_tarefa', 'criado_em',
  'fechado_em', 'previsao_fechamento', 'atualizado_em', 'ultima_atividade_em',
];

/** Sincroniza uma organização. Grava o resultado (ok/erro) em integracao_rd. */
export async function sincronizarRd(organizationId) {
  const cfg = (await query('SELECT token FROM integracao_rd WHERE organization_id = $1', [organizationId])).rows[0];
  if (!cfg) throw new Error('RD Station não conectado');

  try {
    const linhas = await baixarTudo(cfg.token);
    const client = await getClient();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM rd_deals WHERE organization_id = $1', [organizationId]);
      for (let i = 0; i < linhas.length; i += 200) {
        const lote = linhas.slice(i, i + 200);
        const valores = [];
        const params = [];
        lote.forEach((l, j) => {
          const base = j * (COLUNAS.length + 1);
          valores.push(`(${Array.from({ length: COLUNAS.length + 1 }, (_, k) => `$${base + k + 1}`).join(',')})`);
          params.push(organizationId, ...COLUNAS.map((c) => l[c]));
        });
        await client.query(
          `INSERT INTO rd_deals (organization_id, ${COLUNAS.join(', ')}) VALUES ${valores.join(',')}`,
          params,
        );
      }
      await client.query(
        `UPDATE integracao_rd SET last_sync_at = NOW(), last_sync_status = 'ok', last_sync_error = NULL,
           deals_sincronizados = $2, updated_at = NOW() WHERE organization_id = $1`,
        [organizationId, linhas.length],
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    console.log(`[rd-sync] ${linhas.length} negociações sincronizadas (org ${organizationId})`);
    return { deals: linhas.length };
  } catch (err) {
    await query(
      `UPDATE integracao_rd SET last_sync_at = NOW(), last_sync_status = 'erro', last_sync_error = $2,
         updated_at = NOW() WHERE organization_id = $1`,
      [organizationId, String(err.message || err).slice(0, 500)],
    ).catch(() => {});
    throw err;
  }
}

let timer = null;

/** Sync periódica de todas as organizações conectadas. Chamado no boot. */
export function iniciarSyncRd() {
  if (timer) return;
  const rodar = async () => {
    try {
      const orgs = (await query('SELECT organization_id FROM integracao_rd')).rows;
      for (const { organization_id } of orgs) {
        await sincronizarRd(organization_id).catch((err) => console.error('[rd-sync] falhou:', err.message));
      }
    } catch (err) {
      // Tabela ainda não existe (migration 023 pendente) ou banco fora: tenta na próxima.
      console.error('[rd-sync] não rodou:', err.message);
    }
  };
  setTimeout(rodar, 60_000);
  timer = setInterval(rodar, SYNC_INTERVAL_MS);
}
