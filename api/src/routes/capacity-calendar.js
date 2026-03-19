import { Router } from 'express';
import { query } from '../services/database.js';
import {
  fetchConsultantData,
  fetchAllConsultantsData,
  generateDayCapacities,
  aggregateByWeek,
  aggregateByMonth,
} from '../services/capacity.js';

const router = Router();

// ============================================
// TIMELINE (Gantt) — visao geral da equipe
// ============================================
router.get('/timeline', async (req, res, next) => {
  try {
    const orgId = req.user?.organization_id || req.query.organization_id;
    const { start_date, end_date } = req.query;

    if (!start_date || !end_date) {
      return res.status(400).json({ error: { message: 'start_date e end_date sao obrigatorios' } });
    }

    const data = await fetchAllConsultantsData(orgId, start_date, end_date);

    const consultants = data.users.map((user) => {
      const userAllocations = data.allocations.filter((a) => a.user_id === user.id);
      const userBlocks = data.blocks.filter((b) => b.user_id === user.id);
      const userTasks = data.tasks.filter((t) => t.user_id === user.id);

      const days = generateDayCapacities(user, userAllocations, userBlocks, userTasks, start_date, end_date);
      const weeks = aggregateByWeek(days);

      // Segmentos de alocacao para barras do Gantt
      const allocationSegments = userAllocations.map((a) => ({
        project_id: a.project_id,
        project_name: a.project_name,
        color: a.color || '#3b82f6',
        hours_per_week: parseFloat(a.hours_per_week) || 0,
        start_date: a.start_date ? a.start_date.toISOString?.() || a.start_date : null,
        end_date: a.end_date ? a.end_date.toISOString?.() || a.end_date : null,
      }));

      // Segmentos de bloqueio
      const blockSegments = userBlocks.map((b) => ({
        id: b.id,
        start_date: b.start_date,
        end_date: b.end_date,
        reason: b.reason,
        block_type: b.block_type,
      }));

      // Utilizacao total no periodo
      const totalCapacity = weeks.reduce((s, w) => s + w.capacity, 0);
      const totalAllocated = weeks.reduce((s, w) => s + w.allocated, 0);

      return {
        id: user.id,
        name: user.name,
        email: user.email,
        weekly_capacity: parseFloat(user.weekly_capacity) || 40,
        allocation_segments: allocationSegments,
        block_segments: blockSegments,
        weeks,
        total_capacity: Math.round(totalCapacity * 100) / 100,
        total_allocated: Math.round(totalAllocated * 100) / 100,
        utilization_pct: totalCapacity > 0 ? Math.round((totalAllocated / totalCapacity) * 100) : 0,
      };
    });

    res.json({ consultants, start_date, end_date });
  } catch (error) {
    next(error);
  }
});

// ============================================
// CONSULTOR — calendario mensal individual
// ============================================
router.get('/consultant/:userId', async (req, res, next) => {
  try {
    const orgId = req.user?.organization_id || req.query.organization_id;
    const { userId } = req.params;
    let { month, start_date, end_date } = req.query;

    // Se informou month (YYYY-MM), calcular start/end
    if (month && !start_date) {
      const [year, mon] = month.split('-').map(Number);
      start_date = `${year}-${String(mon).padStart(2, '0')}-01`;
      const lastDay = new Date(year, mon, 0).getDate();
      end_date = `${year}-${String(mon).padStart(2, '0')}-${lastDay}`;
    }

    if (!start_date || !end_date) {
      return res.status(400).json({ error: { message: 'month ou start_date/end_date obrigatorios' } });
    }

    const data = await fetchConsultantData(userId, start_date, end_date, orgId);

    if (!data.user) {
      return res.status(404).json({ error: { message: 'Consultor nao encontrado' } });
    }

    const days = generateDayCapacities(data.user, data.allocations, data.blocks, data.tasks, start_date, end_date);

    res.json({
      consultant: {
        id: data.user.id,
        name: data.user.name,
        email: data.user.email,
        weekly_capacity: parseFloat(data.user.weekly_capacity) || 40,
      },
      days,
      start_date,
      end_date,
    });
  } catch (error) {
    next(error);
  }
});

