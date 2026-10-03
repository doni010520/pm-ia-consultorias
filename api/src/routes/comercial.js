import { Router } from 'express';
import { query } from '../services/database.js';
import { requireRole } from '../middleware/auth.js';
import { carregarFonte, carregarMetas, calcularPainel, mesAnterior } from '../services/painelComercial.js';
import { verificarToken, sincronizarRd } from '../services/rdStation.js';

const router = Router();
const gestao = requireRole('admin', 'manager');
const orgDe = (req) => req.organizationId || process.env.DEFAULT_ORGANIZATION_ID;
const MES = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * GET /api/comercial/painel?fonte=rd|crm|consolidado&mes=YYYY-MM&executivo&produto&funil&origem&regiao
 */
router.get('/painel', gestao, async (req, res, next) => {
  try {
    const org = orgDe(req);
    const fonte = ['rd', 'crm', 'consolidado'].includes(req.query.fonte) ? req.query.fonte : 'rd';
    const mes = MES.test(req.query.mes || '') ? req.query.mes : new Date().toISOString().slice(0, 7);
    const filtros = { mes };
    for (const k of ['executivo', 'produto', 'funil', 'origem', 'regiao']) if (req.query[k]) filtros[k] = String(req.query[k]);

    const [linhas, metas, rd] = await Promise.all([
      carregarFonte(org, fonte),
      carregarMetas(org, [mes, mesAnterior(mes)]),
      query(
        `SELECT dono_token, last_sync_at, last_sync_status, last_sync_error, deals_sincronizados
           FROM integracao_rd WHERE organization_id = $1`,
        [org],
      ).then((r) => r.rows[0] || null),
    ]);
    res.json({ fonte, rd, ...calcularPainel(linhas, metas, filtros) });
  } catch (err) {
    next(err);
  }
});

/** GET /api/comercial/metas?mes=YYYY-MM */
router.get('/metas', gestao, async (req, res, next) => {
  try {
    if (!MES.test(req.query.mes || '')) return res.status(400).json({ error: { message: 'mes=YYYY-MM obrigatório' } });
    res.json({ mes: req.query.mes, metas: await carregarMetas(orgDe(req), [req.query.mes]) });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/comercial/metas  { mes, metas: [{ executivo: string|null, valor }] }
 * Substitui as metas do mês. executivo null = meta total da empresa.
 */
router.put('/metas', gestao, async (req, res, next) => {
  try {
    const { mes, metas } = req.body || {};
    if (!MES.test(mes || '') || !Array.isArray(metas)) {
      return res.status(400).json({ error: { message: 'Envie { mes: "YYYY-MM", metas: [...] }' } });
    }
    const org = orgDe(req);
    await query(`DELETE FROM metas_comerciais WHERE organization_id = $1 AND mes = $2::date`, [org, `${mes}-01`]);
    for (const m of metas) {
      const valor = Number(m.valor);
      if (!(valor > 0)) continue;
      await query(
        `INSERT INTO metas_comerciais (organization_id, mes, executivo, valor, updated_by) VALUES ($1, $2::date, $3, $4, $5)`,
        [org, `${mes}-01`, m.executivo ? String(m.executivo).trim() : null, valor, req.user?.id || null],
      );
    }
    res.json({ mes, metas: await carregarMetas(org, [mes]) });
  } catch (err) {
    next(err);
  }
});

/** GET /api/comercial/rd — status da integração (sem expor o token). */
router.get('/rd', gestao, async (req, res, next) => {
  try {
    const r = await query(
      `SELECT dono_token, last_sync_at, last_sync_status, last_sync_error, deals_sincronizados
         FROM integracao_rd WHERE organization_id = $1`,
      [orgDe(req)],
    );
    res.json({ conectado: Boolean(r.rows[0]), ...(r.rows[0] || {}) });
  } catch (err) {
    next(err);
  }
});

/** PUT /api/comercial/rd { token } — confere, salva e sincroniza. Só admin. */
router.put('/rd', requireRole('admin'), async (req, res, next) => {
  try {
    const token = String(req.body?.token || '').trim();
    if (!token) return res.status(400).json({ error: { message: 'Informe o token da instância do RD Station' } });
    let dono;
    try {
      dono = await verificarToken(token);
    } catch (err) {
      return res.status(400).json({ error: { message: err.message } });
    }
    const org = orgDe(req);
    await query(
      `INSERT INTO integracao_rd (organization_id, token, dono_token) VALUES ($1, $2, $3)
       ON CONFLICT (organization_id) DO UPDATE SET token = EXCLUDED.token, dono_token = EXCLUDED.dono_token, updated_at = NOW()`,
      [org, token, `${dono.nome} <${dono.email}>`],
    );
    const sync = await sincronizarRd(org);
    res.json({ conectado: true, dono, ...sync, aviso: dono.admin ? null : 'O dono do token não é admin no RD: o painel só verá os negócios que ele enxerga.' });
  } catch (err) {
    next(err);
  }
});

/** POST /api/comercial/rd/sync — sincroniza agora. */
router.post('/rd/sync', gestao, async (req, res, next) => {
  try {
    res.json(await sincronizarRd(orgDe(req)));
  } catch (err) {
    next(err);
  }
});

export default router;
