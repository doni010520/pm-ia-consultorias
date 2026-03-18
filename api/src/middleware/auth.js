import { verifyToken } from '../services/auth.js';
import { query } from '../services/database.js';

/**
 * Middleware: exige autenticação JWT.
 * Fallback: permite requests com organization_id no query (para n8n/webhooks).
 */
export async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (authHeader?.startsWith('Bearer ')) {
    try {
      const token = authHeader.slice(7);
      const decoded = verifyToken(token);

      const result = await query(
        'SELECT id, name, email, role, organization_id FROM users WHERE id = $1 AND is_active = true',
        [decoded.userId]
      );

      if (result.rows.length === 0) {
        return res.status(401).json({ error: { message: 'Usuário inativo ou não encontrado' } });
      }

      req.user = result.rows[0];
      req.organizationId = result.rows[0].organization_id;
      return next();
    } catch (err) {
      return res.status(401).json({ error: { message: 'Token inválido ou expirado' } });
    }
  }

  // Fallback para n8n/webhooks: aceitar organization_id sem token
  const orgId = req.query.organization_id || req.body?.organization_id;
  if (orgId) {
    req.organizationId = orgId;
    return next();
  }

  return res.status(401).json({ error: { message: 'Token de autenticação não fornecido' } });
}

/**
 * Middleware: exige role específica (admin, manager, member).
 */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: { message: 'Não autenticado' } });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: { message: 'Sem permissão para esta ação' } });
    }
    next();
  };
}
