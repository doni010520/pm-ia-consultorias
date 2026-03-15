import { Router } from 'express';
import { query, getProjectMetrics, getActiveProjects, saveRiskAlert } from '../services/database.js';
import { analyzeProjectRisk } from '../services/ai.js';
import { sendRiskAlert } from '../services/whatsapp.js';

const router = Router();

/**
 * GET /api/projects
 * Lista projetos
 */
router.get('/', async (req, res, next) => {
  try {
    const { organization_id, client_id, status } = req.query;
    const orgId = organization_id || process.env.DEFAULT_ORGANIZATION_ID;
    
    let sql = `
      SELECT p.*, c.name as client_name,
             COUNT(DISTINCT t.id) FILTER (WHERE t.status != 'cancelled') as total_tasks,
             COUNT(DISTINCT t.id) FILTER (WHERE t.status = 'done') as completed_tasks
      FROM projects p
      LEFT JOIN clients c ON p.client_id = c.id
      LEFT JOIN tasks t ON t.project_id = p.id
      WHERE p.organization_id = $1
    `;
    const params = [orgId];
    let paramIndex = 2;
    
    if (client_id) {
      sql += ` AND p.client_id = $${paramIndex++}`;
      params.push(client_id);
    }
    
    if (status) {
      sql += ` AND p.status = $${paramIndex++}`;
      params.push(status);
    }
    
    sql += ` GROUP BY p.id, c.name ORDER BY p.created_at DESC`;
    
    const result = await query(sql, params);
    
    res.json({ projects: result.rows, count: result.rows.length });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/projects/:id
 * Detalhes de um projeto
 */
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    
    const result = await query(`
      SELECT p.*, c.name as client_name, c.contact_email as client_email
      FROM projects p
      LEFT JOIN clients c ON p.client_id = c.id
      WHERE p.id = $1
    `, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Projeto não encontrado' } });
    }
    
    res.json({ project: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/projects/:id/metrics
 * Métricas do projeto (para dashboards e análise de risco)
 */
router.get('/:id/metrics', async (req, res, next) => {
  try {
    const { id } = req.params;
    
    const metrics = await getProjectMetrics(id);
    
    if (!metrics) {
      return res.status(404).json({ error: { message: 'Projeto não encontrado' } });
    }
    
    res.json({ metrics });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/projects/:id/risk-analysis
 * Análise de risco com IA
 */
router.get('/:id/risk-analysis', async (req, res, next) => {
  try {
    const { id } = req.params;
    
    // Buscar dados do projeto
    const projectResult = await query(`
      SELECT p.*, c.name as client_name
      FROM projects p
      LEFT JOIN clients c ON p.client_id = c.id
      WHERE p.id = $1
    `, [id]);
    
    if (projectResult.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Projeto não encontrado' } });
    }
    
    const project = projectResult.rows[0];
    
    // Buscar métricas
    const metrics = await getProjectMetrics(id);
    
    // Analisar com IA
    const analysis = await analyzeProjectRisk(project, metrics);
    
    res.json({
      project: {
        id: project.id,
        name: project.name,
        client: project.client_name
      },
      metrics,
      analysis: analysis.success ? analysis.content : null,
      model: analysis.model,
      latency_ms: analysis.latency,
      error: analysis.success ? null : analysis.error
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/projects/check-risks
 * Verifica riscos de todos os projetos ativos e gera alertas
 * Pode ser chamado por cron externo (ex: diariamente)
 */
router.post('/check-risks', async (req, res, next) => {
  try {
    const { organization_id, notify_whatsapp } = req.body;
    const orgId = organization_id || process.env.DEFAULT_ORGANIZATION_ID;

    const projects = await getActiveProjects(orgId);
    const alerts = [];

    for (const project of projects) {
      const metrics = await getProjectMetrics(project.id);
      if (!metrics) continue;

      // Verificar thresholds de risco
      const burnRate = parseFloat(metrics.burn_rate) || 0;
      const overdueRatio = parseFloat(metrics.overdue_ratio) || 0;
      const daysToDeadline = metrics.days_to_deadline;

      const isAtRisk = burnRate > 0.8 || overdueRatio > 0.3 ||
        (daysToDeadline !== null && daysToDeadline < 7 && overdueRatio > 0.1);

      if (!isAtRisk) continue;

      // Analisar com IA
      const analysis = await analyzeProjectRisk(project, metrics);

      if (!analysis.success) {
        console.error(`Erro na análise de risco do projeto ${project.name}:`, analysis.error);
        continue;
      }

      let parsedAnalysis;
      try {
        parsedAnalysis = typeof analysis.content === 'string' ? JSON.parse(analysis.content) : analysis.content;
      } catch {
        parsedAnalysis = { summary: analysis.content, severity: 'yellow', risk_score: 50 };
      }

      const severity = parsedAnalysis.severity || (burnRate > 1 || overdueRatio > 0.5 ? 'red' : 'yellow');
      const riskScore = parsedAnalysis.risk_score || Math.round((burnRate + overdueRatio) * 50);

      // Salvar alerta
      const alert = await saveRiskAlert({
        organization_id: orgId,
        project_id: project.id,
        severity,
        risk_score: riskScore,
        details: { metrics, analysis: parsedAnalysis }
      });

      alerts.push({
        project: { id: project.id, name: project.name, client: project.client_name },
        severity,
        risk_score: riskScore,
        alert_id: alert.id,
        analysis: parsedAnalysis
      });

      // Notificar gestores via WhatsApp se solicitado
      if (notify_whatsapp) {
        try {
          // Buscar gestores do projeto
          const managersResult = await query(
            `SELECT u.whatsapp FROM users u WHERE u.organization_id = $1 AND u.role IN ('admin', 'manager') AND u.whatsapp IS NOT NULL AND u.is_active = true`,
            [orgId]
          );

          for (const manager of managersResult.rows) {
            await sendRiskAlert(manager.whatsapp, {
              project_name: project.name,
              severity,
              risk_score: riskScore,
              summary: parsedAnalysis.summary || parsedAnalysis.root_causes?.join(', ') || 'Projeto em risco'
            });
          }
        } catch (notifyErr) {
          console.error(`Erro ao notificar sobre projeto ${project.name}:`, notifyErr);
        }
      }
    }

    res.json({
      checked: projects.length,
      alerts_generated: alerts.length,
      alerts
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/projects/:id/tasks
 * Tarefas de um projeto
 */
router.get('/:id/tasks', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.query;
    
    let sql = `
      SELECT t.*, u.name as assignee_name
      FROM tasks t
      LEFT JOIN users u ON t.assignee_id = u.id
      WHERE t.project_id = $1
    `;
    const params = [id];
    
    if (status) {
      sql += ` AND t.status = $2`;
      params.push(status);
    }
    
    sql += ` ORDER BY t.position, t.created_at`;
    
    const result = await query(sql, params);
    
    res.json({ tasks: result.rows, count: result.rows.length });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/projects/:id/time-entries
 * Registros de tempo de um projeto
 */
router.get('/:id/time-entries', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { start_date, end_date } = req.query;
    
    let sql = `
      SELECT te.*, u.name as user_name, t.title as task_title
      FROM time_entries te
      LEFT JOIN users u ON te.user_id = u.id
      LEFT JOIN tasks t ON te.task_id = t.id
      WHERE te.project_id = $1
    `;
    const params = [id];
    let paramIndex = 2;
    
    if (start_date) {
      sql += ` AND te.date >= $${paramIndex++}`;
      params.push(start_date);
    }
    
    if (end_date) {
      sql += ` AND te.date <= $${paramIndex++}`;
      params.push(end_date);
    }
    
    sql += ` ORDER BY te.date DESC, te.created_at DESC`;
    
    const result = await query(sql, params);
    
    // Calcular totais
    const totalHours = result.rows.reduce((sum, te) => sum + parseFloat(te.hours), 0);
    const billableHours = result.rows.filter(te => te.is_billable).reduce((sum, te) => sum + parseFloat(te.hours), 0);
    
    res.json({ 
      time_entries: result.rows, 
      count: result.rows.length,
      totals: {
        total_hours: totalHours.toFixed(2),
        billable_hours: billableHours.toFixed(2),
        non_billable_hours: (totalHours - billableHours).toFixed(2)
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/projects
 * Cria novo projeto
 */
router.post('/', async (req, res, next) => {
  try {
    const {
      organization_id,
      client_id,
      name,
      description,
      start_date,
      due_date,
      budget_hours,
      budget_value,
      billing_type
    } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: { message: 'Nome do projeto é obrigatório' } });
    }
    
    const result = await query(`
      INSERT INTO projects (
        organization_id, client_id, name, description,
        start_date, due_date, budget_hours, budget_value, billing_type
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `, [
      organization_id || process.env.DEFAULT_ORGANIZATION_ID,
      client_id,
      name,
      description,
      start_date,
      due_date,
      budget_hours,
      budget_value,
      billing_type || 'hourly'
    ]);
    
    res.status(201).json({ project: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

export default router;
