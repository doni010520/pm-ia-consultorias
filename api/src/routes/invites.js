import { Router } from 'express';
import crypto from 'crypto';
import { query, getClient } from '../services/database.js';
import { hashPassword } from '../services/auth.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { sendInviteEmail } from '../services/email.js';

const router = Router();

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

// ============================================
// Rotas protegidas (admin only)
// ============================================

/**
 * POST /api/invites
 * Cria convite e envia email
 */
router.post('/', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const { name, email, role = 'member', whatsapp } = req.body;

    if (!name || !email) {
      return res.status(400).json({ error: { message: 'Nome e email são obrigatórios' } });
    }

    const validRoles = ['admin', 'manager', 'member'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: { message: `Role inválido. Use: ${validRoles.join(', ')}` } });
    }

    const orgId = req.organizationId;

    // Verificar se já existe usuário ativo com esse email
    const existingUser = await query(
      'SELECT id FROM users WHERE email = $1 AND organization_id = $2 AND is_active = true',
      [email.toLowerCase().trim(), orgId]
    );
    if (existingUser.rows.length > 0) {
      return res.status(409).json({ error: { message: 'Já existe um usuário ativo com esse email' } });
    }

    // Verificar se já existe convite pendente
    const existingInvite = await query(
      `SELECT id FROM invites WHERE email = $1 AND organization_id = $2 AND status = 'pending' AND expires_at > NOW()`,
      [email.toLowerCase().trim(), orgId]
    );
    if (existingInvite.rows.length > 0) {
      return res.status(409).json({ error: { message: 'Já existe um convite pendente para esse email' } });
    }

    // Gerar token
    const token = crypto.randomBytes(32).toString('hex');

    // Inserir convite
    const result = await query(
      `INSERT INTO invites (organization_id, email, name, role, whatsapp, token, invited_by_id, status, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', NOW() + INTERVAL '7 days')
       RETURNING *`,
      [orgId, email.toLowerCase().trim(), name, role, whatsapp || null, token, req.user.id]
    );

    const invite = result.rows[0];

    // Enviar email
    const inviteLink = `${FRONTEND_URL}/invite/${token}`;
    const emailResult = await sendInviteEmail({
      to: invite.email,
      inviteeName: invite.name,
      inviterName: req.user.name,
      role: invite.role,
      inviteLink,
      organizationName: 'PM-IA',
    });

    res.status(201).json({
      invite,
      email_sent: emailResult.success,
      invite_link: inviteLink,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/invites
 * Lista convites da organização
 */
router.get('/', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const orgId = req.organizationId;
    const { status } = req.query;

    let sql = `
      SELECT i.*, u.name as invited_by_name
      FROM invites i
      LEFT JOIN users u ON u.id = i.invited_by_id
      WHERE i.organization_id = $1
    `;
    const params = [orgId];

    if (status) {
      sql += ' AND i.status = $2';
      params.push(status);
    }

    sql += ' ORDER BY i.created_at DESC';

    const result = await query(sql, params);

    res.json({ invites: result.rows, count: result.rows.length });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/invites/:id/resend
 * Reenvia email de convite
 */
router.post('/:id/resend', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const orgId = req.organizationId;

    const result = await query(
      `UPDATE invites SET expires_at = NOW() + INTERVAL '7 days', updated_at = NOW()
       WHERE id = $1 AND organization_id = $2 AND status = 'pending'
       RETURNING *`,
      [id, orgId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Convite não encontrado ou já foi aceito/cancelado' } });
    }

    const invite = result.rows[0];

    const inviteLink = `${FRONTEND_URL}/invite/${invite.token}`;
    const emailResult = await sendInviteEmail({
      to: invite.email,
      inviteeName: invite.name,
      inviterName: req.user.name,
      role: invite.role,
      inviteLink,
      organizationName: 'PM-IA',
    });

    res.json({ invite, email_sent: emailResult.success, invite_link: inviteLink });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/invites/:id
 * Cancela convite
 */
router.delete('/:id', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const orgId = req.organizationId;

    const result = await query(
      `UPDATE invites SET status = 'cancelled', updated_at = NOW()
       WHERE id = $1 AND organization_id = $2 AND status = 'pending'
       RETURNING id`,
      [id, orgId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Convite não encontrado ou já foi aceito/cancelado' } });
    }

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// ============================================
// Rotas públicas (sem auth)
// ============================================

/**
 * GET /api/invites/verify/:token
 * Verifica se token de convite é válido
 */
router.get('/verify/:token', async (req, res, next) => {
  try {
    const { token } = req.params;

    const result = await query(
      `SELECT id, name, email, role, status, expires_at
       FROM invites WHERE token = $1`,
      [token]
    );

    if (result.rows.length === 0) {
      return res.json({ valid: false, reason: 'Convite não encontrado' });
    }

    const invite = result.rows[0];

    if (invite.status !== 'pending') {
      return res.json({ valid: false, reason: 'Este convite já foi utilizado ou cancelado' });
    }

    if (new Date(invite.expires_at) < new Date()) {
      return res.json({ valid: false, reason: 'Este convite expirou' });
    }

    res.json({
      valid: true,
      invite: { name: invite.name, email: invite.email, role: invite.role },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/invites/accept
 * Aceita convite e cria conta com senha
 */
router.post('/accept', async (req, res, next) => {
  const client = await getClient();

  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).json({ error: { message: 'Token e senha são obrigatórios' } });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: { message: 'A senha deve ter pelo menos 6 caracteres' } });
    }

    await client.query('BEGIN');

    // Buscar convite com lock para evitar race condition
    const inviteResult = await client.query(
      `SELECT * FROM invites WHERE token = $1 AND status = 'pending' FOR UPDATE`,
      [token]
    );

    if (inviteResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: { message: 'Convite inválido ou já utilizado' } });
    }

    const invite = inviteResult.rows[0];

    if (new Date(invite.expires_at) < new Date()) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: { message: 'Este convite expirou' } });
    }

    // Hash da senha
    const password_hash = await hashPassword(password);

    // Criar usuário
    const userResult = await client.query(
      `INSERT INTO users (organization_id, name, email, whatsapp, password_hash, role, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, true)
       ON CONFLICT (organization_id, email) DO UPDATE SET
         password_hash = EXCLUDED.password_hash,
         name = EXCLUDED.name,
         whatsapp = COALESCE(EXCLUDED.whatsapp, users.whatsapp),
         role = EXCLUDED.role,
         is_active = true
       RETURNING id, name, email, role, organization_id`,
      [invite.organization_id, invite.name, invite.email, invite.whatsapp || null, password_hash, invite.role]
    );

    // Marcar convite como aceito
    await client.query(
      `UPDATE invites SET status = 'accepted', accepted_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [invite.id]
    );

    await client.query('COMMIT');

    res.status(201).json({ user: userResult.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally {
    client.release();
  }
});

export default router;
