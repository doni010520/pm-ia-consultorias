import { Router } from 'express';
import { query } from '../services/database.js';

const router = Router();

/**
 * GET /api/alerts/today
 * Tarefas do dia - para tela da app e para n8n (notificacoes)
 * Query: organization_id, assignee_id
 */
router.get('/today', async (req, res, next) => {
  try {
    const orgId = req.query.organization_id || process.env.DEFAULT_ORGANIZATION_ID;
    if (!orgId) {
      return res.status(400).json({ error: 'organization_id e obrigatorio' });
    }

    let sql = `
      SELECT t.*, u.name as assignee_name, u.email as assignee_email,
             p.name as project_name, p.client_id,
             c.name as client_name
      FROM tasks t
      LEFT JOIN users u ON t.assignee_id = u.id
      LEFT JOIN projects p ON t.project_id = p.id
      LEFT JOIN clients c ON p.client_id = c.id
      WHERE t.organization_id = $1
        AND t.status NOT IN ('done', 'cancelled')
        AND t.due_date::date = CURRENT_DATE
    `;
    const params = [orgId];
    let paramIndex = 2;

    if (req.query.assignee_id) {
      sql += ` AND t.assignee_id = $${paramIndex++}`;
      params.push(req.query.assignee_id);
    }

    sql += ` ORDER BY t.priority DESC, t.due_date ASC`;

    const result = await query(sql, params);

    res.json({
      date: new Date().toISOString().split('T')[0],
      tasks: result.rows,
      total: result.rows.length
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/alerts/overdue
 * Tarefas atrasadas - para tela da app e para n8n (notificacoes)
 * Query: organization_id, assignee_id, project_id
 */
router.get('/overdue', async (req, res, next) => {
  try {
    const orgId = req.query.organization_id || process.env.DEFAULT_ORGANIZATION_ID;
    if (!orgId) {
      return res.status(400).json({ error: 'organization_id e obrigatorio' });
    }

    let sql = `
      SELECT t.*, u.name as assignee_name, u.email as assignee_email,
             p.name as project_name, p.client_id,
             c.name as client_name,
             (CURRENT_DATE - t.due_date::date) as days_overdue
      FROM tasks t
      LEFT JOIN users u ON t.assignee_id = u.id
      LEFT JOIN projects p ON t.project_id = p.id
      LEFT JOIN clients c ON p.client_id = c.id
      WHERE t.organization_id = $1
        AND t.status NOT IN ('done', 'cancelled')
        AND t.due_date < CURRENT_DATE
    `;
    const params = [orgId];
    let paramIndex = 2;

    if (req.query.assignee_id) {
      sql += ` AND t.assignee_id = $${paramIndex++}`;
      params.push(req.query.assignee_id);
    }

    if (req.query.project_id) {
      sql += ` AND t.project_id = $${paramIndex++}`;
      params.push(req.query.project_id);
    }

    sql += ` ORDER BY t.due_date ASC`;

    const result = await query(sql, params);

    res.json({
      tasks: result.rows,
      total: result.rows.length
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/alerts/summary
 * Resumo consolidado para notificacoes (ideal para n8n enviar via WhatsApp)
 * Query: organization_id
 * Retorna: tarefas do dia, atrasadas, e proximas entregas (7 dias)
 */
router.get('/summary', async (req, res, next) => {
  try {
    const orgId = req.query.organization_id || process.env.DEFAULT_ORGANIZATION_ID;
    if (!orgId) {
      return res.status(400).json({ error: 'organization_id e obrigatorio' });
    }

    // Tarefas do dia
    const todayResult = await query(`
      SELECT t.title, t.priority, u.name as assignee_name, p.name as project_name
      FROM tasks t
      LEFT JOIN users u ON t.assignee_id = u.id
      LEFT JOIN projects p ON t.project_id = p.id
      WHERE t.organization_id = $1
        AND t.status NOT IN ('done', 'cancelled')
        AND t.due_date::date = CURRENT_DATE
      ORDER BY t.priority DESC
    `, [orgId]);

    // Tarefas atrasadas
    const overdueResult = await query(`
      SELECT t.title, t.priority, u.name as assignee_name, p.name as project_name,
             (CURRENT_DATE - t.due_date::date) as days_overdue
      FROM tasks t
      LEFT JOIN users u ON t.assignee_id = u.id
      LEFT JOIN projects p ON t.project_id = p.id
      WHERE t.organization_id = $1
        AND t.status NOT IN ('done', 'cancelled')
        AND t.due_date < CURRENT_DATE
      ORDER BY t.due_date ASC
    `, [orgId]);

    // Proximas entregas (7 dias)
    const upcomingResult = await query(`
      SELECT t.title, t.priority, t.due_date, u.name as assignee_name, p.name as project_name
      FROM tasks t
      LEFT JOIN users u ON t.assignee_id = u.id
      LEFT JOIN projects p ON t.project_id = p.id
      WHERE t.organization_id = $1
        AND t.status NOT IN ('done', 'cancelled')
        AND t.due_date::date > CURRENT_DATE
        AND t.due_date::date <= CURRENT_DATE + INTERVAL '7 days'
      ORDER BY t.due_date ASC
    `, [orgId]);

    // Projetos em risco
    const riskyProjectsResult = await query(`
      SELECT p.name, p.due_date,
             COUNT(t.id) FILTER (WHERE t.status NOT IN ('done', 'cancelled') AND t.due_date < CURRENT_DATE) as overdue_tasks,
             COUNT(t.id) FILTER (WHERE t.status NOT IN ('done', 'cancelled')) as total_open_tasks
      FROM projects p
      LEFT JOIN tasks t ON t.project_id = p.id
      WHERE p.organization_id = $1 AND p.status = 'active'
      GROUP BY p.id
      HAVING COUNT(t.id) FILTER (WHERE t.status NOT IN ('done', 'cancelled') AND t.due_date < CURRENT_DATE) > 0
      ORDER BY COUNT(t.id) FILTER (WHERE t.status NOT IN ('done', 'cancelled') AND t.due_date < CURRENT_DATE) DESC
    `, [orgId]);

    res.json({
      date: new Date().toISOString().split('T')[0],
      today: {
        tasks: todayResult.rows,
        total: todayResult.rows.length
      },
      overdue: {
        tasks: overdueResult.rows,
        total: overdueResult.rows.length
      },
      upcoming_7_days: {
        tasks: upcomingResult.rows,
        total: upcomingResult.rows.length
      },
      risky_projects: {
        projects: riskyProjectsResult.rows,
        total: riskyProjectsResult.rows.length
      }
    });
  } catch (error) {
    next(error);
  }
});

export default router;
