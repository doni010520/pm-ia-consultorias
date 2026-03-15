import { Router } from 'express';
import { query, getProjectMetrics } from '../services/database.js';
import { generateReport } from '../services/ai.js';

const router = Router();

/**
 * GET /api/reports
 * Lista relatórios gerados
 */
router.get('/', async (req, res, next) => {
  try {
    const { organization_id, project_id, type, limit } = req.query;
    const orgId = organization_id || process.env.DEFAULT_ORGANIZATION_ID;
    
    let sql = `
      SELECT r.*, p.name as project_name, c.name as client_name
      FROM reports r
      LEFT JOIN projects p ON r.project_id = p.id
      LEFT JOIN clients c ON r.client_id = c.id
      WHERE r.organization_id = $1
    `;
    const params = [orgId];
    let paramIndex = 2;
    
    if (project_id) {
      sql += ` AND r.project_id = $${paramIndex++}`;
      params.push(project_id);
    }
    
    if (type) {
      sql += ` AND r.type = $${paramIndex++}`;
      params.push(type);
    }
    
    sql += ` ORDER BY r.created_at DESC LIMIT $${paramIndex}`;
    params.push(parseInt(limit) || 20);
    
    const result = await query(sql, params);
    
    res.json({ reports: result.rows, count: result.rows.length });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/reports/generate
 * Gera um novo relatório
 */
router.post('/generate', async (req, res, next) => {
  try {
    const { 
      organization_id,
      project_id, 
      type = 'weekly_status',
      period_start,
      period_end 
    } = req.body;
    
    if (!project_id) {
      return res.status(400).json({ error: { message: 'project_id é obrigatório' } });
    }
    
    const orgId = organization_id || process.env.DEFAULT_ORGANIZATION_ID;
    
    // Buscar dados do projeto
    const projectResult = await query(`
      SELECT p.*, c.name as client_name, c.contact_email as client_email
      FROM projects p
      LEFT JOIN clients c ON p.client_id = c.id
      WHERE p.id = $1
    `, [project_id]);
    
    if (projectResult.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Projeto não encontrado' } });
    }
    
    const project = projectResult.rows[0];
    
    // Definir período
    const endDate = period_end ? new Date(period_end) : new Date();
    let startDate;
    
    if (period_start) {
      startDate = new Date(period_start);
    } else {
      // Padrão: última semana para weekly, último mês para monthly
      startDate = new Date(endDate);
      if (type === 'monthly_closing') {
        startDate.setMonth(startDate.getMonth() - 1);
      } else {
        startDate.setDate(startDate.getDate() - 7);
      }
    }
    
    // Buscar métricas do período
    const metricsResult = await query(`
      SELECT 
        COUNT(DISTINCT t.id) FILTER (WHERE t.status != 'cancelled') as total_tasks,
        COUNT(DISTINCT t.id) FILTER (WHERE t.status = 'done' AND t.completed_at >= $2) as completed_tasks,
        COUNT(DISTINCT t.id) FILTER (WHERE t.status NOT IN ('done', 'cancelled') AND t.due_date < NOW()) as overdue_tasks,
        COALESCE(SUM(te.hours), 0) as total_hours,
        COALESCE(SUM(te.hours) FILTER (WHERE te.is_billable), 0) as billable_hours
      FROM projects p
      LEFT JOIN tasks t ON t.project_id = p.id
      LEFT JOIN time_entries te ON te.project_id = p.id AND te.date BETWEEN $2 AND $3
      WHERE p.id = $1
      GROUP BY p.id
    `, [project_id, startDate.toISOString().split('T')[0], endDate.toISOString().split('T')[0]]);
    
    // Buscar tarefas concluídas no período
    const tasksResult = await query(`
      SELECT title, completed_at, assignee_id
      FROM tasks
      WHERE project_id = $1 
        AND status = 'done' 
        AND completed_at >= $2
      ORDER BY completed_at DESC
    `, [project_id, startDate.toISOString()]);
    
    const metrics = {
      ...metricsResult.rows[0],
      progress_percent: project.progress_percent,
      budget_hours: project.budget_hours,
      completed_tasks_list: tasksResult.rows.map(t => t.title),
      period: {
        start: startDate.toISOString().split('T')[0],
        end: endDate.toISOString().split('T')[0]
      }
    };
    
    // Gerar relatório com IA
    const reportResult = await generateReport(type, project, metrics);
    
    if (!reportResult.success) {
      return res.status(500).json({ 
        error: { message: 'Erro ao gerar relatório', details: reportResult.error } 
      });
    }
    
    // Salvar relatório no banco
    const saveResult = await query(`
      INSERT INTO reports (
        organization_id, project_id, client_id, type,
        period_start, period_end, title, content_markdown, metrics
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `, [
      orgId,
      project_id,
      project.client_id,
      type,
      startDate.toISOString().split('T')[0],
      endDate.toISOString().split('T')[0],
      `Relatório ${type === 'weekly_status' ? 'Semanal' : type === 'monthly_closing' ? 'Mensal' : 'Executivo'} - ${project.name}`,
      reportResult.content,
      JSON.stringify(metrics)
    ]);
    
    res.status(201).json({
      report: saveResult.rows[0],
      content: reportResult.content,
      model: reportResult.model,
      latency_ms: reportResult.latency
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/reports/:id
 * Detalhes de um relatório
 */
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    
    const result = await query(`
      SELECT r.*, p.name as project_name, c.name as client_name
      FROM reports r
      LEFT JOIN projects p ON r.project_id = p.id
      LEFT JOIN clients c ON r.client_id = c.id
      WHERE r.id = $1
    `, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Relatório não encontrado' } });
    }
    
    res.json({ report: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

export default router;
