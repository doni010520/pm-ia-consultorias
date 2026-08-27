import crypto from 'crypto';
import { verifyToken } from '../services/auth.js';
import { query } from '../services/database.js';

let avisoServicoEmitido = false;

/**
 * Aviso único (no boot) de que a API está sem SERVICE_API_KEY configurada e,
 * portanto, o fallback por organization_id continua aberto a qualquer request.
 */
export function avisarSeSemServiceKey() {
  if (avisoServicoEmitido || process.env.SERVICE_API_KEY) return;
  avisoServicoEmitido = true;
  console.warn(
    '⚠️  SERVICE_API_KEY não configurada: o fallback por organization_id aceita ' +
    'qualquer request SEM autenticação. Configure SERVICE_API_KEY na API e o header ' +
    'x-service-token no rica-bot para fechar esse acesso.'
  );
}

/**
 * Compara o header x-service-token com a SERVICE_API_KEY em tempo constante.
 * Usa os digests SHA-256 para suportar strings de tamanhos diferentes sem
 * estourar exceção no timingSafeEqual (que exige buffers do mesmo tamanho).
 */
function tokenDeServicoValido(headerToken, serviceKey) {
  if (typeof headerToken !== 'string' || headerToken.length === 0) return false;

  const recebido = crypto.createHash('sha256').update(headerToken, 'utf8').digest();
  const esperado = crypto.createHash('sha256').update(serviceKey, 'utf8').digest();

  return crypto.timingSafeEqual(recebido, esperado);
}

/**
 * Middleware: exige autenticação JWT.
 * Fallback: permite requests com organization_id no query (para n8n/webhooks).
 * Se SERVICE_API_KEY estiver definida, o fallback só vale com o header
 * x-service-token correspondente (marca req.actorType = 'rica').
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
    const serviceKey = process.env.SERVICE_API_KEY;

    // Sem SERVICE_API_KEY o fallback segue aberto (transição, para não derrubar
    // o rica-bot antes da env var ser configurada) — mas avisa nos logs.
    if (!serviceKey) {
      avisarSeSemServiceKey();
      req.organizationId = orgId;
      return next();
    }

    if (!tokenDeServicoValido(req.headers['x-service-token'], serviceKey)) {
      return res.status(401).json({ error: { message: 'Token de serviço inválido ou não fornecido' } });
    }

    req.organizationId = orgId;
    req.actorType = 'rica';
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
