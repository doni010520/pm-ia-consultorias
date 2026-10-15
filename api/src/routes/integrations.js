import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { requireAuth } from '../middleware/auth.js';
import * as gcal from '../services/googleCalendar.js';
import { executivo, interpretarWebhook, registrarMensagem } from '../services/whatsapp-executivo.js';

const router = Router();

const JWT_SECRET = process.env.JWT_SECRET || 'pm-ia-secret-change-in-production';

// ── GET /api/integrations/google/connect ──────────────────────────────────────
// Autenticado (JWT). Devolve a URL de consentimento do Google. O frontend faz
// window.location = url. A identidade do usuario viaja num `state` assinado
// (curta duracao) para ser reassociada no callback.
router.get('/google/connect', requireAuth, (req, res, next) => {
  try {
    if (!gcal.isGoogleConfigured()) {
      return res.status(503).json({ error: { message: 'Integração Google não configurada no servidor.' } });
    }
    if (!req.user) {
      return res.status(401).json({ error: { message: 'Autenticação necessária.' } });
    }
    const state = jwt.sign(
      { userId: req.user.id, organizationId: req.user.organization_id },
      JWT_SECRET,
      { expiresIn: '10m' }
    );
    const url = gcal.getAuthUrl(state);
    res.json({ url });
  } catch (error) {
    next(error);
  }
});

// ── GET /api/integrations/google/callback ─────────────────────────────────────
// Publico (redirect do Google, sem header de auth). Valida o `state`, troca o
// code por tokens, salva e redireciona de volta ao app.
router.get('/google/callback', async (req, res) => {
  const appUrl = gcal.getAppUrl();
  const redirectOk = `${appUrl}/crm/agenda?google=connected`;
  const redirectErr = (msg) => `${appUrl}/crm/agenda?google=error&reason=${encodeURIComponent(msg)}`;

  try {
    const { code, state, error: oauthError } = req.query;
    if (oauthError) return res.redirect(redirectErr(String(oauthError)));
    if (!code || !state) return res.redirect(redirectErr('missing_code'));

    let decoded;
    try {
      decoded = jwt.verify(String(state), JWT_SECRET);
    } catch {
      return res.redirect(redirectErr('invalid_state'));
    }

    const { tokens, email } = await gcal.exchangeCode(String(code));
    await gcal.saveUserTokens(decoded.userId, decoded.organizationId, tokens, email);

    res.redirect(redirectOk);
  } catch (error) {
    console.error('[integrations] google callback error:', error);
    res.redirect(redirectErr('exchange_failed'));
  }
});

// ── GET /api/integrations/google/status ───────────────────────────────────────
router.get('/google/status', requireAuth, async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: { message: 'Autenticação necessária.' } });
    const conn = await gcal.getUserConnection(req.user.id);
    res.json({ configured: gcal.isGoogleConfigured(), ...conn });
  } catch (error) {
    next(error);
  }
});

// ── DELETE /api/integrations/google ───────────────────────────────────────────
router.delete('/google', requireAuth, async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: { message: 'Autenticação necessária.' } });
    await gcal.disconnectUser(req.user.id);
    res.json({ disconnected: true });
  } catch (error) {
    next(error);
  }
});

// ── POST /api/integrations/whatsapp-executivo/:slug?secret=... ────────────────
// Publico (webhook da uazapi). Recebe as mensagens do WhatsApp corporativo de um
// executivo e grava no CRM as que forem com leads. Responde 200 na hora: a uazapi
// reenvia o que demora, e baixar/transcrever audio leva segundos.
router.post('/whatsapp-executivo/:slug', (req, res) => {
  const secret = process.env.WA_EXEC_WEBHOOK_SECRET || '';
  if (!secret || req.query.secret !== secret) return res.status(401).json({ ok: false });
  const exec = executivo(req.params.slug);
  if (!exec) return res.status(404).json({ ok: false });
  res.json({ ok: true });

  const orgId = process.env.DEFAULT_ORGANIZATION_ID;
  registrarMensagem(orgId, exec.slug, interpretarWebhook(req.body))
    .then((r) => { if (r.gravada) console.log(`[wa-executivo] ${exec.slug}: mensagem gravada no deal ${r.deal_id}`); })
    .catch((err) => console.error(`[wa-executivo] ${exec.slug}: falha ao gravar`, err));
});

export default router;
