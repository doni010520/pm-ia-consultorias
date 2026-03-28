import { Router } from 'express';
import crypto from 'crypto';
import { query } from '../services/database.js';
import { hashPassword, comparePassword, generateToken } from '../services/auth.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/auth.js';
import { sendPasswordResetEmail } from '../services/email.js';

const router = Router();

/**
 * POST /api/auth/login
 * Body: { email, password }
 * Returns: { token, user }
 */
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: { message: 'Email e senha são obrigatórios' } });
    }

    const result = await query(
      'SELECT id, name, email, role, organization_id, password_hash FROM users WHERE email = $1 AND is_active = true',
      [email.toLowerCase().trim()]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: { message: 'Email ou senha incorretos' } });
    }

    const user = result.rows[0];

    if (!user.password_hash) {
      return res.status(401).json({ error: { message: 'Usuário sem senha configurada. Contate o admin.' } });
    }

    const valid = await comparePassword(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: { message: 'Email ou senha incorretos' } });
    }

    const token = generateToken(user);

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        organization_id: user.organization_id,
      },
    });
  } catch (error) {
    next(error);
  }
});

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

/**
 * POST /api/auth/forgot-password
 * Body: { email }
 * Envia email com link de reset
 */
router.post('/forgot-password', async (req, res, next) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: { message: 'Email e obrigatorio' } });
    }

    const result = await query(
      'SELECT id, name, email FROM users WHERE email = $1 AND is_active = true',
      [email.toLowerCase().trim()]
    );

    // Sempre retorna sucesso para nao revelar se email existe
    if (result.rows.length === 0) {
      return res.json({ success: true, message: 'Se o email existir, enviaremos um link de redefinicao' });
    }

    const user = result.rows[0];
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hora

    // Salvar token no banco (invalidar tokens anteriores)
    await query(
      `UPDATE users SET
        reset_token = $1,
        reset_token_expires = $2,
        updated_at = NOW()
       WHERE id = $3`,
      [token, expiresAt, user.id]
    );

    const resetLink = `${FRONTEND_URL}/reset-password/${token}`;
    await sendPasswordResetEmail({
      to: user.email,
      userName: user.name,
      resetLink,
    });

    res.json({ success: true, message: 'Se o email existir, enviaremos um link de redefinicao' });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/auth/reset-password
 * Body: { token, password }
 * Redefine a senha usando o token
 */
router.post('/reset-password', async (req, res, next) => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).json({ error: { message: 'Token e senha sao obrigatorios' } });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: { message: 'A senha deve ter pelo menos 6 caracteres' } });
    }

    const result = await query(
      'SELECT id, name, email FROM users WHERE reset_token = $1 AND reset_token_expires > NOW() AND is_active = true',
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: { message: 'Link invalido ou expirado. Solicite um novo.' } });
    }

    const user = result.rows[0];
    const password_hash = await hashPassword(password);

    await query(
      `UPDATE users SET
        password_hash = $1,
        reset_token = NULL,
        reset_token_expires = NULL,
        updated_at = NOW()
       WHERE id = $2`,
      [password_hash, user.id]
    );

    res.json({ success: true, message: 'Senha redefinida com sucesso' });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/auth/me
 * Protected: requires JWT
 * Returns: { user }
 */
router.get('/me', requireAuth, async (req, res) => {
  res.json({ user: req.user });
});

/**
 * POST /api/auth/register
 * Protected: admin only
 * Body: { name, email, password, role, whatsapp, hourly_rate }
 * Returns: { user }
 */
router.post('/register', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const { name, email, password, role = 'member', whatsapp, hourly_rate } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: { message: 'Nome, email e senha são obrigatórios' } });
    }

    const existing = await query('SELECT id FROM users WHERE email = $1', [email.toLowerCase().trim()]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: { message: 'Email já cadastrado' } });
    }

    const password_hash = await hashPassword(password);
    const orgId = req.organizationId || process.env.DEFAULT_ORGANIZATION_ID;

    const result = await query(
      `INSERT INTO users (organization_id, name, email, password_hash, role, whatsapp, hourly_rate)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, name, email, role, organization_id, whatsapp, hourly_rate, created_at`,
      [orgId, name, email.toLowerCase().trim(), password_hash, role, whatsapp || null, hourly_rate || null]
    );

    res.status(201).json({ user: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/auth/users
 * Protected: requires JWT
 * Returns: { users, count }
 */
router.get('/users', requireAuth, async (req, res, next) => {
  try {
    const orgId = req.organizationId;

    const result = await query(
      `SELECT id, name, email, role, whatsapp, hourly_rate, is_active, created_at
       FROM users WHERE organization_id = $1
       ORDER BY name ASC`,
      [orgId]
    );

    res.json({ users: result.rows, count: result.rows.length });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /api/auth/users/:userId — Editar membro da equipe
 */
router.patch('/users/:userId', async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { name, email, whatsapp, hourly_rate, role } = req.body;

    const fields = [];
    const values = [];
    let idx = 1;

    if (name !== undefined) { fields.push(`name = $${idx++}`); values.push(name); }
    if (email !== undefined) { fields.push(`email = $${idx++}`); values.push(email); }
    if (whatsapp !== undefined) { fields.push(`whatsapp = $${idx++}`); values.push(whatsapp); }
    if (hourly_rate !== undefined) { fields.push(`hourly_rate = $${idx++}`); values.push(hourly_rate); }
    if (role !== undefined) { fields.push(`role = $${idx++}`); values.push(role); }

    if (fields.length === 0) {
      return res.status(400).json({ error: { message: 'Nenhum campo para atualizar' } });
    }

    fields.push('updated_at = NOW()');
    values.push(userId);

    const result = await query(
      `UPDATE users SET ${fields.join(', ')} WHERE id = $${idx} RETURNING id, name, email, role, whatsapp, hourly_rate, is_active`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Usuario nao encontrado' } });
    }

    res.json({ user: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

export default router;
