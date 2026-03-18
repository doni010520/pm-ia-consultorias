import { Router } from 'express';
import { query } from '../services/database.js';

const router = Router();

/**
 * GET /api/allocations/dashboard
 * Retorna visão geral de capacidade de todos os consultores
 */
router.get('/dashboard', async (req, res, next) => {
  try {
    const orgId = req.organizationId;

    // Buscar todos os usuários ativos com suas alocações
    const result = await query(
      `SELECT
        u.id,
        u.name,
        u.email,
        u.role,
        u.weekly_capacity,
        COALESCE(SUM(pm.hours_per_week) FILTER (WHERE pm.is_active = true AND p.status = 'active'), 0) as allocated_hours,
        json_agg(
          json_build_object(
            'project_id', p.id,
            'project_name', p.name,
            'hours_per_week', pm.hours_per_week,
            'role', pm.role,
            'start_date', pm.start_date,
            'end_date', pm.end_date
          ) ORDER BY pm.hours_per_week DESC
        ) FILTER (WHERE pm.id IS NOT NULL AND pm.is_active = true AND p.status = 'active') as projects
      FROM users u
      LEFT JOIN project_members pm ON pm.user_id = u.id AND pm.is_active = true
      LEFT JOIN projects p ON p.id = pm.project_id AND p.status = 'active'
      WHERE u.organization_id = $1 AND u.is_active = true
      GROUP BY u.id, u.name, u.email, u.role, u.weekly_capacity
      ORDER BY u.name ASC`,
      [orgId]
    );

    const consultants = result.rows.map(row => ({
      ...row,
      weekly_capacity: parseFloat(row.weekly_capacity) || 40,
      allocated_hours: parseFloat(row.allocated_hours) || 0,
      available_hours: (parseFloat(row.weekly_capacity) || 40) - (parseFloat(row.allocated_hours) || 0),
      utilization_percent: Math.round(((parseFloat(row.allocated_hours) || 0) / (parseFloat(row.weekly_capacity) || 40)) * 100),
      projects: row.projects || [],
    }));

    // Métricas globais
    const totalCapacity = consultants.reduce((sum, c) => sum + c.weekly_capacity, 0);
    const totalAllocated = consultants.reduce((sum, c) => sum + c.allocated_hours, 0);
    const overallocated = consultants.filter(c => c.utilization_percent > 100);
    const underutilized = consultants.filter(c => c.utilization_percent < 50);

    res.json({
      consultants,
      summary: {
        total_consultants: consultants.length,
        total_capacity: totalCapacity,
        total_allocated: totalAllocated,
        total_available: totalCapacity - totalAllocated,
        avg_utilization: consultants.length > 0
          ? Math.round((totalAllocated / totalCapacity) * 100)
          : 0,
        overallocated_count: overallocated.length,
        underutilized_count: underutilized.length,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/allocations/project/:projectId
 * Retorna alocações de um projeto específico
 */
router.get('/project/:projectId', async (req, res, next) => {
  try {
    const { projectId } = req.params;

    const result = await query(
      `SELECT pm.*, u.name as user_name, u.email as user_email, u.weekly_capacity
       FROM project_members pm
       JOIN users u ON u.id = pm.user_id
       WHERE pm.project_id = $1 AND pm.is_active = true
       ORDER BY pm.hours_per_week DESC`,
      [projectId]
    );

    const totalHours = result.rows.reduce((sum, r) => sum + (parseFloat(r.hours_per_week) || 0), 0);

    res.json({ allocations: result.rows, total_hours_per_week: totalHours });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/allocations
 * Cria ou atualiza alocação de consultor em projeto
 * Body: { user_id, project_id, hours_per_week, role?, start_date?, end_date? }
 */
router.post('/', async (req, res, next) => {
  try {
    const { user_id, project_id, hours_per_week, role = 'member', start_date, end_date } = req.body;

    if (!user_id || !project_id) {
      return res.status(400).json({ error: { message: 'user_id e project_id são obrigatórios' } });
    }

    if (hours_per_week === undefined || hours_per_week < 0) {
      return res.status(400).json({ error: { message: 'hours_per_week deve ser >= 0' } });
    }

    const result = await query(
      `INSERT INTO project_members (project_id, user_id, hours_per_week, role, start_date, end_date, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, true)
       ON CONFLICT (project_id, user_id) DO UPDATE SET
         hours_per_week = EXCLUDED.hours_per_week,
         role = EXCLUDED.role,
         start_date = EXCLUDED.start_date,
         end_date = EXCLUDED.end_date,
         is_active = true
       RETURNING *`,
      [project_id, user_id, hours_per_week, role, start_date || null, end_date || null]
    );

    res.json({ allocation: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /api/allocations/:projectId/:userId
 * Atualiza horas de uma alocação
 * Body: { hours_per_week?, role?, start_date?, end_date? }
 */
router.patch('/:projectId/:userId', async (req, res, next) => {
  try {
    const { projectId, userId } = req.params;
    const { hours_per_week, role, start_date, end_date } = req.body;

    const fields = [];
    const values = [];
    let idx = 1;

    if (hours_per_week !== undefined) { fields.push(`hours_per_week = $${idx++}`); values.push(hours_per_week); }
    if (role !== undefined) { fields.push(`role = $${idx++}`); values.push(role); }
    if (start_date !== undefined) { fields.push(`start_date = $${idx++}`); values.push(start_date); }
    if (end_date !== undefined) { fields.push(`end_date = $${idx++}`); values.push(end_date); }

    if (fields.length === 0) {
      return res.status(400).json({ error: { message: 'Nenhum campo para atualizar' } });
    }

    values.push(projectId, userId);
    const result = await query(
      `UPDATE project_members SET ${fields.join(', ')} WHERE project_id = $${idx++} AND user_id = $${idx}
       RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Alocação não encontrada' } });
    }

    res.json({ allocation: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/allocations/:projectId/:userId
 * Remove alocação (soft delete)
 */
router.delete('/:projectId/:userId', async (req, res, next) => {
  try {
    const { projectId, userId } = req.params;

    const result = await query(
      `UPDATE project_members SET is_active = false WHERE project_id = $1 AND user_id = $2 RETURNING id`,
      [projectId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Alocação não encontrada' } });
    }

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /api/allocations/capacity/:userId
 * Atualiza capacidade semanal do consultor
 * Body: { weekly_capacity }
 */
router.patch('/capacity/:userId', async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { weekly_capacity } = req.body;

    if (weekly_capacity === undefined || weekly_capacity < 0) {
      return res.status(400).json({ error: { message: 'weekly_capacity deve ser >= 0' } });
    }

    const result = await query(
      `UPDATE users SET weekly_capacity = $1 WHERE id = $2 RETURNING id, name, weekly_capacity`,
      [weekly_capacity, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Usuário não encontrado' } });
    }

    res.json({ user: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

export default router;
