import pg from 'pg';
import { createClient } from '@supabase/supabase-js';

const { Pool } = pg;

// Pool de conexões PostgreSQL direto
let pool = null;

// Cliente Supabase (alternativo)
let supabase = null;

/**
 * Inicializa conexão com banco de dados
 */
export async function initDatabase() {
  // Usar PostgreSQL direto se DATABASE_URL estiver configurado
  if (process.env.DATABASE_URL) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });

    // Testar conexão
    const client = await pool.connect();
    await client.query('SELECT NOW()');
    client.release();
    
    console.log('📦 Conectado ao PostgreSQL direto');
    return;
  }

  // Usar Supabase como alternativa
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
    supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );
    
    // Testar conexão
    const { error } = await supabase.from('organizations').select('id').limit(1);
    if (error && error.code !== 'PGRST116') {
      throw new Error(`Erro ao conectar Supabase: ${error.message}`);
    }
    
    console.log('📦 Conectado ao Supabase');
    return;
  }

  throw new Error('Nenhuma configuração de banco de dados encontrada');
}

/**
 * Executa query SQL (PostgreSQL direto)
 */
export async function query(text, params) {
  if (!pool) {
    throw new Error('Pool de conexão não inicializado');
  }
  
  const start = Date.now();
  const result = await pool.query(text, params);
  const duration = Date.now() - start;
  
  if (process.env.LOG_LEVEL === 'debug') {
    console.log('Query:', { text, duration, rows: result.rowCount });
  }
  
  return result;
}

/**
 * Retorna um client do pool para transações (BEGIN/COMMIT/ROLLBACK)
 * IMPORTANTE: Sempre chamar client.release() no finally
 */
export async function getClient() {
  if (!pool) throw new Error('Pool de conexão não inicializado');
  return pool.connect();
}

/**
 * Retorna cliente Supabase (se usando Supabase)
 */
export function getSupabase() {
  if (!supabase) {
    throw new Error('Cliente Supabase não inicializado');
  }
  return supabase;
}

/**
 * Busca usuários de uma organização (para matching de nomes)
 */
export async function getTeamMembers(organizationId) {
  if (pool) {
    const result = await query(
      'SELECT id, name, whatsapp, role FROM users WHERE organization_id = $1 AND is_active = true',
      [organizationId]
    );
    return result.rows;
  }
  
  if (supabase) {
    const { data, error } = await supabase
      .from('users')
      .select('id, name, whatsapp, role')
      .eq('organization_id', organizationId)
      .eq('is_active', true);
    
    if (error) throw error;
    return data;
  }
  
  throw new Error('Banco de dados não configurado');
}

/**
 * Busca usuário por nome (fuzzy matching)
 */
export async function findUserByName(organizationId, name) {
  if (pool) {
    const result = await query(
      'SELECT * FROM find_user_by_name($1, $2)',
      [organizationId, name]
    );
    return result.rows;
  }
  
  // Fallback para Supabase (sem pg_trgm, busca simples)
  if (supabase) {
    const { data, error } = await supabase
      .from('users')
      .select('id, name')
      .eq('organization_id', organizationId)
      .eq('is_active', true)
      .ilike('name', `%${name}%`);
    
    if (error) throw error;
    return data.map(u => ({ user_id: u.id, user_name: u.name, similarity: 0.5 }));
  }
  
  throw new Error('Banco de dados não configurado');
}

/**
 * Cria uma nova tarefa
 */
export async function createTask(taskData) {
  const {
    organization_id,
    project_id,
    title,
    description,
    assignee_id,
    due_date,
    priority,
    source,
    ai_confidence
  } = taskData;

  if (pool) {
    const result = await query(
      `INSERT INTO tasks (
        organization_id, project_id, title, description, 
        assignee_id, due_date, priority, source, ai_confidence
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *`,
      [organization_id, project_id, title, description, assignee_id, due_date, priority, source, ai_confidence]
    );
    return result.rows[0];
  }

  if (supabase) {
    const { data, error } = await supabase
      .from('tasks')
      .insert(taskData)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  }

  throw new Error('Banco de dados não configurado');
}

/**
 * Busca tarefas com filtros
 */
export async function getTasks(filters = {}) {
  const { organization_id, project_id, assignee_id, status, limit = 50 } = filters;

  if (pool) {
    let sql = 'SELECT t.*, u.name as assignee_name FROM tasks t LEFT JOIN users u ON t.assignee_id = u.id WHERE 1=1';
    const params = [];
    let paramIndex = 1;

    if (organization_id) {
      sql += ` AND t.organization_id = $${paramIndex++}`;
      params.push(organization_id);
    }
    if (project_id) {
      sql += ` AND t.project_id = $${paramIndex++}`;
      params.push(project_id);
    }
    if (assignee_id) {
      sql += ` AND t.assignee_id = $${paramIndex++}`;
      params.push(assignee_id);
    }
    if (status) {
      sql += ` AND t.status = $${paramIndex++}`;
      params.push(status);
    }

    sql += ` ORDER BY t.created_at DESC LIMIT $${paramIndex}`;
    params.push(limit);

    const result = await query(sql, params);
    return result.rows;
  }

  if (supabase) {
    let query = supabase
      .from('tasks')
      .select('*, assignee:users(name)')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (organization_id) query = query.eq('organization_id', organization_id);
    if (project_id) query = query.eq('project_id', project_id);
    if (assignee_id) query = query.eq('assignee_id', assignee_id);
    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    if (error) throw error;
    return data;
  }

  throw new Error('Banco de dados não configurado');
}

