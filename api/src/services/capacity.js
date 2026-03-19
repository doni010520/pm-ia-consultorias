/**
 * Motor de calculo de capacidade dos consultores
 * Calcula disponibilidade diaria considerando alocacoes, tarefas e bloqueios
 */

import { query } from './database.js';

/**
 * Busca todos os dados necessarios para calcular capacidade de um consultor
 */
export async function fetchConsultantData(userId, startDate, endDate, orgId) {
  const [userResult, allocationsResult, blocksResult, tasksResult] = await Promise.all([
    // Dados do consultor
    query('SELECT id, name, email, weekly_capacity FROM users WHERE id = $1', [userId]),

    // Alocacoes ativas em projetos no periodo
    query(
      `SELECT pm.project_id, pm.hours_per_week, pm.start_date, pm.end_date,
              p.name as project_name, p.color
       FROM project_members pm
       JOIN projects p ON p.id = pm.project_id
       WHERE pm.user_id = $1 AND pm.is_active = true
         AND (pm.start_date IS NULL OR pm.start_date <= $3)
         AND (pm.end_date IS NULL OR pm.end_date >= $2)`,
      [userId, startDate, endDate]
    ),

    // Bloqueios no periodo
    query(
      `SELECT id, start_date, end_date, reason, block_type
       FROM consultant_blocks
       WHERE user_id = $1 AND start_date <= $3 AND end_date >= $2`,
      [userId, startDate, endDate]
    ),

    // Tarefas com prazo no periodo
    query(
      `SELECT t.id, t.title, t.estimated_hours, t.project_id, t.due_date,
              p.name as project_name
       FROM tasks t
       LEFT JOIN projects p ON p.id = t.project_id
       WHERE t.assignee_id = $1
         AND t.due_date::date BETWEEN $2 AND $3
         AND t.status NOT IN ('done', 'cancelled')`,
      [userId, startDate, endDate]
    ),
  ]);

  return {
    user: userResult.rows[0],
    allocations: allocationsResult.rows,
    blocks: blocksResult.rows,
    tasks: tasksResult.rows,
  };
}

/**
 * Busca dados de todos os consultores de uma organizacao
 */
export async function fetchAllConsultantsData(orgId, startDate, endDate) {
  const [usersResult, allocationsResult, blocksResult, tasksResult] = await Promise.all([
    query(
      'SELECT id, name, email, weekly_capacity FROM users WHERE organization_id = $1 AND is_active = true ORDER BY name',
      [orgId]
    ),

    query(
      `SELECT pm.user_id, pm.project_id, pm.hours_per_week, pm.start_date, pm.end_date,
              p.name as project_name, p.color
       FROM project_members pm
       JOIN projects p ON p.id = pm.project_id
       JOIN users u ON u.id = pm.user_id
       WHERE u.organization_id = $1 AND pm.is_active = true
         AND (pm.start_date IS NULL OR pm.start_date <= $3)
         AND (pm.end_date IS NULL OR pm.end_date >= $2)`,
      [orgId, startDate, endDate]
    ),

    query(
      `SELECT cb.user_id, cb.id, cb.start_date, cb.end_date, cb.reason, cb.block_type
       FROM consultant_blocks cb
       JOIN users u ON u.id = cb.user_id
       WHERE u.organization_id = $1 AND cb.start_date <= $3 AND cb.end_date >= $2`,
      [orgId, startDate, endDate]
    ),

    query(
      `SELECT t.assignee_id as user_id, t.id, t.title, t.estimated_hours, t.project_id, t.due_date,
              p.name as project_name
       FROM tasks t
       LEFT JOIN projects p ON p.id = t.project_id
       WHERE t.organization_id = $1
         AND t.assignee_id IS NOT NULL
         AND t.due_date::date BETWEEN $2 AND $3
         AND t.status NOT IN ('done', 'cancelled')`,
      [orgId, startDate, endDate]
    ),
  ]);

  return {
    users: usersResult.rows,
    allocations: allocationsResult.rows,
    blocks: blocksResult.rows,
    tasks: tasksResult.rows,
  };
}

/**
 * Calcula capacidade diaria de um consultor no periodo
 * @returns {Array<DayCapacity>}
 */
export function calculateDailyCapacity(user, allocations, blocks, tasks) {
  const dailyCapacity = Math.round((user.weekly_capacity || 40) / 5);

  // Set de project_ids com alocacao ativa (para nao contar tarefas dobrado)
  const allocatedProjectIds = new Set(allocations.map((a) => a.project_id));

  // Indexar tarefas por data
  const tasksByDate = {};
  for (const task of tasks) {
    const dateStr = toDateStr(task.due_date);
    if (!tasksByDate[dateStr]) tasksByDate[dateStr] = [];
    tasksByDate[dateStr].push(task);
  }

  const days = [];
  const start = new Date(allocations.length > 0 || blocks.length > 0 || tasks.length > 0
    ? Math.min(
        ...allocations.map((a) => a.start_date ? new Date(a.start_date) : new Date('2020-01-01')),
        ...blocks.map((b) => new Date(b.start_date)),
        ...tasks.map((t) => new Date(t.due_date)),
        new Date()
      )
    : new Date()
  );

  return { dailyCapacity, allocatedProjectIds, tasksByDate };
}

/**
 * Gera array de dias com capacidade calculada para um intervalo
 */