// ============================================
// SUMMARY — dados para graficos/dashboard
// ============================================
router.get('/summary', async (req, res, next) => {
  try {
    const orgId = req.user?.organization_id || req.query.organization_id;
    const monthsAhead = parseInt(req.query.months_ahead || '3', 10);

    const today = new Date();
    const startDate = today.toISOString().split('T')[0];
    const endDate = new Date(today.getFullYear(), today.getMonth() + monthsAhead, 0)
      .toISOString()
      .split('T')[0];

    const data = await fetchAllConsultantsData(orgId, startDate, endDate);

    const consultantsUtilization = data.users.map((user) => {
      const userAllocations = data.allocations.filter((a) => a.user_id === user.id);
      const userBlocks = data.blocks.filter((b) => b.user_id === user.id);
      const userTasks = data.tasks.filter((t) => t.user_id === user.id);

      const days = generateDayCapacities(user, userAllocations, userBlocks, userTasks, startDate, endDate);
      const months = aggregateByMonth(days);

      return {
        id: user.id,
        name: user.name,
        months: months.map((m) => ({
          month: m.month,
          capacity: Math.round(m.capacity * 100) / 100,
          allocated: Math.round(m.allocated * 100) / 100,
          available: Math.round(m.available * 100) / 100,
          utilization_pct: m.capacity > 0 ? Math.round((m.allocated / m.capacity) * 100) : 0,
          blocked_days: m.blocked_days,
        })),
      };
    });

    // Horas livres por semana (equipe toda)
    const allDays = data.users.flatMap((user) => {
      const userAllocations = data.allocations.filter((a) => a.user_id === user.id);
      const userBlocks = data.blocks.filter((b) => b.user_id === user.id);
      const userTasks = data.tasks.filter((t) => t.user_id === user.id);
      return generateDayCapacities(user, userAllocations, userBlocks, userTasks, startDate, endDate);
    });

    const teamWeeks = {};
    for (const day of allDays) {
      if (day.is_weekend) continue;
      const d = new Date(day.date);
      const dayOfWeek = d.getDay();
      const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      const monday = new Date(d);
      monday.setDate(d.getDate() + diff);
      const weekKey = monday.toISOString().split('T')[0];

      if (!teamWeeks[weekKey]) {
        teamWeeks[weekKey] = { week_start: weekKey, total_capacity: 0, total_allocated: 0, free: 0 };
      }
      teamWeeks[weekKey].total_capacity += day.daily_capacity;
      teamWeeks[weekKey].total_allocated += day.total_allocated;
      teamWeeks[weekKey].free += day.available;
    }

    const teamFreeHoursWeekly = Object.values(teamWeeks)
      .sort((a, b) => a.week_start.localeCompare(b.week_start))
      .map((w) => ({
        ...w,
        total_capacity: Math.round(w.total_capacity * 100) / 100,
        total_allocated: Math.round(w.total_allocated * 100) / 100,
        free: Math.round(w.free * 100) / 100,
      }));

    // Alertas de superalocacao
    const overallocationAlerts = consultantsUtilization
      .flatMap((c) =>
        c.months
          .filter((m) => m.utilization_pct > 100)
          .map((m) => ({
            user_id: c.id,
            user_name: c.name,
            month: m.month,
            utilization_pct: m.utilization_pct,
            allocated: m.allocated,
            capacity: m.capacity,
          }))
      )
      .sort((a, b) => b.utilization_pct - a.utilization_pct);

    res.json({
      consultants_utilization: consultantsUtilization,
      team_free_hours_weekly: teamFreeHoursWeekly,
      overallocation_alerts: overallocationAlerts,
    });
  } catch (error) {
    next(error);
  }
});

// ============================================
// BLOCKS — CRUD de bloqueios (ferias, licenca)
// ============================================

// Listar bloqueios
router.get('/blocks', async (req, res, next) => {
  try {
    const orgId = req.user?.organization_id || req.query.organization_id;
    const { user_id, start_date, end_date } = req.query;

    let sql = `SELECT cb.*, u.name as user_name
               FROM consultant_blocks cb
               JOIN users u ON u.id = cb.user_id
               WHERE cb.organization_id = $1`;
    const params = [orgId];
    let paramIdx = 2;

    if (user_id) {
      sql += ` AND cb.user_id = $${paramIdx++}`;
      params.push(user_id);
    }
    if (start_date) {
      sql += ` AND cb.end_date >= $${paramIdx++}`;
      params.push(start_date);
    }
    if (end_date) {
      sql += ` AND cb.start_date <= $${paramIdx++}`;
      params.push(end_date);
    }

    sql += ' ORDER BY cb.start_date DESC';

    const result = await query(sql, params);
    res.json({ blocks: result.rows });
  } catch (error) {
    next(error);
  }
});

// Criar bloqueio
router.post('/blocks', async (req, res, next) => {
  try {
    const orgId = req.user?.organization_id || req.query.organization_id;
    const { user_id, start_date, end_date, reason, block_type = 'vacation' } = req.body;

    if (!user_id || !start_date || !end_date) {
      return res.status(400).json({ error: { message: 'user_id, start_date e end_date sao obrigatorios' } });
    }

    const result = await query(
      `INSERT INTO consultant_blocks (organization_id, user_id, start_date, end_date, reason, block_type)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [orgId, user_id, start_date, end_date, reason || null, block_type]
    );

    res.status(201).json({ block: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// Atualizar bloqueio
router.patch('/blocks/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { start_date, end_date, reason, block_type } = req.body;

    const fields = [];
    const values = [];
    let idx = 1;

    if (start_date) { fields.push(`start_date = $${idx++}`); values.push(start_date); }
    if (end_date) { fields.push(`end_date = $${idx++}`); values.push(end_date); }
    if (reason !== undefined) { fields.push(`reason = $${idx++}`); values.push(reason); }
    if (block_type) { fields.push(`block_type = $${idx++}`); values.push(block_type); }

    if (fields.length === 0) {
      return res.status(400).json({ error: { message: 'Nenhum campo para atualizar' } });
    }

    fields.push(`updated_at = NOW()`);
    values.push(id);

    const result = await query(
      `UPDATE consultant_blocks SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Bloqueio nao encontrado' } });
    }

    res.json({ block: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// Remover bloqueio
router.delete('/blocks/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await query('DELETE FROM consultant_blocks WHERE id = $1 RETURNING id', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Bloqueio nao encontrado' } });
    }

    res.json({ deleted: true });
  } catch (error) {
    next(error);
  }
});

export default router;