/**
 * Busca métricas de projeto para análise de risco
 */
export async function getProjectMetrics(projectId) {
  if (pool) {
    const result = await query('SELECT calculate_project_risk($1) as metrics', [projectId]);
    return result.rows[0]?.metrics;
  }

  // Fallback manual para Supabase
  if (supabase) {
    const { data: project } = await supabase
      .from('projects')
      .select('*, tasks(*), time_entries(*)')
      .eq('id', projectId)
      .single();

    if (!project) return null;

    const totalTasks = project.tasks?.filter(t => t.status !== 'cancelled').length || 0;
    const overdueTasks = project.tasks?.filter(t => 
      t.status !== 'done' && t.status !== 'cancelled' && new Date(t.due_date) < new Date()
    ).length || 0;
    const spentHours = project.time_entries?.reduce((sum, te) => sum + parseFloat(te.hours), 0) || 0;

    return {
      burn_rate: project.budget_hours ? (spentHours / project.budget_hours).toFixed(2) : 0,
      overdue_ratio: totalTasks > 0 ? (overdueTasks / totalTasks).toFixed(2) : 0,
      days_to_deadline: project.due_date ? Math.ceil((new Date(project.due_date) - new Date()) / (1000 * 60 * 60 * 24)) : null,
      progress_percent: project.progress_percent,
      total_tasks: totalTasks,
      overdue_tasks: overdueTasks,
      spent_hours: spentHours,
      budget_hours: project.budget_hours
    };
  }

  throw new Error('Banco de dados não configurado');
}

/**
 * Atualiza uma tarefa
 */
export async function updateTask(id, updates) {
  const allowedFields = ['title', 'description', 'assignee_id', 'due_date', 'priority', 'status', 'project_id', 'estimated_hours'];
  const fields = Object.keys(updates).filter(k => allowedFields.includes(k) && updates[k] !== undefined);

  if (fields.length === 0) {
    throw new Error('Nenhum campo válido para atualizar');
  }

  if (pool) {
    const setClauses = fields.map((f, i) => `${f} = $${i + 1}`);
    // Add completed_at logic
    if (updates.status === 'done') {
      setClauses.push(`completed_at = NOW()`);
    } else if (updates.status && updates.status !== 'done') {
      setClauses.push(`completed_at = NULL`);
    }
    setClauses.push('updated_at = NOW()');

    const values = fields.map(f => updates[f]);
    values.push(id);

    const result = await query(
      `UPDATE tasks SET ${setClauses.join(', ')} WHERE id = $${values.length} RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return null;
    }
    return result.rows[0];
  }

  if (supabase) {
    const updateData = {};
    fields.forEach(f => { updateData[f] = updates[f]; });
    updateData.updated_at = new Date().toISOString();
    if (updates.status === 'done') updateData.completed_at = new Date().toISOString();
    else if (updates.status) updateData.completed_at = null;

    const { data, error } = await supabase
      .from('tasks')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  throw new Error('Banco de dados não configurado');
}

/**
 * Busca projetos ativos de uma organização
 */
export async function getActiveProjects(organizationId) {
  if (pool) {
    const result = await query(
      `SELECT p.*, c.name as client_name
       FROM projects p
       LEFT JOIN clients c ON p.client_id = c.id
       WHERE p.organization_id = $1 AND p.status = 'active'
       ORDER BY p.due_date ASC NULLS LAST`,
      [organizationId]
    );
    return result.rows;
  }

  if (supabase) {
    const { data, error } = await supabase
      .from('projects')
      .select('*, client:clients(name)')
      .eq('organization_id', organizationId)
      .eq('status', 'active')
      .order('due_date', { ascending: true });

    if (error) throw error;
    return data;
  }

  throw new Error('Banco de dados não configurado');
}

/**
 * Salva alerta de risco
 */
export async function saveRiskAlert(alertData) {
  const { organization_id, project_id, severity, risk_score, details } = alertData;

  if (pool) {
    const result = await query(
      `INSERT INTO risk_alerts (organization_id, project_id, severity, risk_score, details)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [organization_id, project_id, severity, risk_score, JSON.stringify(details)]
    );
    return result.rows[0];
  }

  if (supabase) {
    const { data, error } = await supabase
      .from('risk_alerts')
      .insert({ organization_id, project_id, severity, risk_score, details })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  throw new Error('Banco de dados não configurado');
}

/**
 * Log de interação com IA
 */
export async function logAIInteraction(interactionData) {
  const {
    organization_id,
    type,
    input_text,
    output_structured,
    model,
    tokens_input,
    tokens_output,
    latency_ms,
    confidence,
    success,
    error_message
  } = interactionData;

  if (pool) {
    const result = await query(
      `INSERT INTO ai_interactions (
        organization_id, type, input_text, output_structured, model,
        tokens_input, tokens_output, latency_ms, confidence, success, error_message
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING id`,
      [organization_id, type, input_text, JSON.stringify(output_structured), model,
       tokens_input, tokens_output, latency_ms, confidence, success, error_message]
    );
    return result.rows[0];
  }

  if (supabase) {
    const { data, error } = await supabase
      .from('ai_interactions')
      .insert({
        organization_id,
        type,
        input_text,
        output_structured,
        model,
        tokens_input,
        tokens_output,
        latency_ms,
        confidence,
        success,
        error_message
      })
      .select('id')
      .single();
    
    if (error) throw error;
    return data;
  }

  throw new Error('Banco de dados não configurado');
}

export default { query, getClient, getSupabase, initDatabase };