export function generateDayCapacities(user, allocations, blocks, tasks, startDate, endDate) {
  const dailyCapacity = Math.round((user.weekly_capacity || 40) / 5);
  // Somente projetos com horas alocadas > 0 contam (para nao filtrar tarefas indevidamente)
  const allocatedProjectIds = new Set(
    allocations.filter((a) => parseFloat(a.hours_per_week) > 0).map((a) => a.project_id)
  );

  // Indexar tarefas por data
  const tasksByDate = {};
  for (const task of tasks) {
    const dateStr = toDateStr(task.due_date);
    if (!tasksByDate[dateStr]) tasksByDate[dateStr] = [];
    tasksByDate[dateStr].push(task);
  }

  const days = [];
  const current = new Date(startDate);
  const end = new Date(endDate);

  while (current <= end) {
    const dateStr = toDateStr(current);
    const dayOfWeek = current.getDay(); // 0=Dom, 6=Sab
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    if (isWeekend) {
      days.push({
        date: dateStr,
        is_weekend: true,
        is_blocked: false,
        block_reason: null,
        daily_capacity: 0,
        allocations: [],
        tasks: [],
        total_allocated: 0,
        available: 0,
      });
      current.setDate(current.getDate() + 1);
      continue;
    }

    // Verificar bloqueios
    const block = blocks.find(
      (b) => dateStr >= toDateStr(b.start_date) && dateStr <= toDateStr(b.end_date)
    );

    if (block) {
      days.push({
        date: dateStr,
        is_weekend: false,
        is_blocked: true,
        block_reason: block.reason,
        block_type: block.block_type,
        daily_capacity: 0,
        allocations: [],
        tasks: [],
        total_allocated: 0,
        available: 0,
      });
      current.setDate(current.getDate() + 1);
      continue;
    }

    // Alocacoes ativas neste dia
    const activeAllocations = allocations.filter((a) => {
      const aStart = a.start_date ? toDateStr(a.start_date) : '1900-01-01';
      const aEnd = a.end_date ? toDateStr(a.end_date) : '2100-12-31';
      return dateStr >= aStart && dateStr <= aEnd;
    });

    const allocationEntries = activeAllocations
      .filter((a) => parseFloat(a.hours_per_week) > 0)
      .map((a) => ({
        project_id: a.project_id,
        project_name: a.project_name,
        color: a.color || '#3b82f6',
        daily_hours: Math.round((a.hours_per_week || 0) / 5),
      }));

    const totalProjectHours = allocationEntries.reduce((s, a) => s + a.daily_hours, 0);

    // Todas as tarefas do dia (mostrar no calendario)
    const allDayTasks = tasksByDate[dateStr] || [];
    // Tarefas que consomem capacidade extra (nao pertencem a projetos alocados)
    const dayTasks = allDayTasks.filter(
      (t) => !allocatedProjectIds.has(t.project_id)
    );
    const extraTaskHours = dayTasks.reduce((s, t) => s + (parseFloat(t.estimated_hours) || 0), 0);

    const totalAllocated = totalProjectHours + extraTaskHours;
    const available = Math.max(0, Math.round(dailyCapacity - totalAllocated));

    days.push({
      date: dateStr,
      is_weekend: false,
      is_blocked: false,
      block_reason: null,
      daily_capacity: dailyCapacity,
      allocations: allocationEntries,
      tasks: allDayTasks.map((t) => ({
        task_id: t.id,
        title: t.title,
        estimated_hours: parseFloat(t.estimated_hours) || 0,
        project_id: t.project_id,
        project_name: t.project_name,
      })),
      total_allocated: Math.round(totalAllocated * 100) / 100,
      available,
    });

    current.setDate(current.getDate() + 1);
  }

  return days;
}

/**
 * Calcula resumo semanal a partir dos dias
 */
export function aggregateByWeek(days) {
  const weeks = {};

  for (const day of days) {
    if (day.is_weekend) continue;
    // Pegar segunda-feira da semana
    const d = new Date(day.date);
    const dayOfWeek = d.getDay();
    const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek; // Ajustar para segunda
    const monday = new Date(d);
    monday.setDate(d.getDate() + diff);
    const weekKey = toDateStr(monday);

    if (!weeks[weekKey]) {
      weeks[weekKey] = { week_start: weekKey, capacity: 0, allocated: 0, available: 0, days: 0 };
    }

    weeks[weekKey].capacity += day.daily_capacity;
    weeks[weekKey].allocated += day.total_allocated;
    weeks[weekKey].available += day.available;
    weeks[weekKey].days += day.is_blocked ? 0 : 1;
  }

  return Object.values(weeks).sort((a, b) => a.week_start.localeCompare(b.week_start));
}

/**
 * Calcula resumo mensal a partir dos dias
 */
export function aggregateByMonth(days) {
  const months = {};

  for (const day of days) {
    if (day.is_weekend) continue;
    const monthKey = day.date.substring(0, 7); // YYYY-MM

    if (!months[monthKey]) {
      months[monthKey] = { month: monthKey, capacity: 0, allocated: 0, available: 0, blocked_days: 0, working_days: 0 };
    }

    months[monthKey].capacity += day.daily_capacity;
    months[monthKey].allocated += day.total_allocated;
    months[monthKey].available += day.available;
    if (day.is_blocked) months[monthKey].blocked_days++;
    else months[monthKey].working_days++;
  }

  return Object.values(months).sort((a, b) => a.month.localeCompare(b.month));
}

/**
 * Converte data para string YYYY-MM-DD
 */
function toDateStr(date) {
  if (!date) return null;
  if (typeof date === 'string') {
    // Se ja e string ISO, pegar so a parte da data
    return date.substring(0, 10);
  }
  const d = new Date(date);
  return d.toISOString().substring(0, 10);
}

export default {
  fetchConsultantData,
  fetchAllConsultantsData,
  generateDayCapacities,
  aggregateByWeek,
  aggregateByMonth,
};
