import { Router } from 'express';
import { query } from '../services/database.js';
import { hashPassword, comparePassword, generateToken } from '../services/auth.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/auth.js';

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

export default router;
